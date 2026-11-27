import { mulberry32 } from './layout';
/** Fresh destinations only: peek/prewarm/retry and history never consume a slot. */
export class CityBag {
  private remaining: string[] = [];
  private last: string | null = null;
  private rng: () => number;
  constructor(private readonly ids: readonly string[], seed: number) { this.rng = mulberry32(seed ^ 0x43a9b17); }
  peek(available: ReadonlySet<string>, current: string | null, avoid: ReadonlySet<string> = new Set()): string | null {
    if (!this.remaining.some(id => available.has(id))) {
      this.remaining = [...this.ids];
      for (let i = this.remaining.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [this.remaining[i], this.remaining[j]] = [this.remaining[j], this.remaining[i]]; }
      if (this.remaining[0] === this.last && this.remaining.length > 1) [this.remaining[0], this.remaining[1]] = [this.remaining[1], this.remaining[0]];
    }
    const candidates = this.remaining.filter(id => available.has(id));
    return candidates.find(id => id !== current && id !== this.last && !avoid.has(id)) ?? candidates.find(id => id !== current && id !== this.last) ?? candidates.find(id => id !== current) ?? candidates[0] ?? null;
  }
  arrive(id: string) { const i = this.remaining.indexOf(id); if (i >= 0) { this.remaining.splice(i, 1); this.last = id; } }
}
