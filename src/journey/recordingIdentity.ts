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

import reviewedOccurrences from './reviewedOccurrences.json' with {type:'json'};
export const REVIEWED_OCCURRENCES = reviewedOccurrences;
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
export interface ReviewedEvent { eventId: string; equivalenceKey: string; decisionSha256: string; reviewRef: string; sameOriginalReview?: unknown }
export interface RecordingCandidate {
  reviewedEvent?: ReviewedEvent;
  cityId: string;
  reviewedView?: ReviewedView;
  /** Source-backed key of the ORIGINAL asset, unique within the publisher. Required. */
  originalAssetKey: string;
  originalAssetUrl?: string;
  /** SHA-256 hex of the original bytes; case-insensitive. */
  originalSha256?: string;
  sourceInterval?: {startSec:number;endSec:number};
  eventAssets?: {loopSha256:string;posterSha256:string;creditsSha256:string};
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

const canonicalProof = (v: unknown): string => JSON.stringify(v && typeof v === 'object'
  ? Array.isArray(v) ? v.map(x=>JSON.parse(canonicalProof(x))) : Object.fromEntries(Object.entries(v).sort(([a],[b])=>cmp(a,b)).map(([k,x])=>[k,JSON.parse(canonicalProof(x))])) : v) ?? 'null';
/** Same admission/runtime predicate. Proof shape and authority bytes are exact, not merely SHA-shaped. */
export function validSameOriginalOccurrence(c: RecordingCandidate, others: readonly RecordingCandidate[], allowRegisteredSuccessors=false): boolean {
  const e=c.reviewedEvent,p=REVIEWED_OCCURRENCES.find(p=>canonicalProof(e?.sameOriginalReview)===canonicalProof(p));
  if(!e || !p || c.cityId!==p.cityId || c.feedId!==p.feedId || c.reviewedView?.viewId!==p.physicalCameraId || e.eventId!==p.eventId || e.equivalenceKey!==p.equivalenceKey || e.decisionSha256!==BUTLERVILLE_EVENT_DECISION || !nonEmpty(e.reviewRef))return false;
  const clock=/^(\d{4}-\d{2}-\d{2})\.(\d{2})-(\d{2})-(\d{2})\.(\d{2})-(\d{2})-(\d{2})\.[a-z]+\.G\d+\.r13\.avi$/.exec(p.originalRecordingId);
  if(!clock || p.cityId!=='butlerville' || !Number.isInteger(p.fps) || p.fps<=0)return false;
  const duration=(Date.parse(`${clock[1]}T${clock[5]}:${clock[6]}:${clock[7]}Z`)-Date.parse(`${clock[1]}T${clock[2]}:${clock[3]}:${clock[4]}Z`))/1000;
  if(![p,...p.accepted].every(w=>Number.isInteger(w.firstFrame)&&Number.isInteger(w.lastFrame)&&w.firstFrame>=0&&w.lastFrame>=w.firstFrame&&(w.lastFrame+1)/p.fps<=duration) || p.equivalenceKey!==`${p.originalRecordingId}#frames:${p.firstFrame}-${p.lastFrame}@${p.fps}`)return false;
  if(c.originalAssetUrl!==p.originalUrl || c.originalAssetKey!=='meva/'+p.originalRecordingId || c.originalSha256!==p.originalSha256 || c.sourceInterval?.startSec!==p.firstFrame/p.fps || c.sourceInterval.endSec!==(p.lastFrame+1)/p.fps)return false;
  if(!c.eventAssets || ['loopSha256','posterSha256','creditsSha256'].some(k=>c.eventAssets![k as keyof typeof c.eventAssets]!==p[k as 'loopSha256']))return false;
  if(new Set([p.originalSha256,p.loopSha256,p.posterSha256]).size!==3 || others.some(a=>[p.loopSha256,p.posterSha256].some(h=>[a.originalSha256,a.eventAssets?.loopSha256,a.eventAssets?.posterSha256].includes(h))))return false;
  const aliases=others.filter(a=>a.originalAssetUrl===c.originalAssetUrl || a.originalAssetKey===c.originalAssetKey || a.originalSha256?.toLowerCase()===c.originalSha256 || a.reviewedEvent?.eventId===e.eventId || a.reviewedEvent?.equivalenceKey===e.equivalenceKey).filter(a=>{
    // Historical proofs remain valid after a later audited registry entry explicitly compares them.
    // Admission never takes this option; runtime independently validates that successor and every pair.
    if(!allowRegisteredSuccessors)return true;
    return !REVIEWED_OCCURRENCES.some(later=>later.feedId===a.feedId && a.cityId===p.cityId && later.cityId===p.cityId && later.physicalCameraId===p.physicalCameraId && later.originalUrl===p.originalUrl && later.originalSha256===p.originalSha256 && later.accepted.some(w=>w.feedId===c.feedId&&w.eventId===e.eventId) && canonicalProof(a.reviewedEvent?.sameOriginalReview)===canonicalProof(later));
  });
  return aliases.length===p.accepted.length && p.accepted.every(w=>{
    const matches=aliases.filter(a=>a.feedId===w.feedId);if(matches.length!==1)return false;const a=matches[0],t=a.sourceInterval;
    return a.cityId===p.cityId && a.reviewedView?.viewId===p.physicalCameraId && a.originalAssetUrl===p.originalUrl && a.originalAssetKey==='meva/'+p.originalRecordingId && a.originalSha256===p.originalSha256 && a.reviewedEvent?.eventId===w.eventId && a.reviewedEvent.equivalenceKey!==e.equivalenceKey && !!t && t.startSec===w.firstFrame/p.fps && t.endSec===(w.lastFrame+1)/p.fps && (t.endSec<c.sourceInterval!.startSec || c.sourceInterval!.endSec<t.startSec);
  });
}

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

  // Validate even a singleton proof; malformed opt-ins cannot silently fall back to legacy behavior.
  const distinct = new Set(owned.filter(n=>candidates[n.index].reviewedEvent?.sameOriginalReview!==undefined && validSameOriginalOccurrence(candidates[n.index],candidates.filter((_,i)=>i!==n.index),true)).map(n=>n.index));
  for(const n of owned)if(candidates[n.index].reviewedEvent?.sameOriginalReview!==undefined && !distinct.has(n.index))issues.push({kind:'unreviewed',index:n.index,reason:'invalid pinned same-original occurrence proof'});
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
    const reviewedPair = members.every(a=>members.every(b=>a===b || a.recordKey===b.recordKey || [a,b].some(n=>distinct.has(n.index) && REVIEWED_OCCURRENCES.some(p=>p.feedId===candidates[n.index].feedId && p.accepted.some(w=>w.feedId===candidates[n===a?b.index:a.index].feedId)))));
    if (views.length > 1 && !reviewedPair) {
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
