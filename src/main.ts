import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import { chooseAiMove } from "./game/ai";
import { BattleAudio } from "./game/audio";
import { activateSkill, applyMove, createInitialState, isInCheck } from "./game/rules";
import { detectNamedMove } from "./game/tactics";
import type { GameMode, GameState, Move, Piece, PieceKind, Side } from "./game/types";
import { XiangqiScene } from "./game/XiangqiScene";
import "./style.css";

interface RoomPayload {
  ok: boolean;
  error?: string;
  roomId: string;
  state: GameState;
  side: Side;
  players: Side[];
  clocks?: Record<Side, number>;
  stepMs?: number;
  turnStartedAt?: number;
}

interface ConnectInfo {
  currentUrl: string;
  publicUrl: string | null;
  lanUrls: string[];
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main class="shell">
    <header class="masthead">
      <div>
        <p class="eyebrow">IRON RIVER · XIANGQI</p>
        <h1>铁河棋局</h1>
      </div>
      <div class="status-cluster">
        <span id="connection-dot" class="connection-dot"></span>
        <span id="connection-label">本地战局</span>
        <button id="sound-button" class="icon-button" aria-label="切换声音">声效 ON</button>
      </div>
    </header>
    <section class="stage">
      <aside class="command-panel">
        <div class="mode-tabs">
          <button class="mode-tab active" data-mode="ai">人机试炼</button>
          <button class="mode-tab" data-mode="local">同屏对战</button>
          <button class="mode-tab" data-mode="online">远程对决</button>
        </div>
        <section id="ai-panel" class="panel-section">
          <p class="section-kicker">单骑闯阵</p>
          <h2>执红先行</h2>
          <p>AI 使用局面估值与搜索选择走法。吃子越重，战场反馈越猛烈。</p>
          <button id="new-ai" class="primary-button">重开战局</button>
        </section>
        <section id="local-panel" class="panel-section hidden">
          <p class="section-kicker">共坐一局</p>
          <h2>同屏轮流落子</h2>
          <p>红黑双方使用同一块屏幕，系统会按当前回合自动开放对应棋子。</p>
          <button id="new-local" class="primary-button">开始同屏对战</button>
        </section>
        <section id="online-panel" class="panel-section hidden">
          <p class="section-kicker">跨屏会战</p>
          <h2>分享房间链接</h2>
          <p>创建房间后，将链接发给另一台电脑。对方打开即可执黑加入。</p>
          <button id="create-room" class="primary-button">创建房间</button>
          <div class="join-row">
            <input id="room-input" maxlength="6" placeholder="输入房间码" aria-label="房间码" />
            <button id="join-room">加入</button>
          </div>
          <div id="invite-box" class="invite-box hidden">
            <span id="room-code"></span>
            <input id="invite-link" readonly aria-label="邀请链接" />
            <button id="copy-link">复制邀请链接</button>
            <small id="link-hint"></small>
          </div>
        </section>
        <div class="divider"></div>
        <section class="battle-info">
          <span class="section-kicker">战况</span>
          <strong id="turn-label">红方 · 行棋</strong>
          <p id="role-label">你执红方</p>
          <p id="battle-message" class="battle-message">落子如落刀。</p>
        </section>
        <section class="skill-panel">
          <span class="section-kicker">武将技</span>
          <strong id="skill-name">请先选择棋子</strong>
          <p id="skill-desc">每方每类棋子每局可释放一次技能。</p>
          <button id="skill-button" class="primary-button" disabled>释放技能</button>
        </section>
        <section class="clock-panel">
          <div><small>红方</small><strong id="red-clock">20:00</strong></div>
          <div><small>黑方</small><strong id="black-clock">20:00</strong></div>
        </section>
        <div class="time-settings">
          <label>总时长<input id="total-time" type="number" min="1" max="180" value="20" />分</label>
          <label>单步<input id="step-time" type="number" min="5" max="600" value="60" />秒</label>
        </div>
        <div class="control-row">
          <button id="undo-button" class="ghost-button">悔棋</button>
          <button id="draw-button" class="ghost-button">求和</button>
        </div>
        <button id="restart-button" class="ghost-button">重新开始</button>
      </aside>
      <div class="board-frame">
        <div id="game-root"></div>
        <div id="waiting-overlay" class="waiting-overlay hidden">
          <span class="loader"></span>
          <strong>静候敌手入局</strong>
          <small>复制左侧链接邀请对手</small>
        </div>
      </div>
    </section>
    <footer>
      <span>点击棋子查看可行落点</span>
      <span>金点可行 · 红环可杀</span>
    </footer>
  </main>
`;

const audio = new BattleAudio();
let mode: GameMode = "ai";
let state = createInitialState();
let playerSide: Side = "red";
let roomId: string | null = null;
let socket: Socket | null = null;
let scene: XiangqiScene;
let waitingForAi = false;
let selectedPiece: Piece | null = null;
let history: GameState[] = [];
let clocks: Record<Side, number> = { red: 20 * 60_000, black: 20 * 60_000 };
let turnElapsed = 0;
let stepMs = 60_000;
let lastTick = Date.now();

const SKILLS: Record<PieceKind, { name: string; desc: string }> = {
  general: { name: "王令", desc: "本次走棋后仍由己方继续行动。" },
  advisor: { name: "护驾", desc: "仕/士与己方将帅交换位置并结束回合。" },
  elephant: { name: "山河阵", desc: "在前方生成一回合不可进入的阻挡。" },
  horse: { name: "破阵", desc: "本次马步无视蹩马腿。" },
  rook: { name: "战车冲阵", desc: "本次吃子可越过一个棋子。" },
  cannon: { name: "烽火标记", desc: "先选敌子为目标，本次可无炮架攻击它。" },
  soldier: { name: "背水一战", desc: "过河兵卒本次可斜向前走。" },
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: 760,
  height: 770,
  transparent: true,
  scene: XiangqiScene,
  render: { antialias: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});

function element<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}

function setMessage(message: string): void {
  element<HTMLParagraphElement>("battle-message").textContent = message;
}

function updateUi(): void {
  const isCheck = !state.winner && isInCheck(state, state.turn);
  const isLocal = mode === "local";
  element<HTMLSpanElement>("turn-label").textContent = state.result === "draw"
    ? "楚河汉界 · 和棋"
    : state.winner
    ? `${state.winner === "red" ? "红方" : "黑方"} · 胜`
    : `${state.turn === "red" ? "红方" : "黑方"} · ${isCheck ? "受将" : "行棋"}`;
  element<HTMLParagraphElement>("role-label").textContent = mode === "ai"
    ? "你执红方 · AI 执黑方"
    : isLocal
      ? "同屏对战 · 双方轮流操作"
      : `你执${playerSide === "red" ? "红" : "黑"}方`;
  scene?.setInteractiveTurn(!state.winner && !state.result && !waitingForAi && (isLocal || state.turn === playerSide));
  if (state.result === "draw") setMessage("双方罢兵，本局和棋。");
  else if (state.winner) setMessage(state.result === "timeout" ? "计时归零，超时判负。" : "大局已定，胜负刻于铁河。");
  else if (isCheck) setMessage("将军！王城危急。");
  else if (isLocal) setMessage(`请${state.turn === "red" ? "红方" : "黑方"}落子。`);
  else setMessage(state.turn === playerSide ? "轮到你落子。" : "敌手正在思索。");
}

function sync(next: GameState): void {
  const previous = state;
  state = next;
  let announcedMove: string | null = null;
  const captured = previous.pieces.find((piece) => piece.id === next.lastMove?.capturedId);
  if (captured) audio.capture(captured.kind === "general");
  if (next.lastMove && next.lastMove !== previous.lastMove) {
    const moved = next.pieces.find((piece) => piece.id === next.lastMove?.pieceId);
    const namedMove = detectNamedMove(previous, next);
    if (namedMove) {
      audio.namedMove(namedMove);
      scene?.announceNamedMove(namedMove);
      announcedMove = namedMove;
    } else if (moved) {
      audio.pieceMove(moved.kind);
    }
  }
  if (!next.winner && isInCheck(next, next.turn)) audio.check();
  if (next.winner) audio.victory();
  scene?.syncState(next);
  updateUi();
  if (announcedMove) setMessage(`名招显现：${announcedMove}`);
}

function onMove(move: Move): void {
  if (mode === "online") {
    if (!socket || !roomId) return;
    socket.emit("game:move", { roomId, move }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) setMessage(response.error ?? "落子失败");
    });
    return;
  }

  if (mode === "local") {
    history.push(structuredClone(state));
    sync(applyMove(state, move));
    turnElapsed = 0;
    lastTick = Date.now();
    return;
  }

  if (state.turn !== "red" || waitingForAi) return;
  history.push(structuredClone(state));
  sync(applyMove(state, move));
  runAiIfNeeded();
}

function runAiIfNeeded(): void {
  if (mode !== "ai" || state.winner || state.result || state.turn !== "black") return;
  waitingForAi = true;
  updateUi();
  window.setTimeout(() => {
    const aiMove = chooseAiMove(state, 2);
    waitingForAi = false;
    if (aiMove) sync(applyMove(state, aiMove));
    else updateUi();
  }, 520);
}

function resetMatch(): void {
  const total = Math.max(1, Number(element<HTMLInputElement>("total-time").value) || 20) * 60_000;
  stepMs = Math.max(5, Number(element<HTMLInputElement>("step-time").value) || 60) * 1000;
  clocks = { red: total, black: total };
  turnElapsed = 0;
  lastTick = Date.now();
  history = [];
  sync(createInitialState());
}

function formatTime(ms: number): string {
  const value = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

window.setInterval(() => {
  if (state.winner || state.result || waitingForAi) return;
  const now = Date.now();
  const delta = now - lastTick;
  lastTick = now;
  if (mode !== "online") {
    clocks[state.turn] -= delta;
    turnElapsed += delta;
    if (clocks[state.turn] <= 0 || turnElapsed >= stepMs) {
      const loser = state.turn;
      sync({ ...state, winner: loser === "red" ? "black" : "red", result: "timeout" });
    }
  }
  element("red-clock").textContent = formatTime(clocks.red);
  element("black-clock").textContent = formatTime(clocks.black);
}, 250);

game.events.once("ready", () => {
  scene = game.scene.getScene("xiangqi") as XiangqiScene;
});

function waitForScene(): void {
  const candidate = game.scene.getScene("xiangqi") as XiangqiScene;
  if (!candidate?.scene.isActive()) {
    window.setTimeout(waitForScene, 30);
    return;
  }
  scene = candidate;
  scene.setMoveHandler(onMove);
  scene.setSelectionHandler((piece) => {
    selectedPiece = piece;
    const button = element<HTMLButtonElement>("skill-button");
    if (!piece) {
      element("skill-name").textContent = "请先选择棋子";
      element("skill-desc").textContent = "每方每类棋子每局可释放一次技能。";
      button.disabled = true;
      return;
    }
    const skill = SKILLS[piece.kind];
    element("skill-name").textContent = `${piece.side === "red" ? "红" : "黑"}方 · ${skill.name}`;
    element("skill-desc").textContent = skill.desc;
    const allowedSide = mode === "local" || piece.side === playerSide;
    button.disabled = !allowedSide || piece.side !== state.turn || !!state.skillUses[piece.side][piece.kind];
    button.textContent = state.skillUses[piece.side][piece.kind] ? "本局已使用" : "释放技能";
  });
  scene.setPerspective(playerSide);
  scene.syncState(state);
  updateUi();
}
waitForScene();

function ensureSocket(): Socket {
  if (socket) return socket;
  socket = io();
  socket.on("connect", () => {
    element("connection-dot").classList.add("online");
    element("connection-label").textContent = "联机服务已连接";
  });
  socket.on("disconnect", () => {
    element("connection-dot").classList.remove("online");
    element("connection-label").textContent = "联机服务已断开";
  });
  socket.on("game:state", (next: GameState) => sync(next));
  socket.on("game:clock", (payload: { clocks: Record<Side, number>; stepMs: number }) => {
    clocks = payload.clocks;
    stepMs = payload.stepMs;
    turnElapsed = 0;
  });
  socket.on("game:control-request", ({ type, from }: { type: "undo" | "draw"; from: Side }) => {
    const label = type === "undo" ? "悔棋" : "和棋";
    const accept = window.confirm(`${from === "red" ? "红方" : "黑方"}请求${label}，是否同意？`);
    socket?.emit("game:control-response", { roomId, accept });
  });
  socket.on("game:control-result", ({ type, accept }: { type: "undo" | "draw"; accept: boolean }) => {
    setMessage(`${type === "undo" ? "悔棋" : "和棋"}请求${accept ? "已同意" : "被拒绝"}。`);
  });
  socket.on("room:update", (payload: { players: Side[] }) => {
    const waiting = payload.players.length < 2;
    element("waiting-overlay").classList.toggle("hidden", !waiting);
    if (!waiting) setMessage("敌手已入局，红方先行。");
  });
  return socket;
}

async function setInviteLink(id: string): Promise<void> {
  const current = new URL(window.location.href);
  const localOnly = ["localhost", "127.0.0.1", "::1"].includes(current.hostname);
  let baseUrl = current.origin;
  let hint = "此链接可发给能访问当前网站的另一台电脑。";

  if (localOnly) {
    try {
      const response = await fetch("/api/connect-info");
      const info = await response.json() as ConnectInfo;
      baseUrl = info.publicUrl || info.lanUrls[0] || current.origin;
      hint = info.publicUrl
        ? "已使用 PUBLIC_URL 公网地址，可直接发送给另一台电脑。"
        : info.lanUrls[0]
          ? "已生成局域网链接；两台电脑需连接同一网络，且防火墙需放行服务端口。"
          : "未找到可用网络地址；请部署到公网后再发送链接。";
    } catch {
      hint = "无法读取网络地址；请部署到公网后再发送链接。";
    }
  }

  const invite = new URL(baseUrl);
  invite.searchParams.set("room", id);
  element<HTMLInputElement>("invite-link").value = invite.toString();
  element("link-hint").textContent = hint;
}

function enterRoom(payload: RoomPayload): void {
  roomId = payload.roomId;
  playerSide = payload.side;
  if (payload.clocks) clocks = payload.clocks;
  if (payload.stepMs) stepMs = payload.stepMs;
  turnElapsed = payload.turnStartedAt ? Date.now() - payload.turnStartedAt : 0;
  scene?.setPerspective(playerSide);
  sync(payload.state);
  element("room-code").textContent = `房间 ${roomId}`;
  element("invite-box").classList.remove("hidden");
  element("waiting-overlay").classList.toggle("hidden", payload.players.length >= 2);
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url);
  void setInviteLink(roomId);
}

document.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode as GameMode;
    document.querySelectorAll(".mode-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    element("ai-panel").classList.toggle("hidden", mode !== "ai");
    element("local-panel").classList.toggle("hidden", mode !== "local");
    element("online-panel").classList.toggle("hidden", mode !== "online");
    element("waiting-overlay").classList.add("hidden");
    playerSide = "red";
    roomId = null;
    scene?.setPerspective("red");
    resetMatch();
    if (mode === "online") ensureSocket();
  });
});

element("new-ai").addEventListener("click", resetMatch);
element("new-local").addEventListener("click", resetMatch);
element("restart-button").addEventListener("click", () => {
  if (mode === "online" && roomId) ensureSocket().emit("game:restart", roomId);
  else resetMatch();
});
element("sound-button").addEventListener("click", () => {
  audio.setEnabled(!audio.isEnabled);
  element("sound-button").textContent = `声效 ${audio.isEnabled ? "ON" : "OFF"}`;
});
element("create-room").addEventListener("click", () => {
  const totalMs = Math.max(1, Number(element<HTMLInputElement>("total-time").value) || 20) * 60_000;
  const configuredStepMs = Math.max(5, Number(element<HTMLInputElement>("step-time").value) || 60) * 1000;
  ensureSocket().emit("room:create", { totalMs, stepMs: configuredStepMs }, (payload: RoomPayload) => {
    if (payload.ok) enterRoom(payload);
    else setMessage(payload.error ?? "创建失败");
  });
});

element("skill-button").addEventListener("click", () => {
  if (!selectedPiece) return;
  let targetId: string | undefined;
  if (selectedPiece.kind === "cannon") {
    const targets = state.pieces.filter((piece) =>
      piece.alive && piece.side !== selectedPiece!.side &&
      (piece.x === selectedPiece!.x || piece.y === selectedPiece!.y),
    );
    targetId = targets.sort((a, b) =>
      Math.abs(a.x - selectedPiece!.x) + Math.abs(a.y - selectedPiece!.y) -
      Math.abs(b.x - selectedPiece!.x) - Math.abs(b.y - selectedPiece!.y),
    )[0]?.id;
    if (!targetId) return setMessage("炮的横线或纵线上没有可标记目标。");
  }
  const skill = SKILLS[selectedPiece.kind];
  audio.skill(skill.name);
  if (mode === "online") {
    if (!roomId) return;
    ensureSocket().emit("game:skill", { roomId, pieceId: selectedPiece.id, targetId }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) setMessage(response.error || "技能释放失败");
    });
  } else {
    const next = activateSkill(state, selectedPiece.id, targetId);
    if (next === state) return setMessage("当前无法释放该技能。");
    history.push(structuredClone(state));
    sync(next);
    runAiIfNeeded();
  }
});

element("undo-button").addEventListener("click", () => {
  if (mode === "online") {
    if (roomId) ensureSocket().emit("game:control", { roomId, type: "undo" });
    return setMessage("已向对手发送悔棋请求。");
  }
  if (!history.length) return setMessage("当前没有可撤销的行动。");
  sync(history.pop()!);
  turnElapsed = 0;
});

element("draw-button").addEventListener("click", () => {
  if (mode === "online") {
    if (roomId) ensureSocket().emit("game:control", { roomId, type: "draw" });
    return setMessage("已向对手发送和棋请求。");
  }
  if (window.confirm("双方是否同意和棋？")) sync({ ...state, result: "draw", winner: null });
});
element("join-room").addEventListener("click", () => {
  const code = element<HTMLInputElement>("room-input").value.trim();
  if (!code) return setMessage("请输入房间码。");
  ensureSocket().emit("room:join", code, (payload: RoomPayload) => {
    if (payload.ok) enterRoom(payload);
    else setMessage(payload.error ?? "加入失败");
  });
});
element("copy-link").addEventListener("click", async () => {
  const input = element<HTMLInputElement>("invite-link");
  const button = element<HTMLButtonElement>("copy-link");
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(input.value);
      copied = true;
    }
  } catch {
    copied = false;
  }
  if (!copied) {
    input.focus();
    input.select();
    copied = document.execCommand("copy");
  }
  button.textContent = copied ? "已复制，可发送" : "请长按上方链接复制";
  setMessage(copied ? "邀请链接已复制。" : "浏览器禁止自动复制，请手动复制链接。");
  window.setTimeout(() => (button.textContent = "复制邀请链接"), 1800);
});

const initialRoom = new URLSearchParams(window.location.search).get("room");
if (initialRoom) {
  (document.querySelector('[data-mode="online"]') as HTMLButtonElement).click();
  element<HTMLInputElement>("room-input").value = initialRoom;
  window.setTimeout(() => element("join-room").click(), 150);
}
