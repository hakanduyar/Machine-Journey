/**
 * Pure city-label layout for the globe (no DOM). The active destination always wins and stays inside the viewport;
 * peripheral labels are prioritised front-most first, capped, kept inside the viewport and dropped when they would
 * collide. City geography positions are never moved.
 */
export interface LabelCity { id: string; name: string; x: number; y: number; z: number }
export interface LabelBox { x: number; y: number; w: number; h: number }
export interface LabelPlan {
  id: string; text: string; x: number; y: number; align: 'left' | 'right' | 'center'; hot: boolean; box: LabelBox;
}
export interface LabelOpts {
  w: number; h: number; R: number; destId: string | null;
  /** font px of normal / hot label and extra swell (px) of the hot label during entry */
  base: number; hotBase: number; swell: number;
  measure: (text: string, px: number, hot: boolean) => number;
  /** Height (px) of the DOM footer band at the bottom (hint + disclosure): no label may sit in it. 0 / absent: none. */
  reserveBottom?: number;
}

const MARGIN = 8;
const hit = (a: LabelBox, b: LabelBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function layoutLabels(cities: readonly LabelCity[], o: LabelOpts): LabelPlan[] {
  const phone = o.w < 520;
  const plans: LabelPlan[] = [];
  const taken: LabelBox[] = [];
  const hot = cities.find((c) => c.id === o.destId && c.z > 0.05);
  if (hot) {
    const px = o.hotBase + o.swell;
    const text = hot.name.toUpperCase();
    const tw = o.measure(text, px, true);
    const lo = MARGIN + tw / 2; const hi = Math.max(lo, o.w - MARGIN - tw / 2);
    const x = Math.min(hi, Math.max(lo, hot.x));
    const floor = o.h - (o.reserveBottom ?? 0) - px / 2; // the active label keeps priority but is clamped clear of the footer
    const y = Math.min(floor, hot.y - Math.max(16, o.R * 0.05) - o.swell * 0.3);
    const box = { x: x - tw / 2, y: y - px / 2, w: tw, h: px };
    plans.push({ id: hot.id, text, x, y, align: 'center', hot: true, box });
    taken.push(box, { x: hot.x - 10, y: hot.y - 10, w: 20, h: 20 });
  }
  const limit = phone ? 4 : 10;
  const minZ = phone ? 0.5 : 0.05;
  const rest = cities.filter((c) => c.id !== o.destId && c.z > minZ).sort((a, b) => b.z - a.z);
  let placed = 0;
  for (const c of rest) {
    if (placed >= limit) break;
    const text = c.name.toUpperCase();
    const tw = o.measure(text, o.base, false);
    const off = Math.max(8, o.R * 0.03) + 4;
    const tries: ('left' | 'right')[] = ['left', 'right'];
    for (const align of tries) {
      const x0 = align === 'left' ? c.x + off : c.x - off - tw;
      if (x0 < MARGIN || x0 + tw > o.w - MARGIN) continue;
      const box = { x: x0, y: c.y - o.base / 2, w: tw, h: o.base };
      if (box.y + box.h > o.h - (o.reserveBottom ?? 0)) continue;
      if (taken.some((t) => hit(t, box))) continue;
      plans.push({ id: c.id, text, x: align === 'left' ? x0 : x0 + tw, y: c.y, align, hot: false, box });
      taken.push(box, { x: c.x - 6, y: c.y - 6, w: 12, h: 12 });
      placed++;
      break;
    }
  }
  return plans;
}
