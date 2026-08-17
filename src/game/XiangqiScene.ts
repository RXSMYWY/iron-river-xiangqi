import Phaser from "phaser";
import { isInCheck, legalMovesForPiece } from "./rules";
import type { GameState, Move, Piece, PieceKind, Position, Side } from "./types";

const LABELS: Record<Side, Record<PieceKind, string>> = {
  red: { general: "帅", advisor: "仕", elephant: "相", horse: "马", rook: "车", cannon: "炮", soldier: "兵" },
  black: { general: "将", advisor: "士", elephant: "象", horse: "马", rook: "车", cannon: "炮", soldier: "卒" },
};

const KILL_WORDS: Partial<Record<PieceKind, string>> = {
  general: "斩 将",
  rook: "折 戟",
  cannon: "破 阵",
  horse: "断 骑",
};

const BOARD = { left: 92, top: 58, cell: 72, width: 576, height: 648 };

export class XiangqiScene extends Phaser.Scene {
  private state: GameState | null = null;
  private previousState: GameState | null = null;
  private moveHandler: (move: Move) => void = () => undefined;
  private selectionHandler: (piece: Piece | null) => void = () => undefined;
  private selectedId: string | null = null;
  private perspective: Side = "red";
  private canInteract = true;
  private boardLayer!: Phaser.GameObjects.Container;
  private pieceLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;

  constructor() {
    super("xiangqi");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#080705");
    this.boardLayer = this.add.container();
    this.pieceLayer = this.add.container();
    this.fxLayer = this.add.container();
    this.drawBackdrop();
    this.drawBoard();
    this.events.emit("scene-ready");
  }

  setPerspective(side: Side): void {
    this.perspective = side;
    this.selectedId = null;
    this.renderState();
  }

  setInteractiveTurn(enabled: boolean): void {
    this.canInteract = enabled;
  }

  setMoveHandler(handler: (move: Move) => void): void {
    this.moveHandler = handler;
  }

  setSelectionHandler(handler: (piece: Piece | null) => void): void {
    this.selectionHandler = handler;
  }

  announceNamedMove(name: string): void {
    this.cinematicText(name, "#fff0bd", 950);
  }

  syncState(state: GameState): void {
    this.previousState = this.state;
    this.state = state;
    this.selectedId = null;
    this.selectionHandler(null);
    this.renderState();
    this.playTransitionEffects();
  }

  private screenPosition(position: Position): Position {
    const x = this.perspective === "red" ? position.x : 8 - position.x;
    const y = this.perspective === "red" ? position.y : 9 - position.y;
    return { x: BOARD.left + x * BOARD.cell, y: BOARD.top + y * BOARD.cell };
  }

  private drawBackdrop(): void {
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0x120d08, 0x120d08, 0x050504, 0x050504, 1);
    graphics.fillRect(0, 0, 760, 770);
    for (let i = 0; i < 36; i += 1) {
      graphics.fillStyle(0xb68132, Phaser.Math.FloatBetween(0.02, 0.08));
      graphics.fillCircle(Phaser.Math.Between(20, 740), Phaser.Math.Between(10, 760), Phaser.Math.Between(1, 3));
    }
    this.boardLayer.add(graphics);
  }

  private drawBoard(): void {
    const g = this.add.graphics();
    g.fillStyle(0x20150d, 0.98);
    g.fillRoundedRect(38, 14, 684, 734, 18);
    g.lineStyle(2, 0x8d642d, 0.85);
    g.strokeRoundedRect(43, 19, 674, 724, 16);
    g.fillStyle(0xa97736, 0.16);
    g.fillRect(BOARD.left - 24, BOARD.top - 24, BOARD.width + 48, BOARD.height + 48);

    g.lineStyle(2, 0xc69a55, 0.72);
    for (let row = 0; row <= 9; row += 1) {
      g.lineBetween(BOARD.left, BOARD.top + row * BOARD.cell, BOARD.left + BOARD.width, BOARD.top + row * BOARD.cell);
    }
    for (let col = 0; col <= 8; col += 1) {
      const x = BOARD.left + col * BOARD.cell;
      g.lineBetween(x, BOARD.top, x, BOARD.top + 4 * BOARD.cell);
      g.lineBetween(x, BOARD.top + 5 * BOARD.cell, x, BOARD.top + BOARD.height);
    }
    g.lineBetween(BOARD.left + 3 * BOARD.cell, BOARD.top, BOARD.left + 5 * BOARD.cell, BOARD.top + 2 * BOARD.cell);
    g.lineBetween(BOARD.left + 5 * BOARD.cell, BOARD.top, BOARD.left + 3 * BOARD.cell, BOARD.top + 2 * BOARD.cell);
    g.lineBetween(BOARD.left + 3 * BOARD.cell, BOARD.top + 7 * BOARD.cell, BOARD.left + 5 * BOARD.cell, BOARD.top + 9 * BOARD.cell);
    g.lineBetween(BOARD.left + 5 * BOARD.cell, BOARD.top + 7 * BOARD.cell, BOARD.left + 3 * BOARD.cell, BOARD.top + 9 * BOARD.cell);
    this.boardLayer.add(g);

    const river = this.add
      .text(380, BOARD.top + 4.5 * BOARD.cell, this.perspective === "red" ? "楚 河     汉 界" : "汉 界     楚 河", {
        fontFamily: "\"Noto Serif SC\", \"Songti SC\", serif",
        fontSize: "27px",
        color: "#d2aa68",
        letterSpacing: 8,
      })
      .setOrigin(0.5);
    this.boardLayer.add(river);
  }

  private renderState(): void {
    if (!this.pieceLayer || !this.state) return;
    this.pieceLayer.removeAll(true);
    for (const piece of this.state.pieces.filter((item) => item.alive)) {
      this.pieceLayer.add(this.createPiece(piece));
    }
    if (this.selectedId) this.renderMoves(this.selectedId);
    if (this.state.lastMove) {
      const p = this.screenPosition(this.state.lastMove.to);
      const glow = this.add.circle(p.x, p.y, 31, 0xffffff, 0.18).setStrokeStyle(3, 0xffffff, 0.92);
      this.tweens.add({ targets: glow, alpha: 0.35, scale: 1.1, duration: 650, yoyo: true, repeat: -1 });
      this.pieceLayer.addAt(glow, 0);
    }
  }

  private createPiece(piece: Piece): Phaser.GameObjects.Container {
    const position = this.screenPosition(piece);
    const container = this.add.container(position.x, position.y);
    const isRed = piece.side === "red";
    const shadow = this.add.circle(3, 6, 28, 0x000000, 0.55);
    const rim = this.add.circle(0, 0, 30, isRed ? 0x7f1f18 : 0x141414);
    const body = this.add.circle(0, 0, 25, isRed ? 0xe4c28c : 0xc3a16f);
    const inner = this.add.circle(0, 0, 21).setStrokeStyle(2, isRed ? 0xa32920 : 0x24201a, 0.9);
    const text = this.add
      .text(0, -1, LABELS[piece.side][piece.kind], {
        fontFamily: "\"Noto Serif SC\", \"Songti SC\", serif",
        fontSize: "29px",
        fontStyle: "bold",
        color: isRed ? "#98241c" : "#191714",
      })
      .setOrigin(0.5);
    container.add([shadow, rim, body, inner, text]);
    container.setSize(64, 64).setInteractive({ useHandCursor: true });
    container.on("pointerover", () => container.setScale(1.07));
    container.on("pointerout", () => container.setScale(1));
    container.on("pointerdown", () => this.handlePieceClick(piece));
    return container;
  }

  private handlePieceClick(piece: Piece): void {
    if (!this.state || !this.canInteract || this.state.winner) return;
    if (piece.side === this.state.turn) {
      this.selectedId = piece.id;
      this.selectionHandler(piece);
      this.renderState();
      return;
    }
    if (this.selectedId) this.tryMove({ x: piece.x, y: piece.y });
  }

  private renderMoves(pieceId: string): void {
    if (!this.state) return;
    const selected = this.state.pieces.find((piece) => piece.id === pieceId);
    if (selected) {
      const p = this.screenPosition(selected);
      const ring = this.add.circle(p.x, p.y, 35).setStrokeStyle(3, 0xf3c45f, 0.95);
      this.pieceLayer.addAt(ring, 0);
    }

    for (const move of legalMovesForPiece(this.state, pieceId)) {
      const p = this.screenPosition(move.to);
      const target = this.state.pieces.find((piece) => piece.alive && piece.x === move.to.x && piece.y === move.to.y);
      const marker = target
        ? this.add.circle(p.x, p.y, 34).setStrokeStyle(4, 0xd4422e, 0.9)
        : this.add.circle(p.x, p.y, 8, 0xf0bd58, 0.8);
      marker.setInteractive({ useHandCursor: true });
      marker.on("pointerdown", () => this.tryMove(move.to));
      this.pieceLayer.add(marker);
    }
  }

  private tryMove(to: Position): void {
    if (!this.state || !this.selectedId) return;
    const move = legalMovesForPiece(this.state, this.selectedId).find((item) => item.to.x === to.x && item.to.y === to.y);
    if (move) this.moveHandler(move);
  }

  private playTransitionEffects(): void {
    const move = this.state?.lastMove;
    if (!move || move === this.previousState?.lastMove) return;
    const captured = this.previousState?.pieces.find((piece) => piece.id === move.capturedId);
    const position = this.screenPosition(move.to);
    if (captured) this.captureEffect(position, captured.kind);
    if (this.state && isInCheck(this.state, this.state.turn) && !this.state.winner) {
      this.cinematicText("将 军", "#f1c164", 600);
      this.cameras.main.shake(240, 0.006);
    }
    if (this.state?.winner) {
      this.time.delayedCall(450, () => this.victoryEffect(this.state!.winner!));
    }
  }

  private captureEffect(position: Position, kind: PieceKind): void {
    const critical = kind === "general";
    const important = critical || kind === "rook" || kind === "cannon";
    const count = critical ? 68 : important ? 40 : 22;
    this.cameras.main.shake(critical ? 700 : 260, critical ? 0.025 : 0.01);
    this.cameras.main.flash(critical ? 420 : 120, 220, critical ? 35 : 120, 20);

    for (let i = 0; i < count; i += 1) {
      const spark = this.add.rectangle(position.x, position.y, Phaser.Math.Between(3, 8), Phaser.Math.Between(10, 28), i % 3 === 0 ? 0xf8dc8a : 0xd13a23);
      spark.setRotation(Phaser.Math.FloatBetween(-Math.PI, Math.PI));
      this.fxLayer.add(spark);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(70, critical ? 300 : 170);
      this.tweens.add({
        targets: spark,
        x: position.x + Math.cos(angle) * distance,
        y: position.y + Math.sin(angle) * distance,
        alpha: 0,
        angle: Phaser.Math.Between(-300, 300),
        duration: Phaser.Math.Between(380, critical ? 1100 : 700),
        ease: "Cubic.Out",
        onComplete: () => spark.destroy(),
      });
    }

    const shockwave = this.add.circle(position.x, position.y, 18).setStrokeStyle(7, 0xf5c563, 0.9);
    this.fxLayer.add(shockwave);
    this.tweens.add({
      targets: shockwave,
      scale: critical ? 12 : 6,
      alpha: 0,
      duration: critical ? 900 : 450,
      ease: "Quad.Out",
      onComplete: () => shockwave.destroy(),
    });
    if (KILL_WORDS[kind]) this.cinematicText(KILL_WORDS[kind]!, critical ? "#fff0bc" : "#f0c16a", critical ? 1200 : 700);
  }

  private cinematicText(text: string, color: string, duration: number): void {
    const title = this.add
      .text(380, 360, text, {
        fontFamily: "\"Noto Serif SC\", \"Songti SC\", serif",
        fontSize: text === "斩 将" ? "104px" : "76px",
        fontStyle: "bold",
        color,
        stroke: "#250805",
        strokeThickness: 12,
        shadow: { color: "#d62f1f", blur: 22, fill: true, offsetX: 0, offsetY: 0 },
      })
      .setOrigin(0.5)
      .setScale(1.8)
      .setAlpha(0)
      .setDepth(100);
    this.fxLayer.add(title);
    this.tweens.add({
      targets: title,
      scale: 1,
      alpha: 1,
      duration: 170,
      ease: "Back.Out",
      yoyo: true,
      hold: duration,
      onComplete: () => title.destroy(),
    });
  }

  private victoryEffect(winner: Side): void {
    const text = winner === "red" ? "红 方 破 阵" : "黑 方 镇 关";
    this.cameras.main.flash(700, winner === "red" ? 160 : 230, 30, 10);
    this.cinematicText(text, "#ffe0a0", 2200);
  }
}
