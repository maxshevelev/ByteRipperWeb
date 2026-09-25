/**
 * What a pane's pieces came from (§21.7).
 *
 * Ported from `SegmentSources.swift` — the registry a partition's
 * `SegmentSourceID`s stand for, and `ModifiedBaseline`, what a byte is painted
 * against — and from the link half of `PaneViewModel.swift`: how a piece stands
 * to its source, the donor a revert restores from, and the answer to "is saving
 * here about to write over a source?".
 *
 * One registry per pane, at module level: the pane here is a record in the
 * workspace store, and the registry has to outlive every snapshot the undo
 * stack holds — undoing a join gives its partition back, and redoing it has to
 * find the same source the join minted. Its doors are the ones that replace a
 * pane's document: `workspaceStore.ts` clears these wherever it resets the
 * partition and forgets the joins, and swaps them where the slots do.
 */

import type { ByteStorage } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { SlicedStorage } from "@/core/storage/slicedStorage";
import type { Segment, SegmentLink, SegmentSourceID } from "@/core/segments/segmentation";
import type { OpenedFile } from "@/platform/files/openedFile";
import { segmentsFor } from "@/state/segmentsStore";
import { paneState, type PaneId, type PaneState } from "@/state/workspaceStore";

// MARK: - The registry (§21.7)

/**
 * The file a source id stands for, in one pane's registry.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.Source
 * @upstream-differs the record rides the pane's `OpenedFile` — a handle where the
 * browser granted one, the blob-like source it reads from where it did not —
 * rather than a URL path
 */
export interface SourceRecord {
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.Source.id */
  readonly id: SegmentSourceID;
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.Source.name */
  readonly name: string;
  /**
   * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.Source.url
   *
   * For a file join, the file the bytes came from. For a pane-to-pane join, a
   * snapshot of the pane's content taken at the moment of the join — the joined
   * half has to be measured against what was copied, and the source pane may be
   * edited again afterwards.
   */
  readonly file: OpenedFile;
}

/**
 * One pane's sources, the ids that name them, and the readers opened onto them.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources
 * @upstream-differs upstream keeps one of these per pane view model; the web keeps a
 * table of them at module level, the way `joinMarks` sits beside the workspace
 */
interface PaneSources {
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.sources */
  readonly records: Map<number, SourceRecord>;
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.idsByPath */
  readonly idsByKey: Map<object, number>;
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.readers */
  readonly readers: Map<number, ByteStorage>;
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.nextRaw */
  nextRaw: number;
  /**
   * The link verdicts already computed, keyed by what they were measured over —
   * a form that reloads on every change must not re-read a megabyte per row.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.linkStateCache
   */
  readonly linkCache: Map<string, { readonly generation: number; readonly state: SegmentLinkState }>;
}

/** @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources (the pane's one) */
const registries = new Map<PaneId, PaneSources>();

function registryFor(pane: PaneId): PaneSources {
  let registry = registries.get(pane);
  if (registry === undefined) {
    registry = {
      records: new Map(),
      idsByKey: new Map(),
      readers: new Map(),
      linkCache: new Map(),
      nextRaw: 0,
    };
    registries.set(pane, registry);
  }
  return registry;
}

/**
 * The id `file` stands for in this pane's registry, minted the first time it is
 * asked for. The same file asked for twice gets the same id, so a piece's link
 * and a save that would write over it point at one source.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.id
 * @upstream-differs upstream mints on the file's path; the web mints on the file's own
 * identity — the handle the browser granted it, or the source it reads from —
 * since a page's files have no stable path to speak of
 */
export function sourceIDForFile(pane: PaneId, file: OpenedFile): SegmentSourceID {
  const key = file.handle ?? file.source;
  const registry = registryFor(pane);
  const existing = registry.idsByKey.get(key);
  if (existing !== undefined) return { raw: existing };
  const id = { raw: registry.nextRaw++ };
  registry.idsByKey.set(key, id.raw);
  registry.records.set(id.raw, { id, name: file.name, file });
  return id;
}

/**
 * The source `id` stands for, or `undefined` for one this pane never minted.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.source
 */
export function sourceInfo(pane: PaneId, id: SegmentSourceID): SourceRecord | undefined {
  return registries.get(pane)?.records.get(id.raw);
}

/**
 * The name to show for `id` — the file's, beside a piece's own name: the piece
 * is what the user calls it now, the file is where it came from.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.Source.name
 * @upstream-differs the name rides the registry record, not a URL's last path component
 */
export function sourceName(pane: PaneId, id: SegmentSourceID): string | undefined {
  return sourceInfo(pane, id)?.name;
}

/**
 * The source `file` already stands for in this pane's registry, without minting
 * a new one — the write guard's first question.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.existingID
 */
export function existingSource(pane: PaneId, file: OpenedFile): SourceRecord | undefined {
  const registry = registries.get(pane);
  const raw = registry?.idsByKey.get(file.handle ?? file.source);
  return raw === undefined ? undefined : registry?.records.get(raw);
}

/**
 * The open reader for `id`: a chunked read of the file, opened once and kept.
 * `undefined` for a source this pane never minted.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.reader
 * @upstream-differs a page's sources cannot fail to open — the bytes are in the
 * browser's own storage — so the reader never comes back `undefined` on the way
 * of a build; "the file cannot be read any more" (`missing`) can only surface
 * from a read, and only where a snapshot shrank under the link
 */
export function reader(pane: PaneId, id: SegmentSourceID): ByteStorage | undefined {
  const registry = registries.get(pane);
  if (registry === undefined) return undefined;
  const open = registry.readers.get(id.raw);
  if (open !== undefined) return open;
  const record = registry.records.get(id.raw);
  if (record === undefined) return undefined;
  // Opened once and kept: a source is re-read on every link-state check and on
  // every paint, and re-opening a chunked file from disk each time would turn a
  // form reload into a seek storm.
  const fresh = new FileBackedStorage(record.file.source, new ChunkCache());
  registry.readers.set(id.raw, fresh);
  return fresh;
}

/**
 * Every source any piece is linked to, once each, in file order — what a save
 * checks it is not about to write over (§21.7).
 *
 * @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.linkedSources
 */
export function linkedSources(pane: PaneId): SegmentSourceID[] {
  const pieces = segmentsFor(pane)?.segments ?? [];
  const seen = new Set<number>();
  const ids: SegmentSourceID[] = [];
  for (const piece of pieces) {
    const link = piece.link;
    if (link === undefined || seen.has(link.source.raw)) continue;
    seen.add(link.source.raw);
    ids.push(link.source);
  }
  return ids;
}

/**
 * The source a save to `file` would write over, when some piece is linked to
 * it — the write guard's answer (§21.7). A save must not: the sources are the
 * dumps the image was built out of, and replacing one with the image leaves a
 * link pointing at its own result.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.linkedSource
 */
export function linkedSourceAt(pane: PaneId, file: OpenedFile): SourceRecord | undefined {
  const record = existingSource(pane, file);
  if (record === undefined) return undefined;
  return linkedSources(pane).some((id) => id.raw === record.id.raw) ? record : undefined;
}

/**
 * The pane's document was replaced: every source it knew is gone, and so are
 * the readers opened onto it and the verdicts cached over them.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.closeReaders
 * @upstream-differs upstream closes the readers of the pane's one registry; the web drops the
 * entry whole — the registry is per-pane state, and the next document mints its
 * sources from scratch
 */
export function clearSources(pane: PaneId): void {
  registries.delete(pane);
}

/**
 * The two panes changed places; so do their sources, the way their partitions
 * do.
 *
 * @web-only upstream's panes are objects the window moves; the web's slots are record
 * entries, so their registries must trade places with them
 */
export function swapSources(): void {
  const a = registries.get("a");
  const b = registries.get("b");
  registries.delete("a");
  registries.delete("b");
  if (a !== undefined && b !== undefined) {
    registries.set("a", b);
    registries.set("b", a);
  } else if (a !== undefined) {
    registries.set("b", a);
  } else if (b !== undefined) {
    registries.set("a", b);
  }
}

// MARK: - The baseline (§21.7)

/**
 * One stretch of the document, answered by one storage: the byte at `offset`
 * is measured against `storage`'s byte at `sourceOffset + (offset - start)`.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.Span
 */
export interface BaselineSpan {
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.Span.range (its lower bound) */
  readonly start: number;
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.Span.range (its upper bound) */
  readonly end: number;
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.Span.storage */
  readonly storage: ByteStorage;
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.Span.sourceOffset */
  readonly sourceOffset: number;
  /**
   * Where the span's stretch of the source ends. Bytes of the document past
   * this one are inside the span but came from nowhere — an insert grew the
   * piece beyond what it was taken from — and read as new.
   *
   * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.Span.sourceLimit
   * @upstream-differs the half-open range as two offsets, per D13, rather than a `Range` value
   */
  readonly sourceLimit?: number | undefined;
}

/**
 * What a pane's bytes are painted against, as one value (§21.7).
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline
 */
export interface ModifiedBaseline {
  /** @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.spans */
  readonly spans: readonly BaselineSpan[];
  /**
   * The offset from which every byte is new, whatever the spans say.
   *
   * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.beyondFrom
   */
  readonly beyondFrom?: number | undefined;
}

/** @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.none */
export const NO_BASELINE: ModifiedBaseline = { spans: [] };

/**
 * Whether anything in this baseline paints a byte modified at all: a file's
 * against the file, a joined image's against its pieces.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.marksAnything
 */
export function baselineMarksAnything(baseline: ModifiedBaseline): boolean {
  return baseline.spans.length > 0 || baseline.beyondFrom !== undefined;
}

/**
 * What this pane's bytes are painted against, as one value (§21.7).
 *
 * The document's saved file answers it while there is one: "modified" means
 * "not saved yet", and only the file the next save writes to can say that. With
 * no file behind the document — the image a join leaves — the question has no
 * answer at the document's level, and the pieces answer it themselves: each
 * linked piece is measured against the file its bytes came from, so a dump
 * joined out of two chips still shows what has been patched in each half.
 * Pieces with no link are left unmarked, the way an untitled document's bytes
 * always were.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.modifiedBaseline
 * @upstream-differs a function over the pane's record, the pane being a record here rather than an object
 */
export function baselineFor(pane: PaneId): ModifiedBaseline {
  const slot = paneState(pane);
  if (slot === undefined) return NO_BASELINE;
  const links = segmentLinkSpans(pane, slot);
  if (links.length === 0) {
    const saved = slot.saved;
    if (saved === undefined) return NO_BASELINE;
    // A file behind the document answers the whole of it, and past its end
    // every byte is new.
    return {
      spans: [{ start: 0, end: saved.size, storage: saved, sourceOffset: 0 }],
      beyondFrom: saved.size,
    };
  }
  // An image with no file of its own is answered by its pieces. Where it still
  // has a reference of its own — a tab opened from a part of another document,
  // joined to since (§6) — that reference answers the stretches no piece came
  // from, so joining into such a tab does not blank the marks on the part it
  // started as.
  const spans: BaselineSpan[] = [...links];
  const saved = slot.saved;
  if (saved !== undefined && saved.size > 0) {
    // The gaps between the linked pieces, in file order — `links` is built from
    // the pieces, so it already is.
    let at = 0;
    for (const span of links) {
      const upper = Math.min(span.start, saved.size);
      if (at < upper) {
        spans.push({ start: at, end: upper, storage: saved, sourceOffset: at });
      }
      at = Math.max(at, span.end);
    }
    if (at < saved.size) {
      spans.push({ start: at, end: saved.size, storage: saved, sourceOffset: at });
    }
    spans.sort((a, b) => a.start - b.start);
  }
  return { spans };
}

/**
 * The linked pieces as baseline spans, in file order. Empty while the document
 * has a file of its own: "modified" then means "not saved yet", and only the
 * file the next save writes to can answer that (§21.7).
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.segmentLinkSpans
 * @upstream-differs upstream's guard is "the document is untitled" (it has no URL); the web's
 * file of its own is the pane's saved storage, and a join detaches it the same
 * way — so the answer is the same, asked of what the web keeps
 */
function segmentLinkSpans(pane: PaneId, slot: PaneState): BaselineSpan[] {
  if (slot.saved !== undefined) return [];
  const pieces = segmentsFor(pane)?.segments ?? [];
  const spans: BaselineSpan[] = [];
  for (const piece of pieces) {
    const link = piece.link;
    const storage = link === undefined ? undefined : reader(pane, link.source);
    if (link === undefined || storage === undefined) continue;
    // The span is the whole piece, with the stretch it came from as its limit:
    // bytes past that limit are inside the piece and came from nowhere — an
    // insert grew it beyond what it was taken from — so they read as new, the
    // same answer they would get in a file that outgrew its saved copy.
    if (piece.start >= piece.end) continue;
    spans.push({
      start: piece.start,
      end: piece.end,
      storage,
      sourceOffset: link.start,
      sourceLimit: link.end,
    });
  }
  return spans;
}

/**
 * What one byte of the document is measured against.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.Reference
 * @upstream-differs the byte case names the reader offset to read, not the byte itself: the web's
 * reads are `peek`/`read`-based, and the consumer compares. There is no
 * `Block` — the web's consumers walk the spans through their own reads
 */
export type BaselineReference =
  /** Nothing is: the byte has no reference and is never painted modified. */
  | { readonly kind: "unmarked" }
  /** The reference holds a byte at `sourceAt` in `span.storage`. */
  | { readonly kind: "byte"; readonly sourceAt: number; readonly span: BaselineSpan }
  /** The reference ends before this offset: the byte is new here. */
  | { readonly kind: "beyond" };

/**
 * The answer for one document offset (§21.7).
 *
 * The spans are sorted and non-overlapping — a file behind the document is one
 * span, and the pieces tile the file — so the first span that reaches `offset`
 * is the answer, and the spans after it can be left alone.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline.references
 * @upstream-differs one offset at a time, rather than a run of them: the web's consumers
 * (the hex row, the minimap's detail, the overview) each ask for the stretch
 * they draw
 */
export function baselineReferenceAt(
  baseline: ModifiedBaseline,
  offset: number
): BaselineReference {
  const beyondFrom = baseline.beyondFrom;
  if (beyondFrom !== undefined && offset >= beyondFrom) return { kind: "beyond" };
  for (const span of baseline.spans) {
    if (offset < span.start || offset >= span.end) continue;
    const sourceAt = span.sourceOffset + (offset - span.start);
    const limit =
      span.sourceLimit !== undefined
        ? Math.min(span.sourceLimit, span.storage.size)
        : span.storage.size;
    if (sourceAt >= limit) return { kind: "beyond" };
    return { kind: "byte", sourceAt, span };
  }
  return { kind: "unmarked" };
}

// MARK: - How a piece stands to its source (§21.7)

/**
 * How a linked piece stands to the file its bytes came from — what the Segments
 * form says beside the file's name, and what decides whether Revert Segment has
 * to ask about the length first.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.SegmentLinkState
 * @upstream-differs a tagged union, the web's shape for sum types
 */
export type SegmentLinkState =
  /** The piece is byte-for-byte the stretch of the file it came from. */
  | { readonly kind: "matching" }
  /** Same length, different bytes: the piece has been patched since. */
  | { readonly kind: "edited" }
  /**
   * The piece no longer spans what it came from — an insert or a delete inside
   * it, or the file itself has a different length now.
   */
  | { readonly kind: "lengthChanged"; readonly pieceLength: number; readonly sourceLength: number }
  /** The source cannot be read any more: deleted, renamed, or moved. */
  | { readonly kind: "missing" };

/**
 * How often the piece and its source are compared, in bounded reads.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#SegmentSources.compareChunk
 */
export const COMPARE_CHUNK = 1024 * 1024;

/**
 * The file `piece` came from, or `undefined` when nothing brought it in
 * (§21.7) — a manual split, or a new file's one piece.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.segmentSource
 */
export function segmentSource(pane: PaneId, piece: Segment): SourceRecord | undefined {
  const link = piece.link;
  if (link === undefined) return undefined;
  return sourceInfo(pane, link.source);
}

/**
 * How `piece` stands to its source, or `undefined` when it has none. Compared
 * in bounded chunks and cached against the document's last committed serial —
 * a serial is handed out once and never reused in a document's lifetime, and
 * the registries are cleared at the same doors as the document is replaced, so
 * the serial says when the bytes it was measured over last changed.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.segmentLinkState
 * @upstream-differs upstream's `contentGeneration` is a counter the pane bumps on content
 * change; the web reads the undo history's last committed serial, which changes
 * with exactly the content edits a verdict is about. A piece has no identity of
 * its own (the label is positional and renumbers), so the key is what the
 * verdict was actually measured over.
 */
export async function segmentLinkState(
  pane: PaneId,
  piece: Segment
): Promise<SegmentLinkState | undefined> {
  const link = piece.link;
  if (link === undefined) return undefined;
  const slot = paneState(pane);
  const generation = slot?.document.undoHistory.lastCommittedSerial ?? 0;
  const key = `${piece.start}:${piece.end - piece.start}:${link.start}:${link.end}`;
  const registry = registries.get(pane);
  const cached = registry?.linkCache.get(key);
  if (cached !== undefined && cached.generation === generation) return cached.state;
  const state = await computeSegmentLinkState(pane, slot, piece, link);
  registry?.linkCache.set(key, { generation, state });
  return state;
}

/**
 * The comparison itself: the piece and the stretch of its source, read in
 * bounded chunks until they differ, run out, or a read fails.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.computeSegmentLinkState
 */
async function computeSegmentLinkState(
  pane: PaneId,
  slot: PaneState | undefined,
  piece: Segment,
  link: SegmentLink
): Promise<SegmentLinkState> {
  const document = slot?.document;
  const open = reader(pane, link.source);
  if (document === undefined || open === undefined) return { kind: "missing" };
  // The stretch the link claims, as much of it as the source still holds: a
  // source rewritten shorter is a length change, not a missing file.
  const available =
    link.start < open.size ? Math.min(link.end - link.start, open.size - link.start) : 0;
  const pieceLength = piece.end - piece.start;
  if (available !== pieceLength || pieceLength <= 0) {
    return { kind: "lengthChanged", pieceLength, sourceLength: available };
  }
  let offset = 0;
  while (offset < pieceLength) {
    const step = Math.min(COMPARE_CHUNK, pieceLength - offset);
    let mine: Uint8Array;
    let theirs: Uint8Array;
    try {
      mine = await document.read(piece.start + offset, step);
      theirs = await open.read(link.start + offset, step);
    } catch {
      return { kind: "missing" };
    }
    if (mine.length !== step || theirs.length !== step) return { kind: "missing" };
    if (!bytesEqual(mine, theirs)) return { kind: "edited" };
    offset += step;
  }
  return { kind: "matching" };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Whether Revert Segment is offered for `piece`: it has a link, and the source
 * behind it can still be read.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.canRevertSegment
 */
export async function canRevertSegment(pane: PaneId, piece: Segment): Promise<boolean> {
  const state = await segmentLinkState(pane, piece);
  return state !== undefined && state.kind !== "missing";
}

/**
 * The bytes Revert Segment would put back, as a storage of its own: the stretch
 * of the source file the piece stands for, clamped to what the file still
 * holds. `undefined` when there is no readable source.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.segmentRevertDonor
 */
export function segmentRevertDonor(pane: PaneId, piece: Segment): ByteStorage | undefined {
  const link = piece.link;
  const open = link === undefined ? undefined : reader(pane, link.source);
  if (link === undefined || open === undefined) return undefined;
  const donor = new SlicedStorage(open, link.start, link.end);
  return donor.size > 0 ? donor : undefined;
}
