import { allLegalMoves, applyMove, isInCheck } from "./rules";
import type { GameState, Move, PieceKind, Side } from "./types";

const VALUE: Record<PieceKind, number> = {
  general: 100_000,
  rook: 900,
  cannon: 450,
  horse: 420,
  elephant: 200,
  advisor: 200,
  soldier: 100,
};

function evaluate(state: GameState, side: Side): number {
  if (state.winner) return state.winner === side ? 1_000_000 : -1_000_000;
  let score = 0;
  for (const piece of state.pieces) {
    if (!piece.alive) continue;
    let value = VALUE[piece.kind];
    if (piece.kind === "soldier") {
      const advanced = piece.side === "red" ? 6 - piece.y : piece.y - 3;
      value += Math.max(0, advanced) * 18;
    }
    if (piece.kind === "horse" || piece.kind === "cannon") {
      value += (4 - Math.abs(4 - piece.x)) * 5;
    }
    score += piece.side === side ? value : -value;
  }
  if (isInCheck(state, side)) score -= 45;
  if (isInCheck(state, side === "red" ? "black" : "red")) score += 45;
  return score;
}

function orderMoves(state: GameState, moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    const aPiece = state.pieces.find((piece) => piece.id === a.capturedId);
    const bPiece = state.pieces.find((piece) => piece.id === b.capturedId);
    return (bPiece ? VALUE[bPiece.kind] : 0) - (aPiece ? VALUE[aPiece.kind] : 0);
  });
}

function minimax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  maximizingSide: Side,
): number {
  if (depth === 0 || state.winner) return evaluate(state, maximizingSide);
  const moves = orderMoves(state, allLegalMoves(state));
  if (moves.length === 0) return evaluate(state, maximizingSide);
  const maximizing = state.turn === maximizingSide;

  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      best = Math.max(best, minimax(applyMove(state, move), depth - 1, alpha, beta, maximizingSide));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    best = Math.min(best, minimax(applyMove(state, move), depth - 1, alpha, beta, maximizingSide));
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseAiMove(state: GameState, depth = 2): Move | null {
  const moves = orderMoves(state, allLegalMoves(state));
  if (moves.length === 0) return null;
  let bestScore = -Infinity;
  let candidates: Move[] = [];

  for (const move of moves) {
    const score = minimax(applyMove(state, move), depth - 1, -Infinity, Infinity, state.turn);
    if (score > bestScore) {
      bestScore = score;
      candidates = [move];
    } else if (score === bestScore) {
      candidates.push(move);
    }
  }
  return candidates[Math.floor(Math.random() * candidates.length)] ?? moves[0];
}
