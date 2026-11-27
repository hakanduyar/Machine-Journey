// FIXTURE-ONLY Vite plugin (test server only; never part of vite.config.ts or the production build).
// It makes the REAL modules see extra, obviously SYNTHETIC feeds so the real UniqueCatalogBoundary + Journey can be exercised at
// capacities no real city can satisfy. Nothing here is catalogue / footage evidence: synthetic feeds `syn-NN` merely ALIAS existing
// media files through a dev-server URL rewrite, and are appended to Butlerville's feed list at module-evaluation time in this server.
export const SYNTHETIC_FEEDS = 61;
const CORE = ['m01', 'm02', 'm03', 'm04', 'm06', 'm07', 'covered-road', 'parking-walk', 'docked-cargo', 'parked-c130', 'm05', 'palmdale-dc8'];
const synId = "'syn-' + String(i).padStart(2, '0')";

export function uniqueFixturePlugin() {
  return {
    name: 'unique-fixture-synthetic-feeds',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = /^\/media\/syn-(\d+)\/(loop\.mp4|poster\.jpg)/.exec(req.url ?? '');
        if (m) req.url = `/media/${CORE[Number(m[1]) % CORE.length]}/${m[2]}`;
        next();
      });
    },
    transform(code, id) {
      const f = id.split('?')[0].replace(/\\/g, '/');
      if (f.endsWith('/src/journey/feeds.ts')) {
        return `${code}\nfor (let i = 0; i < ${SYNTHETIC_FEEDS}; i++) ALL_FEEDS.push({ id: ${synId}, label: 'SYNTHETIC FIXTURE ' + i, credit: 'SYNTHETIC TEST FIXTURE - aliases an existing file - not catalogue evidence' });\n`;
      }
      if (f.endsWith('/src/journey/globe.ts')) {
        return `${code}\n{ const b: any = CITIES.find((c) => c.id === 'butlerville'); if (b) b.feedIds = [...(b.feedIds ?? []), ...Array.from({ length: ${SYNTHETIC_FEEDS} }, (_, i) => ${synId})]; }\n`;
      }
      return null;
    },
  };
}
