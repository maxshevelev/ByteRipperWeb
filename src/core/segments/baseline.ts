import type { ByteStorage } from "@/core/storage/byteStorage";

/**
 * What a document's bytes are painted modified against, as a pure value (§21.7).
 *
 * A span is a stretch of the document answered by one storage: the byte at
 * `offset` is measured against `storage`'s byte at
 * `sourceOffset + (offset - start)`. A document with a file behind it is one
 * span over the whole of it; an image with no file of its own is one span per
 * linked piece, and a part that still holds the bytes it was opened with is
 * both at once.
 *
 * The value and the one question asked of it, rather than the pane-aware
 * machinery that builds it (`src/state/segmentSources.ts`): the hex grid, the
 * minimap's detail, and the overview all read the same value, and the render
 * layer must not reach into the state's stores to ask a byte what it is.
 *
 * @upstream ByteRipperApp/Segments/SegmentSources.swift#ModifiedBaseline
 * @upstream-differs the value's home is the core: upstream's renderers are the
 * app layer's, and its `Block` half is not ported — the web's consumers walk
 * the spans through their own `peek`/`read` calls
 */

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
