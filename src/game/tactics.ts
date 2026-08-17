import { isInCheck } from "./rules";
import type { GameState, Piece, Position } from "./types";

const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

function movedPiece(state: GameState): Piece | undefined {
  return state.pieces.find((piece) => piece.id === state.lastMove?.pieceId);
}

function detectsHorseBlock(state: GameState, moved: Piece): boolean {
  return state.pieces.some((horse) => {
    if (!horse.alive || horse.side === moved.side || horse.kind !== "horse") return false;
    return same(moved, { x: horse.x + Math.sign(moved.x - horse.x), y: horse.y }) ||
      same(moved, { x: horse.x, y: horse.y + Math.sign(moved.y - horse.y) });
  });
}

function detectsElephantEye(state: GameState, moved: Piece): boolean {
  return state.pieces.some((elephant) => {
    if (!elephant.alive || elephant.side === moved.side || elephant.kind !== "elephant") return false;
    return Math.abs(moved.x - elephant.x) === 1 && Math.abs(moved.y - elephant.y) === 1;
  });
}

export function detectNamedMove(previous: GameState, state: GameState): string | null {
  const move = state.lastMove;
  const piece = movedPiece(state);
  if (!move || !piece || move === previous.lastMove) return null;
  const dx = move.to.x - move.from.x;
  const dy = move.to.y - move.from.y;

  if (state.moveNumber <= 3) {
    if (piece.kind === "soldier" && [2, 6].includes(move.from.x) && Math.abs(dy) === 1) return "仙人指路";
    if (piece.kind === "elephant" && Math.abs(dx) === 2 && Math.abs(dy) === 2) return "飞相局";
    if (piece.kind === "horse") return "起马局";
    if (piece.kind === "cannon" && move.to.x === 4) return "当头炮";
    if (piece.kind === "cannon" && [3, 5].includes(move.to.x)) {
      return Math.abs(dx) >= 3 ? "过宫炮" : "士角炮";
    }
  }

  if (detectsHorseBlock(state, piece)) return "绊马腿";
  if (detectsElephantEye(state, piece)) return "拦相腰";
  if (!isInCheck(state, state.turn)) return null;

  const enemyGeneral = state.pieces.find((item) => item.alive && item.side === state.turn && item.kind === "general");
  if (!enemyGeneral) return null;
  const allies = state.pieces.filter((item) => item.alive && item.side === piece.side);
  const cannons = allies.filter((item) => item.kind === "cannon");
  const rooks = allies.filter((item) => item.kind === "rook");

  if (piece.kind === "cannon" && allies.some((item) =>
    item.kind === "horse" && item.x === piece.x &&
    Math.abs(item.y - enemyGeneral.y) < Math.abs(piece.y - enemyGeneral.y),
  )) return "马后炮";
  if (piece.kind === "cannon" && cannons.length >= 2 && cannons[0].x === cannons[1].x) return "重炮";
  if (piece.kind === "horse" && Math.abs(piece.x - enemyGeneral.x) === 1 && Math.abs(piece.y - enemyGeneral.y) === 2) return "卧槽马";
  if (piece.kind === "soldier" && Math.abs(piece.x - enemyGeneral.x) <= 1 && Math.abs(piece.y - enemyGeneral.y) <= 1) return "小鬼坐龙庭";
  if (rooks.length >= 2 && rooks.some((a) => rooks.some((b) => a.id !== b.id && (a.x === b.x || a.y === b.y)))) return "双车错";
  if (piece.kind === "rook" && cannons.some((cannon) => cannon.x === enemyGeneral.x)) return "铁门栓";

  const ownGeneral = allies.find((item) => item.kind === "general");
  if (ownGeneral?.x === enemyGeneral.x) return "白脸将";
  return null;
}
