import { RECORDING_COUNTS } from './journey/recordingManifest';
import type { CatalogGate } from './journey/uniqueCatalogGate';

/** Honest capacity report of the opt-in `?catalog=unique` candidate. Text only: no media, posters, canvases or tiles. */
export function UniqueCatalogReport({ gate }: { gate: CatalogGate }) {
  const short = gate.cities.filter((c) => c.status !== 'ready');
  const total = gate.cities.reduce((a, c) => a + c.available, 0);
  return (
    <div role="alert" data-unique-report="1" style={{ position: 'fixed', inset: 0, zIndex: 2147483000, overflow: 'auto', background: '#05070a', color: '#cfe3ee', font: '13px/1.5 ui-monospace, Consolas, monospace', padding: 24 }}>
      <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>CANDIDATE CATALOG · UNIQUE · CAPACITY REPORT</h1>
      <p style={{ maxWidth: 760, margin: '0 0 12px' }}>
        Every city must fill {gate.required} whole-world tiles with distinct reviewed recordings before the journey may mount.
        {' '}{short.length} of {gate.cities.length} cities are short ({total} reviewed recordings in total), so the journey is not mounted: no
        repeated, cropped or placeholder tiles are shown. The catalog contains {RECORDING_COUNTS.physicalViews} physical views and {RECORDING_COUNTS.eventRecordings} separately authorized same-camera events. This is a diagnostic screen, not the finished product. Remove
        <code> ?catalog=unique </code> for the accepted experience.
      </p>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead><tr>{['city', 'status', 'required', 'available', 'deficit'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '2px 14px 2px 0' }}>{h}</th>)}</tr></thead>
        <tbody>
          {gate.cities.map((c) => (
            <tr key={c.cityId}>
              <td style={{ padding: '2px 14px 2px 0' }}>{c.name}</td><td>{c.status}</td><td>{c.required}</td><td>{c.available}</td><td>{c.deficit}</td>
              {c.issues.length ? <td style={{ paddingLeft: 14 }}>{c.issues.map((i) => i.reason).join('; ')}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
