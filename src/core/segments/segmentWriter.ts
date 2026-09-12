/**
 * Writing pieces out as separate files (§21.5).
 *
 * Ported from `SegmentWriter.swift`, split at the line D1 draws: everything
 * here is the part of that file which is about *bytes* — which range becomes
 * which file, in what order, read how — and none of it names a filesystem. The
 * writing itself happens through a {@link PartSink} the platform layer
 * supplies, because "a folder the user picked" and "a ZIP the browser
 * downloads" are the same act from here and completely different below (D7).
 *
 * **Nothing is published until every part is complete.** Upstream stages each
 * part as a temp beside its target, fsyncs it, and renames them all into place
 * only once every one is a complete temp — so a failure on part three never
 * leaves parts one and two on disk looking like the whole set. That is the
 * guarantee, and it is the sink's to keep: this module gives it the protocol to
 * keep it with ({@link PartSink.commit} after every part is finished,
 * {@link PartSink.discard} on any failure) and never publishes anything itself.
 *
 * The read is chunked, so a gigabyte-long piece streams rather than loading
 * whole, and a short read is refused rather than truncating the part — see
 * {@link rangeStream}, which is where that lesson lives.
 */

import { type Segment, segmentLabel } from "@/core/segments/segmentation";
import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";
import { CONTENT_CHUNK_SIZE, rangeStream } from "@/core/storage/contentStream";
import { friendlySize } from "@/core/text/byteSize";

/** One part to write: the source range, half-open, and the file it becomes. */
export interface Part {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

/** Thrown out of {@link writeParts} when `shouldCancel` said so. */
export class SegmentWriteCancelled extends Error {
  constructor() {
    super("The segment write was cancelled.");
    this.name = "SegmentWriteCancelled";
  }
}

/**
 * Where the parts go.
 *
 * The two-phase shape is the whole point: a sink stages what it is given and
 * publishes nothing until {@link commit}, so a failure part-way through can
 * {@link discard} and leave the destination exactly as it was.
 */
export interface PartSink {
  /** Begins one part. Its bytes arrive through the stream returned. */
  open(part: Part): Promise<PartStream>;
  /** Every part is staged and complete: publish them. */
  commit(): Promise<void>;
  /** Publish nothing, and remove whatever was staged. */
  discard(): Promise<void>;
}

export interface PartStream {
  write(bytes: Bytes): Promise<void>;
  /** This part is complete. Still not published — that is {@link PartSink.commit}. */
  finish(): Promise<void>;
}

export interface SegmentWriteOptions {
  readonly chunkSize?: number;
  /** Polled at each part boundary and between chunks. */
  readonly shouldCancel?: () => boolean;
  /** A fraction in [0, 1] over the whole set, not per part. */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * One file per piece, named for the document: `bios.bin_S0.bin`, `…_S1.bin`, …
 *
 * The base is the name the pane's header shows rather than anything read off a
 * file handle: an unsaved document has no file to read a name from, and the
 * header's name is the one the user can set — which matters most here, since a
 * folder is the only other thing this command asks for.
 *
 * The label, not the piece's own name: a renamed piece keeps its position in
 * the file, and a name with a slash or a colon in it is not a file name.
 */
export function partsFor(segments: readonly Segment[], baseName: string): Part[] {
  return segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    name: `${baseName}_${segmentLabel(segment.index)}.bin`,
  }));
}

/** What the one confirmation shows before anything is written. */
export interface WritePreview {
  /** `S0 → bios.bin_S0.bin (8 B)`, one per part, in file order. */
  readonly lines: readonly string[];
  /** The names of the parts whose target already exists. */
  readonly replacing: readonly string[];
}

/**
 * The preview of a write, built before it starts.
 *
 * `existingNames` is what the destination already holds — the sink knows it,
 * and asking beforehand is the difference between a user who chose to replace
 * three files and one who discovers it afterwards.
 */
export function previewWrite(
  parts: readonly Part[],
  existingNames: Iterable<string> = []
): WritePreview {
  const existing = new Set(existingNames);
  return {
    // The parts are in file order, so the position is the label.
    lines: parts.map(
      (part, index) =>
        `${segmentLabel(index)} → ${part.name} (${friendlySize(part.end - part.start)})`
    ),
    replacing: parts.filter((part) => existing.has(part.name)).map((part) => part.name),
  };
}

/** "Save 2 Segments?" — the confirmation's question. */
export function writeTitle(count: number): string {
  return `Save ${count} Segment${count === 1 ? "" : "s"}?`;
}

/**
 * Writes every part out of `storage` into `sink`, all or nothing.
 *
 * Cancellation belongs to the staging phase, deliberately. Once every part is
 * staged the commit runs to the end: upstream measured what the alternative
 * costs — cancelling during the renames published a *prefix* of the set and
 * reported a cancelled write.
 */
export async function writeParts(
  parts: readonly Part[],
  storage: ByteStorage,
  sink: PartSink,
  options: SegmentWriteOptions = {}
): Promise<void> {
  const total = parts.reduce((sum, part) => sum + (part.end - part.start), 0);
  // Nothing to write is not a write: the destination is not touched at all.
  if (total <= 0) return;

  const chunkSize = options.chunkSize ?? CONTENT_CHUNK_SIZE;
  let written = 0;

  try {
    for (const part of parts) {
      if (options.shouldCancel?.() === true) throw new SegmentWriteCancelled();
      const stream = await sink.open(part);
      for await (const chunk of rangeStream(storage, part.start, part.end, chunkSize)) {
        if (options.shouldCancel?.() === true) throw new SegmentWriteCancelled();
        await stream.write(chunk);
        written += chunk.length;
        options.onProgress?.(written / total);
      }
      await stream.finish();
    }
  } catch (error) {
    await sink.discard();
    throw error;
  }

  await sink.commit();
}
