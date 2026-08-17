export type Side = "red" | "black";
export type PieceKind = "general" | "advisor" | "elephant" | "horse" | "rook" | "cannon" | "soldier";

export interface Piece {
  id: string;
  side: Side;
  kind: PieceKind;
  x: number;
  y: number;
  alive: boolean;
}

export interface Position {
  x: number;
  y: number;
}

export interface Move {
  pieceId: string;
  from: Position;
  to: Position;
  capturedId?: string;
}

export interface GameState {
  pieces: Piece[];
  turn: Side;
  winner: Side | null;
  result: "win" | "draw" | "timeout" | null;
  lastMove: Move | null;
  moveNumber: number;
  skillUses: Record<Side, Partial<Record<PieceKind, boolean>>>;
  activeSkill: { side: Side; kind: PieceKind; pieceId: string; targetId?: string } | null;
  blocked: Position | null;
}

export type GameMode = "ai" | "local" | "online";
