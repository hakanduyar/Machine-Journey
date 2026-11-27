import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Journey } from './Journey';
import { UniqueCatalogReport } from './UniqueCatalogReport';
import { CITIES } from './journey/globe';
import { ALL_FEEDS } from './journey/feeds';
import { ACTIVE_RECORDING_MANIFEST } from './journey/recordingManifest';
import {
  evaluateUniqueCatalog, growRequest, lifecycleView, recordAdmission, requiredSlotsFor, startLifecycle, type GateInput,
} from './journey/uniqueCatalogGate';

type Source = Pick<GateInput, 'cities' | 'candidates' | 'feedIds'>;
const REAL_SOURCE: Source = { cities: CITIES, candidates: ACTIVE_RECORDING_MANIFEST, feedIds: ALL_FEEDS.map((f) => f.id) };

/**
 * Candidate-only (`?catalog=unique`) boundary. The requested capacity is the non-decreasing session maximum of the viewport's
 * required slots. Journey is mounted only after a gate PASSES (never at an initial insufficient admission) and is then the SAME
 * instance for the rest of the session: a larger admitted layout is handed over as a new `layoutRevision` (committed by Journey at
 * a safe hold), and a failed larger admission keeps Journey mounted but `suspended` underneath an opaque capacity report.
 * `source` exists only so tests can supply a clearly synthetic catalogue; main.tsx never passes it (real manifest is the default).
 */
export function UniqueCatalogBoundary({ source = REAL_SOURCE }: { source?: Source } = {}) {
  const [life, setLife] = useState(() => startLifecycle(requiredSlotsFor(window.innerWidth, window.innerHeight)));
  useEffect(() => {
    // Flushed synchronously: the cover / report for a larger request is committed before the next paint (no undersized frame).
    const onResize = () => flushSync(() => setLife((p) => growRequest(p, requiredSlotsFor(window.innerWidth, window.innerHeight))));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const gate = useMemo(() => evaluateUniqueCatalog({ ...source, requiredSlots: life.requested }), [life.requested, source]);
  const next = recordAdmission(life, gate);
  if (next !== life) setLife(next); // derived state: adjusted during render, settles on the next pass
  // The last layout that really passed (kept across a later failed larger admission, never used while not admitted).
  const [admittedLayout, setAdmittedLayout] = useState<{ capacity: number; layout: NonNullable<ReturnType<typeof layoutOf>> } | null>(null);
  const passed = layoutOf(gate);
  if (passed && admittedLayout?.layout !== passed) setAdmittedLayout({ capacity: gate.required, layout: passed });
  const view = lifecycleView(next);
  const revision = next.admitted?.revision ?? 0;
  const layout = passed ?? admittedLayout?.layout;
  // Journey acknowledges the revision it has actually laid out. The cover stays up from admission until that acknowledgement, so a
  // sufficient-but-uncommitted growth (e.g. waiting for the safe hold of a running leg) never shows the old, undersized geometry.
  const [committedRev, setCommittedRev] = useState<number | null>(null);
  const coverPending = view.mounted && gate.ready && committedRev !== null && committedRev !== revision;
  return (
    <>
      {view.mounted && layout ? (
        <Journey uniqueLayout={layout} layoutRevision={revision} suspended={view.suspended} onLayoutCommitted={setCommittedRev} />
      ) : null}
      {coverPending ? (
        <div data-unique-pending="1" role="status" style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: '#05070a', color: '#cfe3ee', font: '13px ui-monospace, Consolas, monospace', padding: 24 }}>
          CANDIDATE · UNIQUE · FITTING THE LARGER LAYOUT…
        </div>
      ) : null}
      {!gate.ready ? <UniqueCatalogReport gate={gate} /> : null}
    </>
  );
}

function layoutOf(g: ReturnType<typeof evaluateUniqueCatalog>) { return g.ready ? g.layout : null; }
