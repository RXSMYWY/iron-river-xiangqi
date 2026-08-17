import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { activateSkill, applyMove, createInitialState, isLegalMove } from "../src/game/rules";
import type { GameState, Move, Side } from "../src/game/types";

interface Player {
  socketId: string;
  side: Side;
}

interface Room {
  id: string;
  state: GameState;
  players: Player[];
  history: GameState[];
  clocks: Record<Side, number>;
  stepMs: number;
  turnStartedAt: number;
  pending?: { type: "undo" | "draw"; from: Side };
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});
const rooms = new Map<string, Room>();

app.get("/api/connect-info", (req, res) => {
  const port = Number(process.env.PORT) || 3001;
  const lanUrls: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        lanUrls.push(`http://${address.address}:${port}`);
      }
    }
  }
  res.json({
    currentUrl: `${req.protocol}://${req.get("host")}`,
    publicUrl: process.env.PUBLIC_URL || null,
    lanUrls,
  });
});

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function publicRoom(room: Room) {
  return {
    roomId: room.id,
    state: room.state,
    players: room.players.map((player) => player.side),
    clocks: room.clocks,
    stepMs: room.stepMs,
    turnStartedAt: room.turnStartedAt,
  };
}

io.on("connection", (socket) => {
  socket.on("room:create", (config: { totalMs?: number; stepMs?: number } | ((payload: unknown) => void), callback?: (payload: unknown) => void) => {
    const ack = typeof config === "function" ? config : callback!;
    const options = typeof config === "function" ? {} : config;
    let id = roomCode();
    while (rooms.has(id)) id = roomCode();
    const room: Room = {
      id,
      state: createInitialState(),
      players: [{ socketId: socket.id, side: "red" }],
      history: [],
      clocks: { red: options.totalMs || 20 * 60_000, black: options.totalMs || 20 * 60_000 },
      stepMs: options.stepMs || 60_000,
      turnStartedAt: Date.now(),
    };
    rooms.set(id, room);
    socket.join(id);
    ack({ ok: true, ...publicRoom(room), side: "red" });
  });

  socket.on("room:join", (rawId: string, ack: (payload: unknown) => void) => {
    const id = rawId.trim().toUpperCase();
    const room = rooms.get(id);
    if (!room) return ack({ ok: false, error: "房间不存在或已结束" });
    if (room.players.length >= 2) return ack({ ok: false, error: "房间已满" });
    if (room.players.some((player) => player.socketId === socket.id)) {
      const existing = room.players.find((player) => player.socketId === socket.id)!;
      return ack({ ok: true, ...publicRoom(room), side: existing.side });
    }

    const side: Side = room.players.some((player) => player.side === "red") ? "black" : "red";
    room.players.push({ socketId: socket.id, side });
    socket.join(id);
    ack({ ok: true, ...publicRoom(room), side });
    io.to(id).emit("room:update", publicRoom(room));
  });

  socket.on(
    "game:move",
    ({ roomId, move }: { roomId: string; move: Move }, ack: (payload: unknown) => void) => {
      const room = rooms.get(roomId);
      const player = room?.players.find((item) => item.socketId === socket.id);
      if (!room || !player) return ack({ ok: false, error: "不在该房间中" });
      if (room.state.turn !== player.side) return ack({ ok: false, error: "还没轮到你" });
      if (!isLegalMove(room.state, move)) return ack({ ok: false, error: "非法走法" });

      room.history.push(structuredClone(room.state));
      room.clocks[player.side] -= Date.now() - room.turnStartedAt;
      room.state = applyMove(room.state, move);
      room.turnStartedAt = Date.now();
      io.to(roomId).emit("game:state", room.state);
      io.to(roomId).emit("game:clock", { clocks: room.clocks, turnStartedAt: room.turnStartedAt, stepMs: room.stepMs });
      ack({ ok: true });
    },
  );

  socket.on("game:skill", ({ roomId, pieceId, targetId }: { roomId: string; pieceId: string; targetId?: string }, ack: (payload: unknown) => void) => {
    const room = rooms.get(roomId);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || !player || room.state.turn !== player.side) return ack({ ok: false, error: "无法释放技能" });
    const next = activateSkill(room.state, pieceId, targetId);
    if (next === room.state) return ack({ ok: false, error: "技能目标无效或已使用" });
    room.history.push(structuredClone(room.state));
    if (next.turn !== room.state.turn) {
      room.clocks[player.side] -= Date.now() - room.turnStartedAt;
      room.turnStartedAt = Date.now();
    }
    room.state = next;
    io.to(roomId).emit("game:state", room.state);
    ack({ ok: true });
  });

  socket.on("game:control", ({ roomId, type }: { roomId: string; type: "undo" | "draw" }) => {
    const room = rooms.get(roomId);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || !player || room.pending) return;
    room.pending = { type, from: player.side };
    const opponent = room.players.find((item) => item.side !== player.side);
    if (opponent) io.to(opponent.socketId).emit("game:control-request", { type, from: player.side });
  });

  socket.on("game:control-response", ({ roomId, accept }: { roomId: string; accept: boolean }) => {
    const room = rooms.get(roomId);
    const responder = room?.players.find((item) => item.socketId === socket.id);
    if (!room || !responder || !room.pending || responder.side === room.pending.from) return;
    if (accept && room.pending.type === "undo" && room.history.length) {
      room.state = room.history.pop()!;
      room.turnStartedAt = Date.now();
      io.to(roomId).emit("game:state", room.state);
    } else if (accept && room.pending.type === "draw") {
      room.state = { ...room.state, result: "draw", winner: null };
      io.to(roomId).emit("game:state", room.state);
    }
    io.to(roomId).emit("game:control-result", { type: room.pending.type, accept });
    room.pending = undefined;
  });

  socket.on("game:restart", (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room || !room.players.some((player) => player.socketId === socket.id)) return;
    room.state = createInitialState();
    room.history = [];
    room.turnStartedAt = Date.now();
    io.to(roomId).emit("game:state", room.state);
  });

  socket.on("disconnect", () => {
    for (const [id, room] of rooms) {
      const before = room.players.length;
      room.players = room.players.filter((player) => player.socketId !== socket.id);
      if (room.players.length === 0) rooms.delete(id);
      else if (room.players.length !== before) io.to(id).emit("room:update", publicRoom(room));
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.state.winner || room.state.result || room.players.length < 2) continue;
    const elapsed = now - room.turnStartedAt;
    const side = room.state.turn;
    if (room.clocks[side] - elapsed <= 0 || elapsed >= room.stepMs) {
      room.clocks[side] = Math.max(0, room.clocks[side] - elapsed);
      room.state = {
        ...room.state,
        winner: side === "red" ? "black" : "red",
        result: "timeout",
      };
      io.to(room.id).emit("game:state", room.state);
    } else {
      io.to(room.id).emit("game:clock", {
        clocks: { ...room.clocks, [side]: room.clocks[side] - elapsed },
        turnStartedAt: room.turnStartedAt,
        stepMs: room.stepMs,
      });
    }
  }
}, 1000);

const dist = resolve(process.cwd(), "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*path", (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

const port = Number(process.env.PORT) || 3001;
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Iron River server listening on http://0.0.0.0:${port}`);
});
