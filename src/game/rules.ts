import type { GameState, Move, Piece, PieceKind, Position, Side } from "./types";

const BACK_ROW: PieceKind[] = [
  "rook",
  "horse",
  "elephant",
  "advisor",
  "general",
  "advisor",
  "elephant",
  "horse",
  "rook",
];

const otherSide = (side: Side): Side => (side === "red" ? "black" : "red");
const inside = ({ x, y }: Position) => x >= 0 && x < 9 && y >= 0 && y < 10;
const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

export function createInitialState(): GameState {
  const pieces: Piece[] = [];
  const add = (side: Side, kind: PieceKind, x: number, y: number) => {
    pieces.push({ id: `${side}-${kind}-${x}-${y}`, side, kind, x, y, alive: true });
  };

  BACK_ROW.forEach((kind, x) => {
    add("black", kind, x, 0);
    add("red", kind, x, 9);
  });
  [1, 7].forEach((x) => {
    add("black", "cannon", x, 2);
    add("red", "cannon", x, 7);
  });
  [0, 2, 4, 6, 8].forEach((x) => {
    add("black", "soldier", x, 3);
    add("red", "soldier", x, 6);
  });

  return {
    pieces,
    turn: "red",
    winner: null,
    result: null,
    lastMove: null,
    moveNumber: 1,
    skillUses: { red: {}, black: {} },
    activeSkill: null,
    blocked: null,
  };
}

export function pieceAt(state: GameState, position: Position): Piece | undefined {
  return state.pieces.find((piece) => piece.alive && samePosition(piece, position));
}

function countBetween(state: GameState, from: Position, to: Position): number {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  let count = 0;
  while (x !== to.x || y !== to.y) {
    if (pieceAt(state, { x, y })) count += 1;
    x += dx;
    y += dy;
  }
  return count;
}

function inPalace(side: Side, position: Position): boolean {
  const validY = side === "red" ? position.y >= 7 && position.y <= 9 : position.y >= 0 && position.y <= 2;
  return position.x >= 3 && position.x <= 5 && validY;
}

function pseudoLegal(state: GameState, piece: Piece, to: Position, attackOnly = false): boolean {
  if (!inside(to) || samePosition(piece, to)) return false;
  if (state.blocked && samePosition(state.blocked, to)) return false;
  const target = pieceAt(state, to);
  if (target?.side === piece.side) return false;

  const dx = to.x - piece.x;
  const dy = to.y - piece.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const from = { x: piece.x, y: piece.y };

  switch (piece.kind) {
    case "general": {
      if (target?.kind === "general" && piece.x === to.x && countBetween(state, from, to) === 0) return true;
      return inPalace(piece.side, to) && ax + ay === 1;
    }
    case "advisor":
      return inPalace(piece.side, to) && ax === 1 && ay === 1;
    case "elephant": {
      const staysHome = piece.side === "red" ? to.y >= 5 : to.y <= 4;
      const eye = { x: piece.x + dx / 2, y: piece.y + dy / 2 };
      return staysHome && ax === 2 && ay === 2 && !pieceAt(state, eye);
    }
    case "horse": {
      if (!((ax === 1 && ay === 2) || (ax === 2 && ay === 1))) return false;
      if (state.activeSkill?.kind === "horse" && state.activeSkill.pieceId === piece.id) return true;
      const leg = ax === 2
        ? { x: piece.x + Math.sign(dx), y: piece.y }
        : { x: piece.x, y: piece.y + Math.sign(dy) };
      return !pieceAt(state, leg);
    }
    case "rook":
      return (dx === 0 || dy === 0) && (
        countBetween(state, from, to) === 0 ||
        (state.activeSkill?.kind === "rook" && state.activeSkill.pieceId === piece.id && !!target && countBetween(state, from, to) === 1)
      );
    case "cannon": {
      if (dx !== 0 && dy !== 0) return false;
      const blockers = countBetween(state, from, to);
      const marked = state.activeSkill?.kind === "cannon" &&
        state.activeSkill.pieceId === piece.id &&
        state.activeSkill.targetId === target?.id;
      return target || attackOnly ? blockers === 1 || (!!target && marked && blockers === 0) : blockers === 0;
    }
    case "soldier": {
      const forward = piece.side === "red" ? -1 : 1;
      const crossed = piece.side === "red" ? piece.y <= 4 : piece.y >= 5;
      const empowered = state.activeSkill?.kind === "soldier" && state.activeSkill.pieceId === piece.id;
      return (dy === forward && dx === 0) || (crossed && dy === 0 && ax === 1) || (crossed && empowered && dy === forward && ax === 1);
    }
  }
}

function cloneAfterMove(state: GameState, piece: Piece, to: Position): GameState {
  const target = pieceAt(state, to);
  return {
    ...state,
    pieces: state.pieces.map((item) => {
      if (item.id === piece.id) return { ...item, x: to.x, y: to.y };
      if (item.id === target?.id) return { ...item, alive: false };
      return { ...item };
    }),
  };
}

export function isInCheck(state: GameState, side: Side): boolean {
  const general = state.pieces.find((piece) => piece.alive && piece.side === side && piece.kind === "general");
  if (!general) return true;
  return state.pieces.some(
    (piece) =>
      piece.alive &&
      piece.side !== side &&
      pseudoLegal(state, piece, { x: general.x, y: general.y }, true),
  );
}

export function legalMovesForPiece(state: GameState, pieceId: string): Move[] {
  const piece = state.pieces.find((item) => item.id === pieceId && item.alive);
  if (!piece || state.winner || piece.side !== state.turn) return [];
  const moves: Move[] = [];
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      const to = { x, y };
      if (!pseudoLegal(state, piece, to)) continue;
      const next = cloneAfterMove(state, piece, to);
      if (isInCheck(next, piece.side)) continue;
      moves.push({
        pieceId,
        from: { x: piece.x, y: piece.y },
        to,
        capturedId: pieceAt(state, to)?.id,
      });
    }
  }
  return moves;
}

export function allLegalMoves(state: GameState, side = state.turn): Move[] {
  if (side !== state.turn) state = { ...state, turn: side };
  return state.pieces
    .filter((piece) => piece.alive && piece.side === side)
    .flatMap((piece) => legalMovesForPiece(state, piece.id));
}

export function applyMove(state: GameState, move: Move): GameState {
  const piece = state.pieces.find((item) => item.id === move.pieceId && item.alive);
  if (!piece) return state;
  const legal = legalMovesForPiece(state, piece.id).find((candidate) => samePosition(candidate.to, move.to));
  if (!legal) return state;

  const captured = pieceAt(state, legal.to);
  const royalCommand = state.activeSkill?.kind === "general" && state.activeSkill.side === state.turn;
  const nextTurn = royalCommand ? state.turn : otherSide(state.turn);
  let next: GameState = {
    ...cloneAfterMove(state, piece, legal.to),
    turn: nextTurn,
    lastMove: legal,
    moveNumber: state.moveNumber + 1,
    winner: captured?.kind === "general" ? piece.side : null,
    result: captured?.kind === "general" ? "win" : null,
    activeSkill: null,
    blocked: null,
  };

  if (!next.winner && allLegalMoves(next).length === 0) {
    next = { ...next, winner: piece.side, result: "win" };
  }
  return next;
}

export function activateSkill(state: GameState, pieceId: string, targetId?: string): GameState {
  const piece = state.pieces.find((item) => item.id === pieceId && item.alive);
  if (!piece || piece.side !== state.turn || state.winner || state.result || state.skillUses[piece.side][piece.kind]) return state;
  const used = {
    ...state.skillUses,
    [piece.side]: { ...state.skillUses[piece.side], [piece.kind]: true },
  };

  if (piece.kind === "advisor") {
    const general = state.pieces.find((item) => item.alive && item.side === piece.side && item.kind === "general");
    if (!general) return state;
    const pieces = state.pieces.map((item) => {
      if (item.id === piece.id) return { ...item, x: general.x, y: general.y };
      if (item.id === general.id) return { ...item, x: piece.x, y: piece.y };
      return item;
    });
    const swapped = { ...state, pieces, skillUses: used, turn: otherSide(state.turn), moveNumber: state.moveNumber + 1 };
    return isInCheck(swapped, piece.side) ? state : swapped;
  }

  if (piece.kind === "elephant") {
    const forward = piece.side === "red" ? -1 : 1;
    return {
      ...state,
      skillUses: used,
      blocked: { x: piece.x, y: Math.max(0, Math.min(9, piece.y + forward)) },
      turn: otherSide(state.turn),
      moveNumber: state.moveNumber + 1,
    };
  }

  if (piece.kind === "cannon") {
    const target = state.pieces.find((item) => item.id === targetId && item.alive && item.side !== piece.side);
    if (!target) return state;
    return { ...state, skillUses: used, activeSkill: { side: piece.side, kind: piece.kind, pieceId, targetId } };
  }

  return { ...state, skillUses: used, activeSkill: { side: piece.side, kind: piece.kind, pieceId } };
}

export function isLegalMove(state: GameState, move: Move): boolean {
  return legalMovesForPiece(state, move.pieceId).some((candidate) => samePosition(candidate.to, move.to));
}
