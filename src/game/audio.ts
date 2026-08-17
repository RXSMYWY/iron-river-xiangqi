import type { PieceKind } from "./types";

export class BattleAudio {
  private enabled = true;
  private activeVoice: HTMLAudioElement | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private play(path: string, volume = 0.75, rate = 1): HTMLAudioElement | null {
    if (!this.enabled) return null;
    const audio = new Audio(path);
    audio.volume = volume;
    audio.playbackRate = rate;
    void audio.play().catch(() => undefined);
    return audio;
  }

  pieceMove(kind: PieceKind): void {
    const effects: Record<PieceKind, [string, number]> = {
      general: ["impact", 0.82],
      advisor: ["war-whoosh", 1.18],
      elephant: ["impact", 0.72],
      horse: ["war-whoosh", 1.28],
      rook: ["impact", 0.62],
      cannon: ["cannon", 1.1],
      soldier: ["war-whoosh", 1.42],
    };
    const [effect, rate] = effects[kind];
    this.play(`/audio/sfx/${effect}.mp3`, 0.36, rate);
    this.voice(`move-${kind}`);
  }

  skill(name: string): void {
    this.play("/audio/sfx/cannon.mp3", 0.62, 0.78);
    window.setTimeout(() => this.voice(`skill-${name}`), 140);
  }

  namedMove(name: string): void {
    this.play("/audio/sfx/war-whoosh.mp3", 0.42, 0.85);
    window.setTimeout(() => this.voice(`move-${name}`), 90);
  }

  private voice(key: string): void {
    this.activeVoice?.pause();
    this.activeVoice = this.play(`/audio/voice/${key}.mp3`, 0.95, 1);
  }

  capture(critical = false): void {
    this.play(critical ? "/audio/sfx/cannon.mp3" : "/audio/sfx/impact.mp3", critical ? 1 : 0.72, critical ? 0.62 : 0.9);
  }

  check(): void {
    this.play("/audio/sfx/cannon.mp3", 0.54, 1.24);
  }

  victory(): void {
    this.play("/audio/sfx/cannon.mp3", 0.9, 0.68);
  }
}
