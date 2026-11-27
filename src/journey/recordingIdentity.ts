/**
 * Reviewed-view identity and unique per-city recording allocation.
 *
 * Explicit exception: a pinned city-authorized, independently reviewed different event
 * retains its physical viewId but has its own event tile. Original/event aliases still conflict.
 * Unauthorised cities retain the strict physical-view rule.
 *
 * Two independent constraints, both required:
 *
 * 1. Tile identity = city + CURATED reviewed view id. The reviewed view id is
 *    supplied by a human/curation review (with a review reference); it is never
 *    derived from hash, feedId, source page, crop or time. A unique source asset
 *    is NOT automatically a unique camera/view: different assets or time windows
 *    of the same reviewed view allocate ONE tile. Tile ids therefore do not change
 *    when derivative aliases are added later.
 * 2. Original-asset evidence (asset key, original URL, original SHA-256, merged
 *    transitively, hash case-insensitive) is an additional duplicate constraint:
 *    evidence connecting candidates that carry DIFFERENT reviewed view ids is a
 *    contradiction and is surfaced as an explicit `conflict` issue (the allocator
 *    never silently picks or invents an id).
 *
 * The publisher item (e.g. one NASA page) is provenance only: one page may hold
 * several original files, and two files of one page are TWO tiles only when
 * they carry distinct reviewed view ids. feedId/crop/offset/encode/loop hash never
 * create identity.
 *
 * Honest limits: this trusts curated review. It cannot itself detect that two
 * differently-reviewed views are visually the same, nor prove a view is a
 * distinct physical camera. Missing review => `invalid` (unreviewed), never ready.
 */

export interface RecordingProvenance {
  /** Publisher / source organisation, e.g. "NASA". Required. */
  publisher: string;
  /** Public page or API URL the asset was taken from. Required. */
  sourceUrl: string;
  /** Publisher's item (page/entry) id. Optional; never an identity on its own. */
  publisherItemKey?: string;
}

export interface ReviewedView {
  /** Curated, stable view/camera id. Required; not derived from any asset data. */
  viewId: string;
  /** Review provenance/reference (ticket, review doc, manifest entry). Required. */
  reviewRef: string;
  reviewer?: string;
}

export const BUTLERVILLE_EVENT_DECISION = '3cbf43f248a54d26d711d185e188fde7d018e5e895c670269e91eb70dbf9ec76';
export interface ReviewedEvent { eventId: string; equivalenceKey: string; decisionSha256: string; reviewRef: string }
export interface RecordingCandidate {
  reviewedEvent?: ReviewedEvent;
  cityId: string;
  reviewedView?: ReviewedView;
  /** Source-backed key of the ORIGINAL asset, unique within the publisher. Required. */
  originalAssetKey: string;
  originalAssetUrl?: string;
  /** SHA-256 hex of the original bytes; case-insensitive. */
  originalSha256?: string;
  provenance: RecordingProvenance;
  /** Diagnostics only; never identity. */
  feedId?: string;
}

export interface RecordingIdentity {
  /** Curated reviewed view id (canonical identity). */
  viewId: string;
  tileId: string;
  eventId?: string;
  cityId: string;
  reviewRefs: string[];
  /** Distinct original assets (alias-merged) observed for this view. */
  originalAssets: number;
  assetKeys: string[];
  assetUrls: string[];
  sha256: string[];
  publishers: string[];
  sourceUrls: string[];
  publisherItemKeys: string[];
  feedIds: string[];
  memberCount: number;
}

export type RecordingIssueKind = 'unreviewed' | 'provenance' | 'conflict' | 'argument';

export interface RecordingIssue {
  kind: RecordingIssueKind;
  /** Candidate index (-1 for argument issues). */
  index: number;
  reason: string;
  /** For conflicts: indices and view ids connected by the same original evidence. */
  indices?: number[];
  viewIds?: string[];
}

export interface DedupDiagnostics {
  received: number;
  ownedByCity: number;
  otherCity: number;
  unique: number;
  duplicatesCollapsed: number;
  collapsed: { viewId: string; memberCount: number; originalAssets: number }[];
  /** Publisher items holding more than one distinct reviewed view. */
  sharedPublisherItems: { publisherItemKey: string; views: number }[];
}

export interface SlotAllocation {
  slot: number;
  tileId: string;
  recording: RecordingIdentity;
}

interface Counts {
  required: number;
  available: number;
  deficit: number;
}

type Ok = { cityId: string; allocations: SlotAllocation[]; recordings: RecordingIdentity[]; diagnostics: DedupDiagnostics } & Counts;

export type AllocationResult =
  | ({ status: 'ready' } & Ok)
  | ({ status: 'insufficient' } & Ok)
  | { status: 'invalid'; cityId: string; issues: RecordingIssue[] };

const SHA256 = /^[0-9a-f]{64}$/i;

export function normalizeSha256(v: string): string | null {
  const t = v.trim();
  return SHA256.test(t) ? t.toLowerCase() : null;
}

function normalizeUrl(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const uniqSorted = (a: string[]): string[] => [...new Set(a)].sort();
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Normalized {
  recordKey: string;
  eventId?: string;
  index: number;
  viewId: string;
  reviewRef: string;
  tokens: string[];
  key: string;
  url?: string;
  sha?: string;
  publisher: string;
  sourceUrl: string;
  item?: string;
  feedId?: string;
}

function normalize(c: RecordingCandidate, index: number): Normalized | RecordingIssue {
  const bad = (kind: RecordingIssueKind, reason: string): RecordingIssue => ({ kind, index, reason });
  const rv = c?.reviewedView;
  if (!rv || !nonEmpty(rv.viewId)) return bad('unreviewed', 'missing reviewedView.viewId');
  if (!nonEmpty(rv.reviewRef)) return bad('unreviewed', 'missing reviewedView.reviewRef');
  const p = c.provenance;
  if (!p || !nonEmpty(p.publisher)) return bad('provenance', 'missing provenance.publisher');
  const sourceUrl = nonEmpty(p.sourceUrl) ? normalizeUrl(p.sourceUrl) : null;
  if (!sourceUrl) return bad('provenance', 'missing or malformed provenance.sourceUrl');
  if (!nonEmpty(c.originalAssetKey)) return bad('provenance', 'missing originalAssetKey');
  const publisher = p.publisher.trim();
  const key = c.originalAssetKey.trim();
  const tokens = [`asset:${publisher.toLowerCase()}|${key}`];
  let url: string | undefined;
  let sha: string | undefined;
  if (c.originalAssetUrl !== undefined) {
    const u = normalizeUrl(c.originalAssetUrl);
    if (!u) return bad('provenance', 'malformed originalAssetUrl');
    url = u;
    tokens.push(`url:${u}`);
  }
  if (c.originalSha256 !== undefined) {
    const h = normalizeSha256(c.originalSha256);
    if (!h) return bad('provenance', 'malformed originalSha256');
    sha = h;
    tokens.push(`sha:${h}`);
  }
  const event = c.reviewedEvent;
  if (event && (c.cityId !== 'butlerville' || event.decisionSha256 !== BUTLERVILLE_EVENT_DECISION || !nonEmpty(event.eventId) || !nonEmpty(event.equivalenceKey) || !nonEmpty(event.reviewRef))) return bad('unreviewed', 'event requires pinned city authorization and review');
  if (event) tokens.push('event:' + event.equivalenceKey, 'event-id:' + event.eventId);
  return {
    recordKey: event ? 'event:' + event.eventId : 'view:' + rv.viewId.trim(), eventId: event?.eventId,
    index, viewId: rv.viewId.trim(), reviewRef: rv.reviewRef.trim(), tokens, key, url, sha, publisher, sourceUrl,
    item: nonEmpty(p.publisherItemKey) ? p.publisherItemKey.trim() : undefined,
    feedId: nonEmpty(c.feedId) ? c.feedId : undefined,
  };
}

/** Stable tile id: city + curated view id only. */
export function tileIdFor(cityId: string, viewId: string): string {
  return `${cityId}#view:${viewId}`;
}

export function allocateCityRecordings(
  cityId: string,
  requiredSlots: number,
  candidates: readonly RecordingCandidate[],
): AllocationResult {
  const issues: RecordingIssue[] = [];
  if (!nonEmpty(cityId)) issues.push({ kind: 'argument', index: -1, reason: 'missing cityId' });
  if (!Number.isInteger(requiredSlots) || requiredSlots < 0) {
    issues.push({ kind: 'argument', index: -1, reason: 'requiredSlots must be a non-negative integer' });
  }
  const owned: Normalized[] = [];
  let otherCity = 0;
  candidates.forEach((c, index) => {
    if (c?.cityId !== cityId) { otherCity++; return; } // explicit city ownership filter
    const n = normalize(c, index);
    if ('kind' in n) issues.push(n);
    else owned.push(n);
  });
  if (issues.length) return { status: 'invalid', cityId, issues };

  for (const n of owned.filter(n => n.eventId)) {
    if (!owned.some(base => !base.eventId && base.viewId === n.viewId)) issues.push({ kind: 'unreviewed', index: n.index, reason: 'event has no existing physical camera in this city' });
    if (owned.filter(x => x.eventId === n.eventId).length !== 1) issues.push({ kind: 'conflict', index: n.index, reason: 'event identity repeated' });
  }
  if (issues.length) return { status: 'invalid', cityId, issues };
  // Union-find over original-evidence tokens (transitive aliasing).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const n of owned) {
    for (const t of n.tokens) if (!parent.has(t)) parent.set(t, t);
    for (const t of n.tokens.slice(1)) {
      const a = find(n.tokens[0]);
      const b = find(t);
      if (a !== b) parent.set(cmp(a, b) < 0 ? b : a, cmp(a, b) < 0 ? a : b);
    }
  }

  // Same original evidence under different reviewed view ids = explicit conflict.
  const byEvidence = new Map<string, Normalized[]>();
  for (const n of owned) {
    const root = find(n.tokens[0]);
    (byEvidence.get(root) ?? byEvidence.set(root, []).get(root)!).push(n);
  }
  for (const members of byEvidence.values()) {
    const views = uniqSorted(members.map((m) => m.recordKey));
    if (views.length > 1) {
      issues.push({
        kind: 'conflict',
        index: Math.min(...members.map((m) => m.index)),
        reason: 'same original evidence carries contradictory reviewed view ids',
        indices: members.map((m) => m.index).sort((a, b) => a - b),
        viewIds: uniqSorted(members.map(m => m.viewId)),
      });
    }
  }
  if (issues.length) return { status: 'invalid', cityId, issues };

  const byView = new Map<string, Normalized[]>();
  for (const n of owned) (byView.get(n.recordKey) ?? byView.set(n.recordKey, []).get(n.recordKey)!).push(n);

  const recordings: RecordingIdentity[] = [...byView].map(([, members]) => ({
    viewId: members[0].viewId,
    ...(members[0].eventId ? { eventId: members[0].eventId } : {}),
    tileId: members[0].eventId ? cityId + '#event:' + members[0].eventId : tileIdFor(cityId, members[0].viewId),
    cityId,
    reviewRefs: uniqSorted(members.map((m) => m.reviewRef)),
    originalAssets: new Set(members.map((m) => find(m.tokens[0]))).size,
    assetKeys: uniqSorted(members.map((m) => m.key)),
    assetUrls: uniqSorted(members.flatMap((m) => (m.url ? [m.url] : []))),
    sha256: uniqSorted(members.flatMap((m) => (m.sha ? [m.sha] : []))),
    publishers: uniqSorted(members.map((m) => m.publisher)),
    sourceUrls: uniqSorted(members.map((m) => m.sourceUrl)),
    publisherItemKeys: uniqSorted(members.flatMap((m) => (m.item ? [m.item] : []))),
    feedIds: uniqSorted(members.flatMap((m) => (m.feedId ? [m.feedId] : []))),
    memberCount: members.length,
  })).sort((a, b) => cmp(a.tileId, b.tileId));

  const itemCounts = new Map<string, number>();
  for (const r of recordings) for (const k of r.publisherItemKeys) itemCounts.set(k, (itemCounts.get(k) ?? 0) + 1);

  const diagnostics: DedupDiagnostics = {
    received: candidates.length,
    ownedByCity: owned.length,
    otherCity,
    unique: recordings.length,
    duplicatesCollapsed: owned.length - recordings.length,
    collapsed: recordings.filter((r) => r.memberCount > 1)
      .map((r) => ({ viewId: r.viewId, memberCount: r.memberCount, originalAssets: r.originalAssets })),
    sharedPublisherItems: [...itemCounts].filter(([, n]) => n > 1).sort((a, b) => cmp(a[0], b[0]))
      .map(([publisherItemKey, views]) => ({ publisherItemKey, views })),
  };

  // One-to-one, no modulo reuse: slot i gets the i-th view; extras stay unallocated.
  const allocations: SlotAllocation[] = recordings
    .slice(0, requiredSlots)
    .map((recording, slot) => ({ slot, tileId: recording.tileId, recording }));
  const available = recordings.length;
  const counts = { required: requiredSlots, available, deficit: Math.max(0, requiredSlots - available) };
  return { status: counts.deficit === 0 ? 'ready' : 'insufficient', cityId, allocations, recordings, diagnostics, ...counts };
}
