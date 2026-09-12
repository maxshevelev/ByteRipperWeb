import { WindowedByteSource } from "@/firmware/byteSource";
import { type ImageRange, ImageReader } from "@/firmware/imageReader";
import type { DiagnosticKind, UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The parse in progress: the reader, the limits, and the diagnostics as they
 * accumulate.
 *
 * An object because every level appends to one list, and threading an array
 * through a recursion this deep is how one branch's diagnostics get dropped on
 * the way back up.
 *
 * Nothing throws. Every level collects diagnostics and carries on with the
 * bytes it still understands, because the images worth opening a tool on are
 * the ones with something already wrong in them.
 */

export interface Limits {
  /**
   * Volume, file, section, volume again — real images nest eight or ten deep,
   * and a corrupt one nests forever.
   */
  readonly maxDepth: number;
}

export const DEFAULT_LIMITS: Limits = { maxDepth: 16 };

/**
 * How far the scan has got, reported monotonically from just above 0 up to 1.
 *
 * Shared by every parser of the same materialization, so the fractions move
 * forward across the whole job rather than restarting per node.
 */
export class ProgressSink {
  private readonly total: number;
  private readonly report: (fraction: number) => void;
  private furthest = 0;

  constructor(total: number, report: (fraction: number) => void) {
    this.total = total;
    this.report = report;
  }

  reached(offset: number): void {
    if (this.total <= 0 || offset <= this.furthest) return;
    this.furthest = offset;
    this.report(Math.min(1, offset / this.total));
  }
}

/**
 * What an unwritten byte looks like outside any volume. Inside one it is the
 * volume's erase polarity that decides; out here `0xFF` is what an erased chip
 * reads as.
 */
export const DEFAULT_EMPTY_BYTE = 0xff;

export class Parser {
  readonly reader: ImageReader;
  readonly limits: Limits;
  readonly diagnostics: UEFIDiagnostic[] = [];
  private readonly onProgress: ProgressSink | undefined;

  constructor(reader: ImageReader, limits: Limits, progress?: ProgressSink | undefined) {
    // Through a window of its own. A parser is built, used and dropped inside
    // one materialization, which is exactly the lifetime a read cache needs —
    // and the reads it makes are thousands of small fields, mostly forward,
    // which is exactly what a window serves.
    this.reader = new ImageReader(new WindowedByteSource(reader.source));
    this.limits = limits;
    this.onProgress = progress;
  }

  note(detail: DiagnosticKind, offset: number): void {
    this.diagnostics.push({ detail, offset });
  }

  /** Reports that the scan has reached `offset`, as a fraction of the image. */
  progressed(offset: number): void {
    this.onProgress?.reached(offset);
  }

  /**
   * Whatever no structure claimed.
   *
   * Kept as a node rather than dropped: an image that cannot be put back
   * together byte for byte is one this tool cannot honestly edit.
   */
  padding(start: number, end: number, emptyByte: number): UEFINode[] {
    if (start >= end) return [];
    const range: ImageRange = { start, end };
    const erased = this.reader.isFilled(range, emptyByte);
    return [
      makeSpan({
        kind: "padding",
        name: erased ? "Empty padding" : "Padding",
        range,
        isErased: erased,
      }),
    ];
  }
}
