/**
 * Death Replay System
 * 
 * Continuously records a rolling buffer of camera snapshots (player position,
 * playerUp, rotation) during gameplay. When the player dies, the buffer is
 * frozen and played back in slow motion while the death screen fades in.
 */

export interface ReplayFrame {
  px: number; py: number; pz: number;   // player position
  ux: number; uy: number; uz: number;   // playerUp vector
  rz: number;                            // rotation.z
  timestamp: number;                     // Date.now() when recorded
}

/** Duration of replay buffer in seconds */
const BUFFER_DURATION = 5;
/** Assume ~60fps recording, store enough frames */
const MAX_FRAMES = BUFFER_DURATION * 80; // slightly over to handle variance

/** How long the replay plays (seconds) — slowed down for dramatic effect */
const REPLAY_PLAYBACK_DURATION = 4;

/** How long the death overlay takes to fully fade in (seconds) */
const FADE_IN_DURATION = 4;

class DeathReplayStore {
  // --- Recording ---
  private buffer: ReplayFrame[] = [];
  private writeIndex = 0;
  private frameCount = 0;

  // --- Playback ---
  /** Whether we're currently in death-replay mode */
  active = $state(false);
  /** 0..1 progress through the replay */
  progress = $state(0);
  /** 0..1 opacity for the death overlay */
  overlayOpacity = $state(0);

  private frozenBuffer: ReplayFrame[] = [];
  private frozenLength = 0;
  private replayStartTime = 0;
  private replayDuration = REPLAY_PLAYBACK_DURATION * 1000;
  private fadeDuration = FADE_IN_DURATION * 1000;

  /** Current interpolated replay position (read by FollowCamera) */
  replayPosition = $state<{ x: number; y: number; z: number; } | null>(null);
  replayUp = $state<{ x: number; y: number; z: number; } | null>(null);

  /** Record a frame into the rolling buffer */
  record(px: number, py: number, pz: number, ux: number, uy: number, uz: number, rz: number): void {
    if (this.active) return; // Don't record during replay

    const frame: ReplayFrame = {
      px, py, pz,
      ux, uy, uz,
      rz,
      timestamp: Date.now()
    };

    if (this.buffer.length < MAX_FRAMES) {
      this.buffer.push(frame);
    } else {
      this.buffer[this.writeIndex] = frame;
    }
    this.writeIndex = (this.writeIndex + 1) % MAX_FRAMES;
    this.frameCount = Math.min(this.frameCount + 1, MAX_FRAMES);
  }

  /** Freeze the buffer and start replay playback */
  startReplay(): void {
    if (this.frameCount === 0) {
      // No frames recorded, skip replay
      this.active = false;
      return;
    }

    // Copy buffer in chronological order
    this.frozenLength = this.frameCount;
    this.frozenBuffer = [];

    if (this.frameCount < MAX_FRAMES) {
      // Buffer hasn't wrapped yet
      for (let i = 0; i < this.frameCount; i++) {
        this.frozenBuffer.push(this.buffer[i]);
      }
    } else {
      // Buffer has wrapped — read from writeIndex (oldest) forward
      for (let i = 0; i < MAX_FRAMES; i++) {
        this.frozenBuffer.push(this.buffer[(this.writeIndex + i) % MAX_FRAMES]);
      }
    }

    this.active = true;
    this.progress = 0;
    this.overlayOpacity = 0;
    this.replayStartTime = Date.now();
  }

  /**
   * Tick the replay each frame. Returns true while replay is active.
   * Call from the game loop (useTask).
   */
  tick(): boolean {
    if (!this.active) return false;

    const elapsed = Date.now() - this.replayStartTime;

    // Progress through the replay
    this.progress = Math.min(elapsed / this.replayDuration, 1);

    // Overlay fades in starting from 30% of the way through the replay
    const fadeStart = this.replayDuration * 0.3;
    if (elapsed > fadeStart) {
      this.overlayOpacity = Math.min((elapsed - fadeStart) / this.fadeDuration, 1);
    } else {
      this.overlayOpacity = 0;
    }

    // Interpolate position from buffer
    const bufferT = this.progress; // 0..1 through the frozen buffer
    const floatIndex = bufferT * (this.frozenLength - 1);
    const i0 = Math.floor(floatIndex);
    const i1 = Math.min(i0 + 1, this.frozenLength - 1);
    const frac = floatIndex - i0;

    const f0 = this.frozenBuffer[i0];
    const f1 = this.frozenBuffer[i1];

    if (f0 && f1) {
      this.replayPosition = {
        x: f0.px + (f1.px - f0.px) * frac,
        y: f0.py + (f1.py - f0.py) * frac,
        z: f0.pz + (f1.pz - f0.pz) * frac
      };
      this.replayUp = {
        x: f0.ux + (f1.ux - f0.ux) * frac,
        y: f0.uy + (f1.uy - f0.uy) * frac,
        z: f0.uz + (f1.uz - f0.uz) * frac
      };
    }

    // Replay finished — keep overlay up, stop interpolating
    if (this.progress >= 1) {
      this.overlayOpacity = 1;
      return true; // Stay active, death screen handles the rest
    }

    return true;
  }

  /** Reset replay state (call when leaving death screen) */
  reset(): void {
    this.active = false;
    this.progress = 0;
    this.overlayOpacity = 0;
    this.replayPosition = null;
    this.replayUp = null;
    this.frozenBuffer = [];
    this.frozenLength = 0;
    // Keep recording buffer intact for next death
  }

  /** Full reset including recording buffer (call on game start) */
  fullReset(): void {
    this.reset();
    this.buffer = [];
    this.writeIndex = 0;
    this.frameCount = 0;
  }
}

export const deathReplay = new DeathReplayStore();
