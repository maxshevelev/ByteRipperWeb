import { friendlySize } from "@/core/text/byteSize";
import { sourceOver } from "@/firmware/byteSource";
import { compressLike } from "@/firmware/compression/firmwareCompression";
import type { LzmaEffort } from "@/firmware/compression/lzmaEncoder";
import { type ImageRange, ImageReader } from "@/firmware/imageReader";
import { type ByteSpace, isFileSpace, sameSpace } from "@/firmware/uefi/byteSpace";
import { checksum16, crc32, sum8 } from "@/firmware/uefi/checksums";
import {
  decodeCompressedSection,
  locateCompressedSection,
} from "@/firmware/uefi/compressedSection";
import { type EFIGUID, guid, guidEquals } from "@/firmware/uefi/efiGuid";
import { FFS } from "@/firmware/uefi/fileParser";
import { ffsVersionOfFileSystem, VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { DEFAULT_LIMITS, type Limits } from "@/firmware/uefi/parserState";
import { Section } from "@/firmware/uefi/sectionParser";
import { SpaceReaders } from "@/firmware/uefi/spaceReaders";
import { parseUefiImage, type UEFIImage } from "@/firmware/uefi/uefiImage";
import {
  flattened,
  makeSpan,
  type NodeID,
  nodeFileRange,
  nodeRange,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";
import { FV } from "@/firmware/uefi/volumeFormat";

/**
 * Putting an edited part back into the image it came out of
 * (`Design/UEFI/UPDATE_IN_PARENT.md` §6, §8).
 *
 * Pure: the file's bytes and the part's new bytes go in, and what comes out is
 * either one run of bytes to write over the file or the reason there is none.
 * Nothing is written here, and nothing is guessed — a change that would need a
 * rebase, a moved FIT target or more room than a volume has is refused, with
 * the numbers.
 *
 * The work climbs from the changed node to the level that absorbs the change
 * in size: a section is laid out again inside its parent, a file inside its
 * volume, and a volume takes room from its own free space. A part inside a
 * compressed section is compressed again the way the section was, and the
 * section — now another size — is put back one space further out, the same
 * way, until the file itself is reached. The result is parsed again before it
 * is handed back (§8).
 *
 * Ported from `Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift`.
 */

/**
 * The part being put back: a node's bytes in a space, or — with no range —
 * the whole of what a compressed section decompressed to.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Target
 */
export interface RebuildTarget {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Target.space */
  readonly space: ByteSpace;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Target.range */
  readonly range?: ImageRange | undefined;
}

/**
 * One run of bytes to write over the file, and what the reader should know
 * about it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Plan
 */
export interface RebuildPlan {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Plan.offset */
  readonly offset: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Plan.bytes */
  readonly bytes: Uint8Array;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Plan.warnings */
  readonly warnings: readonly string[];
  /**
   * Where the part is held in the file once the plan is written: the node's
   * new range, or the outermost compressed section's — which a link to the
   * part follows from then on.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Plan.source
   */
  readonly source: ImageRange;
}

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Refusal
 * @upstream-differs a thrown Error carrying the sentence, where upstream throws
 * a struct: the climb refuses from ten levels down, and an Error is what
 * TypeScript carries back up
 */
export class Refusal extends Error {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Refusal.init */
  constructor(message: string) {
    super(message);
    this.name = "Refusal";
  }
}

/**
 * A plan, or the reason there is none.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.plan
 * @upstream-differs Swift's `Result`, which TypeScript spells as a union — the
 * same shape a decode already answers in (`DecodeResult`)
 */
export type RebuildResult =
  | { readonly ok: true; readonly plan: RebuildPlan }
  | { readonly ok: false; readonly refusal: Refusal };

/**
 * Where the list that named a protected range came from, as far as a rebuild
 * cares: the processor checks the IBB before the firmware runs, and everything
 * else is checked by the firmware itself.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.ProtectedRange.Kind
 */
export type RebuildProtectionKind = "ibb" | "vendorHash";

/**
 * A run of the file whose hash something checks
 * (`BOOT_GUARD_PROTECTED_RANGES.md` §2) — what a change must not touch
 * unknowingly (§6.4).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.ProtectedRange
 * @upstream-differs the name, which upstream holds apart from the parser's own
 * `ProtectedRange` by the namespace a TypeScript module does not have
 */
export interface RebuildProtectedRange {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.ProtectedRange.kind */
  readonly kind: RebuildProtectionKind;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.ProtectedRange.range */
  readonly range: ImageRange;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.ProtectedRange.name */
  readonly name: string;
}

/**
 * What a rebuild is doing, and how far the whole of it has got, from 0 to 1.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Progress
 */
export interface RebuildProgress {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Progress.phase */
  readonly phase: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Progress.fraction */
  readonly fraction: number;
}

/**
 * Said with a plan the protected ranges were not given for (§6.4).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.rangesNotChecked
 */
export const RANGES_NOT_CHECKED =
  "Boot Guard and vendor protected ranges were not checked: an edit inside one stops the platform starting.";

/**
 * The part a zone of the file is, when a structure the planner can lay out
 * again — a volume, a file or a section — covers exactly that range.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.target
 */
export function targetForFileRange(range: ImageRange, image: UEFIImage): RebuildTarget | undefined {
  const kinds = new Set(["volume", "file", "section"]);
  const covered = image.allNodes.some((node) => {
    const own = nodeFileRange(node);
    return own !== undefined && sameRange(own, range) && kinds.has(node.kind);
  });
  return covered ? { space: [], range } : undefined;
}

/**
 * What writing `replacement` back at `target` takes, over the whole of `file`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.plan
 */
export function planRebuild(
  replacement: Uint8Array,
  target: RebuildTarget,
  file: Uint8Array,
  options: {
    readonly limits?: Limits;
    /**
     * The file's protected ranges, when they have been read. A change to a byte
     * inside the IBB is refused and one inside a vendor hash range is warned
     * about; nothing says they were not checked.
     */
    readonly protected?: readonly RebuildProtectedRange[] | undefined;
    /**
     * A part inside compressed sections is compressed again at the normal
     * level; when the rebuild then does not fit, it is done again at the
     * maximum level before it is refused. Off, the normal level is all there is
     * — for a test that has to see where the normal level stops.
     */
    readonly maximumCompressionFallback?: boolean;
    /**
     * What is being done and how far the whole plan has got — for a status bar,
     * since compressing a DXE volume again takes seconds.
     */
    readonly onProgress?: (progress: RebuildProgress) => void;
  } = {}
): RebuildResult {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const fallback = options.maximumCompressionFallback ?? true;
  const report = new Reporter(options.onProgress);
  report.phase("Reading the structure of the image");
  // The ranges are the caller's to give (`protected`), not this parse's.
  const image = parseUefiImage(sourceOver(file), {
    limits,
    readsProtectedRanges: false,
    onProgress: (fraction) => report.fraction(Reporter.reading * fraction),
  });
  const compressions = target.space.length;
  let context = new Context(file, image, limits, report, compressions, "normal");
  try {
    let rebuilt: Uint8Array;
    try {
      rebuilt = context.put(replacement, target);
    } catch (error) {
      if (!(error instanceof Refusal) || compressions === 0 || !fallback) throw error;
      // Compressed at the normal level, the part did not go back — most often
      // because the stream is longer than the room it had. Only then is it
      // worth the time the maximum level takes: the whole layout again, every
      // section on the way compressed as small as the encoder can make it.
      context = new Context(file, image, limits, report, compressions, "maximum");
      try {
        rebuilt = context.put(replacement, target);
      } catch {
        throw error;
      }
      context.warnings.push(
        "The compressed data did not fit at the normal compression level, so it was compressed again at the maximum level."
      );
    }
    if (rebuilt.length !== file.length) {
      throw new Refusal("The rebuilt image is not the size of the file. Nothing was changed.");
    }
    report.phase("Checking the rebuilt image");
    report.fraction(Reporter.checking);
    verify(rebuilt, image, target, context.targetBytes, limits, (fraction) =>
      report.fraction(Reporter.checking + (1 - Reporter.checking) * fraction)
    );
    // Upstream's `defer`, registered where it is registered there: a refusal
    // from `verify` leaves the bar where it stopped, and one from the ranges
    // below still takes it to the end.
    try {
      const changes = changedRuns(rebuilt, file);
      const warnings = [...context.warnings];
      if (options.protected !== undefined) {
        warnings.push(...protectionWarnings(changes, options.protected));
      } else {
        warnings.push(RANGES_NOT_CHECKED);
      }
      const source = context.fileSource ?? { start: 0, end: 0 };
      const first = changes[0]?.start;
      const last = changes[changes.length - 1]?.end;
      if (first === undefined || last === undefined) {
        return { ok: true, plan: { offset: 0, bytes: new Uint8Array(0), warnings, source } };
      }
      return {
        ok: true,
        plan: { offset: first, bytes: rebuilt.slice(first, last), warnings, source },
      };
    } finally {
      report.fraction(1);
    }
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, refusal: error };
    return { ok: false, refusal: new Refusal(messageOf(error)) };
  }
}

// MARK: - Protected ranges (§6.4)

/**
 * The runs of bytes the rebuild changes — what a hash over the file sees, as
 * opposed to the span written, which also rewrites bytes as they were.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.changedRuns
 */
export function changedRuns(rebuilt: Uint8Array, file: Uint8Array): ImageRange[] {
  const runs: ImageRange[] = [];
  let start: number | undefined;
  for (let index = 0; index < file.length; index++) {
    if (rebuilt[index] !== file[index]) {
      if (start === undefined) start = index;
    } else if (start !== undefined) {
      runs.push({ start, end: index });
      start = undefined;
    }
  }
  if (start !== undefined) runs.push({ start, end: file.length });
  return runs;
}

/**
 * A change inside the IBB refuses; one inside a vendor hash range is something
 * the reader has to know.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.protectionWarnings
 */
function protectionWarnings(
  runs: readonly ImageRange[],
  protectedRanges: readonly RebuildProtectedRange[]
): string[] {
  const warnings: string[] = [];
  for (const range of protectedRanges) {
    const hit = runs.find((run) => overlaps(run, range.range));
    if (hit === undefined) continue;
    if (range.kind === "ibb") {
      throw new Refusal(
        `The change writes at 0x${hex(Math.max(hit.start, range.range.start))} inside “${range.name}”, part of the Boot Guard IBB: the processor checks it before the firmware runs, and an edit there stops the platform starting (§6.4 of UPDATE_IN_PARENT.md). Nothing was changed.`
      );
    }
    // A list names several ranges one way — every entry of an Insyde flash
    // device map is its "range" — and a change through two of them is still
    // one thing to say.
    const warning = `The change writes inside “${range.name}”: the hash the firmware checks it against no longer matches.`;
    if (!warnings.includes(warning)) warnings.push(warning);
  }
  return warnings;
}

// MARK: - Progress

/**
 * Hands progress on: the phase as it changes, the fraction only ever forward.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Reporter
 * @upstream-differs no lock: a worker is one thread, and there is nothing here
 * for two of them to race over
 */
class Reporter {
  /**
   * Where the phases end on the bar: reading the image, compressing again up to
   * `checking`, then checking the result.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Reporter.reading
   */
  static readonly reading = 0.2;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Reporter.checking */
  static readonly checking = 0.8;

  private readonly sink: ((progress: RebuildProgress) => void) | undefined;
  private current: RebuildProgress = { phase: "", fraction: 0 };

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Reporter.init */
  constructor(sink: ((progress: RebuildProgress) => void) | undefined) {
    this.sink = sink;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Reporter.phase */
  phase(phase: string): void {
    if (this.sink === undefined) return;
    this.current = { phase, fraction: this.current.fraction };
    this.sink(this.current);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Reporter.fraction */
  fraction(fraction: number): void {
    if (this.sink === undefined) return;
    this.current = {
      phase: this.current.phase,
      fraction: Math.max(this.current.fraction, Math.min(fraction, 1)),
    };
    this.sink(this.current);
  }
}

// MARK: - Verifying (§8)

/**
 * The kinds of complaint that mean a structure is broken, rather than merely
 * unusual.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.damage
 */
const DAMAGE: readonly string[] = [
  "checksumMismatch",
  "decompressionFailed",
  "decompressedTooLarge",
  "decompressedSizeMismatch",
  "sizeMismatch",
  "truncated",
  "zeroSize",
];

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.damageCounts */
function damageCounts(image: UEFIImage): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diagnostic of image.diagnostics) {
    const kind = diagnostic.detail.kind;
    if (!DAMAGE.includes(kind)) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

/**
 * The rebuilt image parses with no more damage than the original had, and the
 * part reads back from where it was put.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.verify
 */
function verify(
  rebuilt: Uint8Array,
  original: UEFIImage,
  target: RebuildTarget,
  expected: Uint8Array,
  limits: Limits,
  progress: (fraction: number) => void
): void {
  const before = damageCounts(original);
  const after = damageCounts(
    parseUefiImage(sourceOver(rebuilt), {
      limits,
      readsProtectedRanges: false,
      onProgress: progress,
    })
  );
  for (const [kind, count] of after) {
    if (count > (before.get(kind) ?? 0)) {
      throw new Refusal(
        `Putting it back would leave the image with a new ${kind} — a fault in the rebuild, not in the edit. Nothing was changed.`
      );
    }
  }
  const readers = new SpaceReaders(new ImageReader(sourceOver(rebuilt)), { limits });
  const start = target.range?.start ?? 0;
  const reader = readers.readerFor(target.space);
  const read = reader?.bytesAt(start, expected.length);
  if (
    reader === undefined ||
    read === undefined ||
    !sameBytes(read, expected) ||
    (target.range === undefined && reader.count !== expected.length)
  ) {
    throw new Refusal("The part does not read back from the rebuilt image. Nothing was changed.");
  }
}

// MARK: - The work

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context */
class Context {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.file */
  readonly file: Uint8Array;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.image */
  readonly image: UEFIImage;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.limits */
  readonly limits: Limits;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.readers */
  readonly readers: SpaceReaders;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.warnings */
  warnings: string[] = [];
  /**
   * The target's bytes as they will read back — the replacement with its own
   * sizes and checksums put right.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.targetBytes
   */
  targetBytes: Uint8Array = new Uint8Array(0);
  /**
   * The first range of the file this rebuild puts new bytes at — the target
   * itself, or the outermost compressed section holding it — as it stands
   * afterwards.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.fileSource
   */
  fileSource: ImageRange | undefined;
  private isTarget = true;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.report */
  readonly report: Reporter;
  /**
   * How many compressed sections the rebuild will compress again: the bar
   * between reading and checking is theirs to share.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.compressions
   */
  readonly compressions: number;
  private compressed = 0;
  /**
   * How hard every section on the way is compressed.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.effort
   */
  readonly effort: LzmaEffort;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.init */
  constructor(
    file: Uint8Array,
    image: UEFIImage,
    limits: Limits,
    report: Reporter,
    compressions: number,
    effort: LzmaEffort
  ) {
    this.file = file;
    this.image = image;
    this.limits = limits;
    this.report = report;
    this.compressions = compressions;
    this.effort = effort;
    this.readers = new SpaceReaders(new ImageReader(sourceOver(file)), { limits });
  }

  /**
   * The new file, with `replacement` at `target` and everything around it put
   * right.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.put
   */
  put(replacement: Uint8Array, target: RebuildTarget): Uint8Array {
    const space = target.space;
    const range = target.range;
    // Normalizing a node keeps its length, so this is its range after.
    if (isFileSpace(space) && this.fileSource === undefined && range !== undefined) {
      this.fileSource = { start: range.start, end: range.start + replacement.length };
    }
    const original = this.bytesOf(space);
    let newSpace: Uint8Array;
    // The file is never replaced whole: even a volume that fills it is a
    // structure with a size of its own to keep.
    if (
      range !== undefined &&
      (isFileSpace(space) || range.start !== 0 || range.end !== original.length)
    ) {
      newSpace = this.replaceNode(range, replacement, space, original);
    } else {
      newSpace = replacement;
      if (this.isTarget) this.targetBytes = replacement;
    }
    this.isTarget = false;
    const section = this.compressedSection(space);
    if (section === undefined) return newSpace;
    const parentBytes = this.bytesOf(section.space);
    const rebuilt = this.recompressed(section, newSpace, parentBytes);
    return this.put(rebuilt, { space: section.space, range: nodeRange(section) });
  }

  // MARK: Spaces

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.bytes */
  bytesOf(space: ByteSpace): Uint8Array {
    if (isFileSpace(space)) return this.file;
    const reader = this.readers.readerFor(space);
    const bytes = reader?.bytes(reader.all);
    if (bytes === undefined) {
      throw new Refusal("A compressed section on the way to the part no longer decompresses.");
    }
    return bytes;
  }

  /**
   * The compressed section whose buffer `space` is; nothing for the file.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.compressedSection
   */
  compressedSection(space: ByteSpace): UEFINode | undefined {
    const last = space[space.length - 1];
    if (last === undefined) return undefined;
    const parent = space.slice(0, -1);
    return this.image.allNodes.find(
      (node) =>
        sameSpace(node.space, parent) && node.kind === "section" && node.header.start === last
    );
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.topNodes */
  topNodes(space: ByteSpace): UEFINode[] {
    if (isFileSpace(space)) return this.image.roots;
    const section = this.compressedSection(space);
    if (section === undefined) {
      throw new Refusal(
        "The compressed section the part came out of is not in the image any more."
      );
    }
    return section.children.filter((node) => sameSpace(node.space, space));
  }

  /**
   * The nodes from the top of `space` down to the innermost one covering
   * exactly `range`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.path
   */
  path(range: ImageRange, space: ByteSpace): UEFINode[] {
    const path: UEFINode[] = [];
    let nodes = this.topNodes(space);
    for (;;) {
      const node = nodes.find((one) => {
        const own = nodeRange(one);
        return (
          sameSpace(one.space, space) &&
          own.start <= range.start &&
          range.end <= own.end &&
          own.end > own.start
        );
      });
      if (node === undefined) break;
      path.push(node);
      nodes = node.children;
    }
    let exact = -1;
    for (let index = 0; index < path.length; index++) {
      if (sameRange(nodeRange(path[index] as UEFINode), range)) exact = index;
    }
    if (exact < 0) {
      throw new Refusal(
        "The part is not a whole structure of the image, so it cannot be laid out again."
      );
    }
    return path.slice(0, exact + 1);
  }

  // MARK: Climbing

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.replaceNode */
  replaceNode(
    range: ImageRange,
    replacement: Uint8Array,
    space: ByteSpace,
    bytes: Uint8Array
  ): Uint8Array {
    const path = this.path(range, space);
    const node = path[path.length - 1] as UEFINode;
    let current = this.normalized(node, replacement, path);
    if (this.isTarget) this.targetBytes = current;
    let child = node;
    for (const parent of path.slice(0, -1).reverse()) {
      current = this.rebuild(parent, child, current, path, bytes, space);
      child = parent;
    }
    const childRange = nodeRange(child);
    if (current.length === childRange.end - childRange.start) {
      return spliced(bytes, childRange, current);
    }
    if (isFileSpace(space)) {
      return this.settled(
        child,
        current,
        this.image.roots,
        bytes.length,
        "the end of the file",
        bytes
      );
    }
    // A buffer is a run of sections from its first byte.
    return this.run(this.topNodes(space), child, current, bytes);
  }

  /**
   * `replacement` for `node`, with the node's own size, checksums and tail made
   * to fit what it now is.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.normalized
   * @upstream-differs without the space's bytes, which upstream takes and does
   * not read: every branch works from the replacement alone
   */
  normalized(node: UEFINode, replacement: Uint8Array, path: readonly UEFINode[]): Uint8Array {
    switch (node.kind) {
      case "file":
        return Bytes.file(
          replacement,
          node.name,
          volumeRevisionOf(path),
          ffsVersionOf(path, node.space)
        );
      case "section":
        return Bytes.sized(replacement, node.name);
      case "volume":
        return Bytes.volumeHeaderChecksummed(this.volumeSized(replacement, node.name));
      default:
        return replacement;
    }
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.rebuild */
  rebuild(
    parent: UEFINode,
    child: UEFINode,
    replacement: Uint8Array,
    path: readonly UEFINode[],
    bytes: Uint8Array,
    space: ByteSpace
  ): Uint8Array {
    const childRange = nodeRange(child);
    switch (parent.kind) {
      case "section": {
        const header = bytes.subarray(parent.header.start, parent.header.end);
        const body =
          parent.subtype === Section.firmwareVolumeImage
            ? concat(
                bytes.subarray(parent.body.start, childRange.start),
                replacement,
                bytes.subarray(childRange.end, parent.body.end)
              )
            : this.run(parent.children, child, replacement, bytes);
        this.noteSigned(parent);
        return Bytes.withCRC32(
          Bytes.sized(concat(header, body), parent.name),
          parent,
          header.length
        );
      }
      case "file": {
        const header = bytes.subarray(parent.header.start, parent.header.end);
        const tail = bytes.subarray(parent.tail.start, parent.tail.end);
        const body = this.run(parent.children, child, replacement, bytes);
        const upper = [...takeWhile(path, (one) => !sameId(one.id, parent.id)), parent];
        return Bytes.file(
          concat(header, body, tail),
          parent.name,
          volumeRevisionOf(upper),
          ffsVersionOf(upper, space)
        );
      }
      case "volume": {
        // A volume a section holds grows by blocks and the section takes the
        // new size (§6.5); one in the file grows into the empty space after it,
        // unless it holds the Volume Top File, whose end is pinned (§7). One at
        // the top of a buffer does not grow.
        const at = Math.max(
          path.findIndex((one) => sameId(one.id, parent.id)),
          0
        );
        let growth: VolumeGrowth;
        if (at > 0 && path[at - 1]?.kind === "section") {
          growth = "inSection";
        } else if (isFileSpace(space) && !flattened(parent).some(isVolumeTop)) {
          growth = "intoEmptySpace";
        } else {
          growth = "none";
        }
        return this.rebuildVolume(parent, child, replacement, bytes, space, growth);
      }
      default: {
        const parentRange = nodeRange(parent);
        if (replacement.length !== childRange.end - childRange.start) {
          const result = this.settled(
            child,
            replacement,
            parent.children,
            parentRange.end,
            `the end of “${parent.name}”`,
            bytes
          );
          return result.slice(parentRange.start, parentRange.end);
        }
        const result = Uint8Array.from(bytes.subarray(parentRange.start, parentRange.end));
        result.set(replacement, childRange.start - parentRange.start);
        return result;
      }
    }
  }

  // MARK: A structure at its own length (§7)

  /**
   * `bytes` with `replacement` in place of `child`, at exactly its own length:
   * the difference is taken from, or given back to, the empty bytes right after
   * it, so whatever follows them — the next volume, the next region's contents
   * — stays at its offset.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.settled
   */
  settled(
    child: UEFINode,
    replacement: Uint8Array,
    siblings: readonly UEFINode[],
    end: number,
    endName: string,
    bytes: Uint8Array
  ): Uint8Array {
    const old = nodeRange(child);
    const oldLength = old.end - old.start;
    const newLength = replacement.length;
    if (flattened(child).some(isVolumeTop)) {
      throw new Refusal(
        `“${child.name}” holds the Volume Top File, which has to end at the top of the address space, so it keeps its size of 0x${hex(oldLength)} bytes and this one is 0x${hex(newLength)} (§7 of UPDATE_IN_PARENT.md).`
      );
    }
    const next = siblings.find((one) => {
      const own = nodeRange(one);
      return (
        sameSpace(one.space, child.space) &&
        one.kind !== "padding" &&
        own.end > own.start &&
        own.start >= old.end
      );
    });
    const limit = Math.min(next === undefined ? end : nodeRange(next).start, end);
    const empty = this.emptyByte(child, limit, bytes);
    if (newLength > oldLength) {
      const needed = newLength - oldLength;
      let room = 0;
      while (old.end + room < limit && bytes[old.end + room] === empty) room += 1;
      if (room < needed) {
        const before = next === undefined ? endName : `“${next.name}”`;
        throw new Refusal(
          `“${child.name}” is 0x${hex(needed)} bytes longer than before, and only 0x${hex(room)} empty bytes follow it before ${before}, which stays where it is (§7 of UPDATE_IN_PARENT.md).`
        );
      }
    }
    const result =
      newLength > oldLength
        ? spliced(bytes, { start: old.start, end: old.start + newLength }, replacement)
        : spliced(bytes, old, concat(replacement, repeated(empty, oldLength - newLength)));
    const change =
      newLength > oldLength
        ? `0x${hex(newLength - oldLength)} bytes longer, taken from the empty space after it`
        : `0x${hex(oldLength - newLength)} bytes shorter, given back to the empty space after it`;
    let warning = `“${child.name}” is now 0x${hex(newLength)} bytes, ${change}; what follows stays where it was.`;
    if (child.kind === "volume") {
      warning +=
        " The flash map the firmware carries (PCDs, vendor tables, an Insyde FDM) still gives its old size.";
    }
    this.warnings.push(warning);
    return result;
  }

  /**
   * What fills the bytes after `child`: the byte already there when it is an
   * erased one, otherwise the volume's own erase polarity.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.emptyByte
   */
  emptyByte(child: UEFINode, limit: number, bytes: Uint8Array): number {
    const old = nodeRange(child);
    if (old.end < limit) {
      const there = bytes[old.end];
      if (there === 0xff || there === 0x00) return there;
    }
    if (child.kind === "volume") {
      return (Bytes.u32(bytes, old.start + 0x2c) & FV.erasePolarity) !== 0 ? 0xff : 0x00;
    }
    return 0xff;
  }

  /**
   * A volume put back whole with a length its header does not give: `FvLength`
   * and the block map's one entry rewritten to it, when it is a whole number of
   * that entry's blocks.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.volumeSized
   */
  volumeSized(volume: Uint8Array, name: string): Uint8Array {
    if (volume.length < FV.headerSize) {
      throw new Refusal(`“${name}” is shorter than a volume header.`);
    }
    const length = volume.length;
    let declared = 0;
    for (let index = 0; index < 8; index++) {
      declared += (volume[0x20 + index] as number) * 2 ** (8 * index);
    }
    if (declared === length) return volume;
    const blockLength = Bytes.oneBlockLength(volume, 0, volume.length);
    if (
      blockLength === undefined ||
      length % blockLength !== 0 ||
      length / blockLength > 0xffff_ffff
    ) {
      throw new Refusal(
        `“${name}” is 0x${hex(length)} bytes, and its header says 0x${hex(declared)}: a volume is whole blocks of its block map, and this one cannot be made to say the new length.`
      );
    }
    const bytes = Uint8Array.from(volume);
    Bytes.put(length, 8, 0x20, bytes);
    Bytes.put32(length / blockLength, FV.headerSize, bytes);
    this.warnings.push(
      `“${name}” said it was 0x${hex(declared)} bytes: its header now gives 0x${hex(length)}.`
    );
    return bytes;
  }

  /**
   * A run of sections laid out again from its first byte, four-byte aligned,
   * with `child` replaced by `replacement`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.run
   */
  run(
    children: readonly UEFINode[],
    child: UEFINode,
    replacement: Uint8Array,
    bytes: Uint8Array
  ): Uint8Array {
    const pad = children.find((one) => one.kind === "padding");
    const padByte = pad === undefined ? 0x00 : (bytes[nodeRange(pad).start] ?? 0x00);
    const parts: Uint8Array[] = [];
    let length = 0;
    for (const node of children) {
      if (node.kind === "padding" || !sameSpace(node.space, child.space)) continue;
      const padding = Bytes.padding(length, 4);
      if (padding > 0) {
        parts.push(repeated(padByte, padding));
        length += padding;
      }
      const own = nodeRange(node);
      const piece = sameId(node.id, child.id) ? replacement : bytes.subarray(own.start, own.end);
      parts.push(piece);
      length += piece.length;
    }
    return concat(...parts);
  }

  // MARK: Volumes (§6.3)

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.rebuildVolume */
  rebuildVolume(
    volume: UEFINode,
    child: UEFINode,
    replacement: Uint8Array,
    bytes: Uint8Array,
    space: ByteSpace,
    growth: VolumeGrowth
  ): Uint8Array {
    const volumeRange = nodeRange(volume);
    const start = volumeRange.start;
    const body = volume.body;
    const empty = (Bytes.u32(bytes, start + 0x2c) & FV.erasePolarity) !== 0 ? 0xff : 0x00;
    const revision = volume.subtype ?? 2;
    const ffs = (volume.guid === undefined ? undefined : ffsVersionOfFileSystem(volume.guid)) ?? 2;
    const children = volume.children.filter((one) => sameSpace(one.space, space));
    const index = children.findIndex((one) => sameId(one.id, child.id));
    if (index < 0) {
      throw new Refusal(`“${child.name}” is not laid out in “${volume.name}”.`);
    }

    const old = nodeRange(child);
    const newEnd = old.start + replacement.length;
    const alignedEnd = body.start + Bytes.aligned(newEnd - body.start, 8);
    const after = children.slice(index + 1).filter((one) => one.kind !== "padding");

    // What moves, and where the room comes from.
    const moving: UEFINode[] = [];
    let absorbStart = body.end;
    let absorbEnd = body.end;
    let padBeforeTop: UEFINode | undefined;
    for (let offset = 0; offset < after.length; offset++) {
      const node = after[offset] as UEFINode;
      if (node.kind === "file" && !isVolumeTop(node)) {
        const rest = after.slice(offset);
        const first = rest[0];
        const second = rest[1];
        if (
          rest.length === 2 &&
          first !== undefined &&
          second !== undefined &&
          this.isEmptyPad(first, bytes, empty) &&
          isVolumeTop(second)
        ) {
          padBeforeTop = first;
          absorbStart = nodeRange(first).start;
          absorbEnd = nodeRange(second).start;
          break;
        }
        moving.push(node);
        continue;
      }
      const own = nodeRange(node);
      absorbStart = own.start;
      absorbEnd = node.kind === "freeSpace" ? own.end : own.start;
      break;
    }
    if (moving.length === 0 && padBeforeTop === undefined && after.length === 0) {
      absorbStart = Math.max(Bytes.alignedUp(old.end, body.start, 8), absorbStart);
      absorbStart = Math.min(absorbStart, body.end);
    }
    const lastMoving = moving[moving.length - 1];
    if (lastMoving !== undefined && absorbStart === body.end && absorbEnd === body.end) {
      absorbStart = Math.min(body.end, Bytes.alignedUp(nodeRange(lastMoving).end, body.start, 8));
      absorbEnd = absorbStart;
    }

    if (isFileSpace(space)) {
      for (const node of moving) {
        if (flattened(node).some((one) => one.isFixed)) {
          throw new Refusal(
            `“${node.name}” would move, and it is fixed at its address — the Volume Top File, a FIT target or a file marked fixed (§6.4 of UPDATE_IN_PARENT.md).`
          );
        }
        if (node.subtype !== undefined && [0x03, 0x04, 0x06, 0x08].includes(node.subtype)) {
          throw new Refusal(
            `“${node.name}” would move, and it is code that runs in place from flash: moving it needs a rebase this editor does not do (§6.4 of UPDATE_IN_PARENT.md).`
          );
        }
      }
    }

    const alignment =
      moving.length === 0
        ? 8
        : Math.max(8, ...moving.map((one) => this.fileAlignment(one, bytes, ffs)));
    const oldNext = lastMoving === undefined ? absorbStart : nodeRange(moving[0] as UEFINode).start;
    let newNext: number;
    if (moving.length === 0) {
      newNext = alignedEnd;
    } else {
      const distance = alignedEnd - oldNext;
      const steps =
        distance >= 0 ? Math.ceil(distance / alignment) : -Math.floor(-distance / alignment);
      newNext = oldNext + steps * alignment;
      while (newNext - alignedEnd > 0 && newNext - alignedEnd < FFS.headerSize) {
        newNext += alignment;
      }
    }
    const shift = newNext - oldNext;
    const newAbsorbStart = absorbStart + shift;

    if (newAbsorbStart > absorbEnd) {
      // Growing into the empty space needs some to be there at all; with none
      // the refusal below says what the volume has.
      const beyond = bytes[volumeRange.end];
      const canGrow =
        growth === "inSection" ||
        (growth === "intoEmptySpace" &&
          volumeRange.end < bytes.length &&
          (beyond === 0x00 || beyond === 0xff));
      if (canGrow && padBeforeTop === undefined && absorbEnd === body.end) {
        return this.grownVolume(
          volume,
          child,
          replacement,
          bytes,
          space,
          newAbsorbStart - absorbEnd,
          growth === "inSection"
        );
      }
      throw new Refusal(
        `“${volume.name}” has 0x${hex(absorbEnd - absorbStart)} bytes free where it can take room, and the change needs 0x${hex(newAbsorbStart - absorbStart)} (§6.3 of UPDATE_IN_PARENT.md).`
      );
    }
    if (padBeforeTop !== undefined) {
      const size = absorbEnd - newAbsorbStart;
      if (size !== 0 && size < FFS.headerSize) {
        throw new Refusal(
          `There is no room left for the pad file in front of the Volume Top File in “${volume.name}”.`
        );
      }
    }

    const parts: Uint8Array[] = [
      bytes.subarray(start, old.start),
      replacement,
      repeated(empty, alignedEnd - newEnd),
    ];
    if (moving.length > 0) {
      const gap = newNext - alignedEnd;
      if (gap > 0) parts.push(Bytes.padFile(gap, Bytes.zeroGUID, revision, empty));
      parts.push(bytes.subarray(oldNext, absorbStart));
    }
    if (padBeforeTop !== undefined) {
      const size = absorbEnd - newAbsorbStart;
      if (size > 0) {
        const padStart = nodeRange(padBeforeTop).start;
        parts.push(Bytes.padFile(size, bytes.subarray(padStart, padStart + 16), revision, empty));
      }
    } else {
      parts.push(repeated(empty, absorbEnd - newAbsorbStart));
    }
    parts.push(bytes.subarray(absorbEnd, volumeRange.end));
    const out = concat(...parts);
    if (out.length !== volumeRange.end - volumeRange.start) {
      throw new Refusal(
        `“${volume.name}” did not come out its own size — a fault in the rebuild. Nothing was changed.`
      );
    }
    return out;
  }

  /**
   * A volume a section holds, grown by whole blocks until the change fits
   * (§6.5): `FvLength`, the block map's one entry and the header checksum
   * rewritten, the new blocks erased, and the layout done again in the longer
   * volume — whose free space now runs to its new end.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.grownVolume
   */
  grownVolume(
    volume: UEFINode,
    child: UEFINode,
    replacement: Uint8Array,
    bytes: Uint8Array,
    space: ByteSpace,
    needed: number,
    saysSo: boolean
  ): Uint8Array {
    const volumeRange = nodeRange(volume);
    const start = volumeRange.start;
    const end = volumeRange.end;
    const blockLength = Bytes.oneBlockLength(bytes, start, end);
    if (blockLength === undefined) {
      throw new Refusal(
        `“${volume.name}” has no room for 0x${hex(needed)} more bytes, and its block map is not one a new size can be written into (§6.5 of UPDATE_IN_PARENT.md).`
      );
    }
    const length = end - start;
    if (length % blockLength !== 0) {
      throw new Refusal(
        `“${volume.name}” has no room for 0x${hex(needed)} more bytes, and its size is not a whole number of its blocks (§6.5 of UPDATE_IN_PARENT.md).`
      );
    }
    const extra = Math.ceil(needed / blockLength) * blockLength;
    const newLength = length + extra;
    if (newLength / blockLength > 0xffff_ffff) {
      throw new Refusal(`“${volume.name}” would need more blocks than its block map can count.`);
    }
    const empty = (Bytes.u32(bytes, start + 0x2c) & FV.erasePolarity) !== 0 ? 0xff : 0x00;

    let longer = concat(bytes.subarray(start, end), repeated(empty, extra));
    Bytes.put(newLength, 8, 0x20, longer);
    Bytes.put32(newLength / blockLength, FV.headerSize, longer);
    longer = Bytes.volumeHeaderChecksummed(longer);
    const grownBytes = concat(bytes.subarray(0, start), longer, bytes.subarray(end));

    const children = [...volume.children];
    const bigger: UEFINode = {
      ...volume,
      body: { start: volume.body.start, end: volume.body.end + extra },
      children,
    };
    let last = -1;
    for (let index = 0; index < children.length; index++) {
      if (sameSpace((children[index] as UEFINode).space, space)) last = index;
    }
    const free = last < 0 ? undefined : (children[last] as UEFINode);
    if (free !== undefined && free.kind === "freeSpace") {
      children[last] = { ...free, body: { start: free.body.start, end: bigger.body.end } };
    } else {
      const tail = makeSpan({
        kind: "freeSpace",
        name: "Free space",
        range: { start: volume.body.end, end: bigger.body.end },
        isErased: true,
      });
      tail.space = space;
      tail.id = [-1];
      children.push(tail);
    }
    // A volume growing into the empty space after it is said by `settled`, with
    // what that means for the flash map.
    if (saysSo) {
      this.warnings.push(`“${volume.name}” grew by 0x${hex(extra)} bytes to make room.`);
    }
    return this.rebuildVolume(bigger, child, replacement, grownBytes, space, "none");
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.isEmptyPad */
  isEmptyPad(node: UEFINode, bytes: Uint8Array, empty: number): boolean {
    return (
      node.kind === "file" &&
      node.subtype === FFS.padType &&
      bytes.subarray(node.body.start, node.body.end).every((byte) => byte === empty)
    );
  }

  /**
   * The alignment a file's data needs, from its attributes.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.fileAlignment
   */
  fileAlignment(file: UEFINode, bytes: Uint8Array, ffsVersion: number): number {
    const attributes = bytes[file.header.start + 0x13] ?? 0;
    const slot = (attributes & 0x38) >> 3;
    const powers =
      ffsVersion === 3 && (attributes & 0x02) !== 0
        ? [17, 18, 19, 20, 21, 22, 23, 24]
        : [0, 4, 7, 9, 10, 12, 15, 16];
    return 2 ** (powers[slot] ?? 0);
  }

  // MARK: Compressed sections (§5)

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.recompressed */
  recompressed(section: UEFINode, buffer: Uint8Array, parentBytes: Uint8Array): Uint8Array {
    const reader = new ImageReader(sourceOver(parentBytes));
    const located = locateCompressedSection(section.header.start, reader);
    const decoded =
      located === undefined
        ? undefined
        : decodeCompressedSection(located, reader, this.limits.maxDecompressedSize);
    if (located === undefined || decoded === undefined || !decoded.ok) {
      throw new Refusal(
        `“${section.name}” no longer decompresses, so it cannot be compressed again the same way.`
      );
    }
    // The stretch of the bar between reading and checking that this section's
    // encode, one of `compressions`, has to itself.
    const share = (Reporter.checking - Reporter.reading) / Math.max(this.compressions, 1);
    const low = Reporter.reading + share * this.compressed;
    this.compressed += 1;
    const size = friendlySize(buffer.length);
    this.report.phase(
      this.effort === "maximum"
        ? `Compressing “${section.name}” again at the maximum level (${size})`
        : `Compressing “${section.name}” (${size})`
    );
    let stream: Uint8Array;
    try {
      stream = compressLike(
        buffer,
        decoded,
        parentBytes.subarray(located.body.start, located.body.end),
        {
          effort: this.effort,
          onProgress: (fraction) => this.report.fraction(low + share * fraction),
        }
      );
    } catch (error) {
      throw new Refusal(`“${section.name}” could not be compressed again: ${messageOf(error)}.`);
    }
    const header = Uint8Array.from(parentBytes.subarray(section.header.start, located.body.start));
    if (section.subtype === Section.compression) {
      const common = Bytes.u24(header, 0) === Section.extendedSizeMarker ? 8 : 4;
      Bytes.put32(buffer.length, common, header);
    }
    this.noteSigned(section);
    return Bytes.sized(concat(header, stream), section.name);
  }

  /**
   * A signed or authenticated section on the way out no longer checks.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.noteSigned
   */
  noteSigned(section: UEFINode): void {
    if (section.subtype !== Section.guidDefined || section.guid === undefined) return;
    if (guidEquals(section.guid, SIGNED_GUID)) {
      this.warnings.push(
        `“${section.name}” is signed, and its signature no longer matches what it holds.`
      );
    }
  }
}

/**
 * Whether a volume that runs out of free space may grow, and into what.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.VolumeGrowth
 */
type VolumeGrowth =
  | "none"
  /** Held by a section, which takes the new size (§6.5). */
  | "inSection"
  /** In the file: into the empty bytes after it, which `settled` checks (§7). */
  | "intoEmptySpace";

// MARK: - What a node is read by

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.volumeRevision */
function volumeRevisionOf(path: readonly UEFINode[]): number {
  for (let index = path.length - 1; index >= 0; index--) {
    const node = path[index] as UEFINode;
    if (node.kind === "volume") return node.subtype ?? 2;
  }
  return 2;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.ffsVersion */
function ffsVersionOf(path: readonly UEFINode[], space: ByteSpace): number {
  for (let index = path.length - 1; index >= 0; index--) {
    const node = path[index] as UEFINode;
    if (node.kind !== "volume") continue;
    return (node.guid === undefined ? undefined : ffsVersionOfFileSystem(node.guid)) ?? 2;
  }
  return isFileSpace(space) ? 2 : 3;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Context.isVolumeTop */
function isVolumeTop(node: UEFINode): boolean {
  return node.kind === "file" && node.guid !== undefined && guidEquals(node.guid, VOLUME_TOP_FILE);
}

// MARK: - Bytes

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.signedGUID */
const SIGNED_GUID: EFIGUID = guid("0F9D89E8-9259-4F76-A5AF-0C89E34023DF");
/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.crc32GUID */
const CRC32_GUID: EFIGUID = guid("FC1BCDB0-7D31-49AA-936A-A4600D9DD083");

/**
 * The fields this rebuild writes, in the layouts `UEFI_IMAGE_FORMAT.md` gives
 * them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes
 */
const Bytes = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.zeroGUID */
  zeroGUID: new Uint8Array(16),

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.u24 */
  u24(bytes: Uint8Array, at: number): number {
    return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
  },

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.u32 */
  u32(bytes: Uint8Array, at: number): number {
    return Bytes.u24(bytes, at) + (bytes[at + 3] ?? 0) * 0x100_0000;
  },

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.put */
  put(value: number, count: number, at: number, bytes: Uint8Array): void {
    for (let index = 0; index < count; index++) {
      bytes[at + index] = Math.floor(value / 2 ** (8 * index)) & 0xff;
    }
  },

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.put32 */
  put32(value: number, at: number, bytes: Uint8Array): void {
    Bytes.put(value, 4, at, bytes);
  },

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.padding */
  padding(count: number, alignment: number): number {
    return (alignment - (count % alignment)) % alignment;
  },

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.aligned */
  aligned(count: number, alignment: number): number {
    return count + Bytes.padding(count, alignment);
  },

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.alignedUp */
  alignedUp(offset: number, base: number, alignment: number): number {
    return base + Bytes.aligned(offset - base, alignment);
  },

  /**
   * A section's size field made to say how long it now is — in three bytes, or
   * in the extended field when the header has one.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.sized
   */
  sized(section: Uint8Array, name: string): Uint8Array {
    const bytes = Uint8Array.from(section);
    if (Bytes.u24(bytes, 0) === Section.extendedSizeMarker && bytes.length >= 8) {
      if (bytes.length > 0xffff_ffff) {
        throw new Refusal(`“${name}” would be larger than a section can say.`);
      }
      Bytes.put32(bytes.length, 4, bytes);
    } else {
      if (bytes.length >= Section.extendedSizeMarker) {
        throw new Refusal(`“${name}” would grow past 16 MiB, which its short header cannot say.`);
      }
      Bytes.put(bytes.length, 3, 0, bytes);
    }
    return bytes;
  },

  /**
   * A file's size, checksums and tail made to fit its bytes (§5.2, §5.4).
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.file
   */
  file(file: Uint8Array, name: string, volumeRevision: number, ffsVersion: number): Uint8Array {
    const bytes = Uint8Array.from(file);
    if (bytes.length < FFS.headerSize) {
      throw new Refusal(`“${name}” is shorter than a file header.`);
    }
    const attributes = bytes[0x13] as number;
    const isLarge = (attributes & FFS.largeFile) !== 0;
    let headerSize: number;
    if (ffsVersion === 3 && isLarge) {
      headerSize = FFS.largeHeaderSize;
      Bytes.put(bytes.length, 8, 0x18, bytes);
    } else if (ffsVersion === 2 && volumeRevision === 2 && isLarge) {
      headerSize = FFS.lenovoHeaderSize;
      Bytes.put(bytes.length, 4, 0x18, bytes);
    } else {
      headerSize = FFS.headerSize;
      if (bytes.length > 0xff_ffff) {
        throw new Refusal(
          `“${name}” would grow past 16 MiB in a file with no large-file header (§6.4 of UPDATE_IN_PARENT.md).`
        );
      }
      Bytes.put(bytes.length, 3, 0x14, bytes);
    }
    const tail =
      volumeRevision === 1 && (attributes & FFS.tailPresent) !== 0 && bytes.length > headerSize
        ? 2
        : 0;
    const body = bytes.subarray(headerSize, bytes.length - tail);
    bytes[0x11] =
      (attributes & FFS.checksumBit) !== 0
        ? (0x100 - sum8(body)) & 0xff
        : volumeRevision === 1
          ? FFS.fixedChecksum
          : FFS.fixedChecksum2;
    const sum =
      (sum8(bytes.subarray(0, headerSize)) -
        (bytes[0x10] as number) -
        (bytes[0x11] as number) -
        (bytes[0x17] as number)) &
      0xff;
    bytes[0x10] = (0x100 - sum) & 0xff;
    if (tail === 2) {
      bytes[bytes.length - 2] = ~(bytes[0x10] as number) & 0xff;
      bytes[bytes.length - 1] = ~(bytes[0x11] as number) & 0xff;
    }
    return bytes;
  },

  /**
   * An empty pad file of `size` bytes (§5.6).
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.padFile
   */
  padFile(size: number, guidBytes: Uint8Array, revision: number, empty: number): Uint8Array {
    const bytes = concat(
      guidBytes,
      Uint8Array.from([0, 0, FFS.padType, 0, 0, 0, 0, empty === 0xff ? 0xf8 : 0x07]),
      repeated(empty, size - FFS.headerSize)
    );
    try {
      return Bytes.file(bytes, "Pad", revision, 2);
    } catch {
      return bytes;
    }
  },

  /**
   * The block length of a volume at `start` whose block map is one entry and
   * its terminator — the only kind a new length can be written into (§6.5).
   * Nothing for any other.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.oneBlockLength
   */
  oneBlockLength(bytes: Uint8Array, start: number, end: number): number | undefined {
    if (end - start < FV.headerSize + 2 * FV.blockMapEntrySize) return undefined;
    const headerLength = (bytes[start + 0x30] ?? 0) | ((bytes[start + 0x31] ?? 0) << 8);
    const map = start + FV.headerSize;
    if (
      headerLength !== FV.headerSize + 2 * FV.blockMapEntrySize ||
      Bytes.u32(bytes, map + 8) !== 0 ||
      Bytes.u32(bytes, map + 12) !== 0
    ) {
      return undefined;
    }
    const blockLength = Bytes.u32(bytes, map + 4);
    return blockLength > 0 ? blockLength : undefined;
  },

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.volumeHeaderChecksummed */
  volumeHeaderChecksummed(volume: Uint8Array): Uint8Array {
    const bytes = Uint8Array.from(volume);
    const length = (bytes[0x30] ?? 0) | ((bytes[0x31] ?? 0) << 8);
    if (length > bytes.length) return bytes;
    bytes[FV.checksumOffset] = 0;
    bytes[FV.checksumOffset + 1] = 0;
    const checksum = checksum16(bytes.subarray(0, length));
    if (checksum === undefined) return bytes;
    Bytes.put(checksum, 2, FV.checksumOffset, bytes);
    return bytes;
  },

  /**
   * A CRC32 GUID-defined section whose authentication status is valid carries
   * the CRC of its data, which changed with it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.Bytes.withCRC32
   */
  withCRC32(section: Uint8Array, node: UEFINode, headerLength: number): Uint8Array {
    if (
      node.subtype !== Section.guidDefined ||
      node.guid === undefined ||
      !guidEquals(node.guid, CRC32_GUID)
    ) {
      return section;
    }
    const bytes = Uint8Array.from(section);
    const common = Bytes.u24(bytes, 0) === Section.extendedSizeMarker ? 8 : 4;
    const attributes = (bytes[common + 18] ?? 0) | ((bytes[common + 19] ?? 0) << 8);
    if ((attributes & 0x02) === 0 || headerLength < common + 24) return section;
    // The same routine, ported once: `Checksums.crc32`.
    Bytes.put32(crc32(bytes.subarray(headerLength)), common + 20, bytes);
    return bytes;
  },
} as const;

// MARK: - Bytes and ranges, the way TypeScript holds them

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIRebuild.swift#UEFIRebuild.hex */
function hex(value: number): string {
  return value.toString(16).toUpperCase();
}

const sameRange = (one: ImageRange, other: ImageRange): boolean =>
  one.start === other.start && one.end === other.end;

const overlaps = (one: ImageRange, other: ImageRange): boolean =>
  one.start < other.end && other.start < one.end;

const sameId = (one: NodeID, other: NodeID): boolean =>
  one.length === other.length && one.every((step, index) => step === other[index]);

const sameBytes = (one: Uint8Array, other: Uint8Array): boolean =>
  one.length === other.length && one.every((byte, index) => byte === other[index]);

const takeWhile = <T>(list: readonly T[], keep: (item: T) => boolean): T[] => {
  const kept: T[] = [];
  for (const item of list) {
    if (!keep(item)) break;
    kept.push(item);
  }
  return kept;
};

const repeated = (byte: number, count: number): Uint8Array =>
  new Uint8Array(Math.max(count, 0)).fill(byte);

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** `bytes` with `range` replaced by `replacement`, which may be another length. */
const spliced = (bytes: Uint8Array, range: ImageRange, replacement: Uint8Array): Uint8Array =>
  concat(bytes.subarray(0, range.start), replacement, bytes.subarray(range.end));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
