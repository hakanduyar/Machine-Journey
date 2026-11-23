/**
 * Turns raw wheel / key / swipe input into at most ONE travel intent per deliberate
 * gesture. DOM-free so it can be tested with plain numbers (times in ms).
 *
 * Rules:
 *  - While a leg is travelling (`locked`) every input is discarded, but wheel events still
 *    refresh the quiet timer, so inertia that outlives the leg cannot start another one.
 *  - A wheel gesture only fires when it begins after a quiet gap (`quietMs`) with no wheel
 *    events at all; the rest of that gesture (including its inertia tail) is swallowed.
 *  - After a hold is reached, input is ignored for `settleMs` so a gesture that was already
 *    in flight cannot be mistaken for a fresh intent.
 *  - Held keys (auto-repeat) never fire; a swipe must have started while unlocked.
 */
export type Dir = -1 | 0 | 1;

/** Keys that request a journey leg: forward ArrowRight / Enter / Space, back ArrowLeft. Anything else: 0. */
export function keyDirection(key: string): Dir {
  return key === 'ArrowRight' || key === 'Enter' || key === ' ' ? 1 : key === 'ArrowLeft' ? -1 : 0;
}

export class IntentGate {
  readonly quietMs: number;
  readonly settleMs: number;
  readonly minSwipe: number;
  private lastWheelAt = -Infinity;
  private lockedUntil = -Infinity;
  private downOk = false;

  constructor(o: { quietMs?: number; settleMs?: number; minSwipe?: number } = {}) {
    this.quietMs = o.quietMs ?? 260;
    this.settleMs = o.settleMs ?? 350;
    this.minSwipe = o.minSwipe ?? 48;
  }

  /** Call when a hold has just been reached. */
  settle(t: number) { this.lockedUntil = t + this.settleMs; }

  private open(t: number, locked: boolean) { return !locked && t >= this.lockedUntil; }

  wheel(t: number, magnitude: number, locked: boolean): boolean {
    const quiet = t - this.lastWheelAt >= this.quietMs;
    this.lastWheelAt = t;
    return quiet && magnitude > 0 && this.open(t, locked);
  }

  key(t: number, repeat: boolean, locked: boolean): boolean {
    return !repeat && this.open(t, locked);
  }

  /**
   * Signed variants: 1 = forward, -1 = history back, 0 = no intent. They share ALL gating (quiet gap, settle, lock,
   * repeat, momentum) with the unsigned methods; only the direction of the firing input is added.
   *  - wheel: scroll down (deltaY > 0) / right (deltaX > 0) = forward; up / left = back. The dominant axis decides.
   *  - keys: ArrowRight / Enter / Space = forward, ArrowLeft = back.
   *  - swipe: vertical up / horizontal left = forward; down / right = back (the content follows the finger).
   */
  wheelDir(t: number, dx: number, dy: number, locked: boolean): Dir {
    if (!this.wheel(t, Math.abs(dx) + Math.abs(dy), locked)) return 0;
    const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    return d > 0 ? 1 : d < 0 ? -1 : 0;
  }

  keyDir(t: number, key: string, repeat: boolean, locked: boolean): Dir {
    const dir = keyDirection(key);
    if (dir === 0) return 0;
    return this.key(t, repeat, locked) ? dir : 0;
  }

  swipeDir(t: number, dx: number, dy: number, locked: boolean): Dir {
    if (!this.swipe(t, dx, dy, locked)) return 0;
    const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    return d < 0 ? 1 : -1;
  }

  pointerDown(t: number, locked: boolean) { this.downOk = this.open(t, locked); }

  /** Pointer released: fire for a deliberate swipe that began while unlocked. */
  swipe(t: number, dx: number, dy: number, locked: boolean): boolean {
    const ok = this.downOk;
    this.downOk = false;
    return ok && Math.hypot(dx, dy) >= this.minSwipe && this.open(t, locked);
  }
}
