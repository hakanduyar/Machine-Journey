import { describe, expect, it } from 'vitest';
import { ARCS, CITIES, cityById, project } from '../../src/journey/globe';
import {
  ROUTE_LIFT, buildCityLights, buildCoast, buildRoutes, collectFrontRuns, lodForRadius, lonLatToXYZ, rotate, viewBasis,
} from '../../src/journey/globeGeo';
import { layoutLabels } from '../../src/journey/globeLabels';

describe('precomputed xyz projection', () => {
  it('matches project() for arbitrary points and aims', () => {
    for (const [lon, lat, l0, p0] of [[10, 50, -20, 30], [-120, -33, 140, -10], [179, 5, -179, 80], [0, 0, 0, 0]]) {
      const [X, Y, Z] = lonLatToXYZ(lon, lat);
      const a = rotate(viewBasis(l0, p0), X, Y, Z); const b = project(lon, lat, l0, p0);
      expect(a[0]).toBeCloseTo(b.x, 6); expect(a[1]).toBeCloseTo(b.y, 6); expect(a[2]).toBeCloseTo(b.z, 6);
    }
  });
});

describe('coastline polylines', () => {
  // two parts: one facing the viewer, one on the far side; plus a degenerate part
  const parts = [
    [[0, 0], [5, 0], [5, 5], [0, 5]],
    [[180, 0], [175, 0], [175, 5]],
    [[10, 10]],
  ];
  const geo = buildCoast(parts);

  it('keeps part boundaries, drops degenerate parts and never closes a polyline', () => {
    const lod = geo.lods[0];
    expect(lod.starts.length).toBe(3); // 2 parts + sentinel
    expect(lod.vertices).toBe(7); // 4 + 3; the one-point part is dropped, nothing appended to close
    expect(lod.starts[1]).toBe(4);
  });

  it('front runs never contain back-facing vertices and never join parts', () => {
    const r = collectFrontRuns(geo.lods[0], viewBasis(2, 2), 500, 400, 300, 1000, 800);
    expect(r.runCount).toBe(1); // only the near part is visible
    expect(r.hidden).toBe(3); // the far part was skipped, not chorded
    expect(r.runs[1] - r.runs[0]).toBe(4);
    // far part visible instead: exactly one run again, still separate
    const far = collectFrontRuns(geo.lods[0], viewBasis(178, 2), 500, 400, 300, 1000, 800);
    expect(far.runCount).toBe(1);
  });

  it('a run is broken where the line passes behind the limb', () => {
    const g = buildCoast([[[-60, 0], [-30, 0], [0, 0], [30, 0], [60, 0], [90, 0], [120, 0]]]);
    const r = collectFrontRuns(g.lods[0], viewBasis(0, 0), 0, 0, 100, 400, 400);
    expect(r.hidden).toBeGreaterThan(0);
    for (let i = 0; i < r.runs[r.runCount] * 2; i += 2) expect(Math.hypot(r.pts[i], r.pts[i + 1])).toBeLessThanOrEqual(100.001);
  });

  it('coarser levels have fewer vertices, preserve part endpoints and radius picks the level', () => {
    const line = Array.from({ length: 40 }, (_, i) => [i, 10]);
    const g = buildCoast([line]);
    expect(g.lods[1].vertices).toBeLessThan(g.lods[0].vertices);
    expect(g.lods[2].vertices).toBeLessThan(g.lods[1].vertices);
    const last = lonLatToXYZ(39, 10);
    const lod = g.lods[2];
    expect(lod.xyz[(lod.vertices - 1) * 3]).toBeCloseTo(last[0], 5);
    expect(lodForRadius(50)).toBe(2); expect(lodForRadius(180)).toBe(1); expect(lodForRadius(400)).toBe(0);
  });
});

describe('authored lights and routes', () => {
  it('are deterministic, clustered with uneven sizes (not equal dots)', () => {
    const a = buildCityLights(CITIES); const b = buildCityLights(CITIES);
    expect(Array.from(a[0].xyz)).toEqual(Array.from(b[0].xyz));
    expect(a[0].alpha.length).toBeGreaterThan(100);
    expect(new Set(Array.from(a[0].size).map((s) => s.toFixed(2))).size).toBeGreaterThan(20);
  });

  it('routes are grouped bundles that hug the surface and converge on their cities', () => {
    const routes = buildRoutes(ARCS, cityById);
    expect(routes.length).toBe(ARCS.length);
    for (const r of routes) {
      expect(r.lines.length).toBeGreaterThanOrEqual(3);
      const ca = cityById(r.a)!; const [ax, ay, az] = lonLatToXYZ(ca.lon, ca.lat);
      for (const l of r.lines) {
        expect(l[0]).toBeCloseTo(ax, 5); expect(l[1]).toBeCloseTo(ay, 5); expect(l[2]).toBeCloseTo(az, 5);
        for (let i = 0; i < l.length; i += 3) expect(Math.hypot(l[i], l[i + 1], l[i + 2])).toBeLessThanOrEqual(1 + ROUTE_LIFT + 1e-6);
      }
    }
  });
});

describe('label layout', () => {
  const measure = (t: string, px: number) => t.length * px * 0.62;
  const cities = CITIES.map((c, i) => ({ id: c.id, name: c.name, x: 20 + i * 36, y: 300 + (i % 3) * 8, z: 0.9 - i * 0.05 }));

  it('portrait 390px: every label stays inside the viewport, few and non-overlapping; the active one is present', () => {
    const plans = layoutLabels(cities, { w: 390, h: 844, R: 150, destId: 'tokyo', base: 10, hotBase: 13, swell: 0, measure });
    expect(plans.some((p) => p.id === 'tokyo' && p.hot)).toBe(true);
    expect(plans.length).toBeLessThanOrEqual(5);
    for (const p of plans) { expect(p.box.x).toBeGreaterThanOrEqual(8 - 1e-6); expect(p.box.x + p.box.w).toBeLessThanOrEqual(382 + 1e-6); }
    for (let i = 0; i < plans.length; i++) for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i].box; const b = plans[j].box;
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }
  });

  it('the active label is clamped inside the viewport even when its city sits at the edge, and while swelling', () => {
    const edge = [{ id: 'a', name: 'Los Angeles', x: 4, y: 400, z: 0.9 }];
    const p = layoutLabels(edge, { w: 390, h: 844, R: 150, destId: 'a', base: 10, hotBase: 13, swell: 10, measure })[0];
    expect(p.box.x).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(p.box.x + p.box.w).toBeLessThanOrEqual(382 + 1e-6);
  });

  it('labels stay out of the measured footer band; the active label keeps priority, clamped above it', () => {
    const low = [
      { id: 'a', name: 'Lagos', x: 300, y: 780, z: 0.9 }, { id: 'b', name: 'Lima', x: 500, y: 770, z: 0.8 }, { id: 'c', name: 'Oslo', x: 600, y: 300, z: 0.7 },
    ];
    const o = { w: 1200, h: 800, R: 400, base: 10, hotBase: 13, swell: 0, measure, reserveBottom: 90 };
    const plans = layoutLabels(low, { ...o, destId: 'a' });
    for (const p of plans) expect(p.box.y + p.box.h).toBeLessThanOrEqual(800 - 90 + 1e-6);
    expect(plans.some((p) => p.id === 'a' && p.hot)).toBe(true);
    expect(plans.some((p) => p.id === 'b')).toBe(false); // peripheral label inside the band is dropped
    expect(plans.some((p) => p.id === 'c')).toBe(true);
    expect(layoutLabels(low, { ...o, destId: 'a', reserveBottom: 0 }).some((p) => p.id === 'b')).toBe(true); // unchanged without a footer
  });

  it('back-facing cities get no label', () => {
    const back = [{ id: 'b', name: 'Paris', x: 200, y: 300, z: -0.5 }];
    expect(layoutLabels(back, { w: 1200, h: 800, R: 250, destId: null, base: 10, hotBase: 13, swell: 0, measure })).toEqual([]);
  });
});
