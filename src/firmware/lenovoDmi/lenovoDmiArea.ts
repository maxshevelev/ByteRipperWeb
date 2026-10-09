import { L } from "@/core/localization/localization";
import { LDBGLog } from "@/firmware/lenovoDmi/ldbgLog";
import {
  hexText,
  keyId,
  LenovoDMIFormat,
  type LenovoDMIKey,
  startsWith,
} from "@/firmware/lenovoDmi/lenovoDmiFormat";
import { entryName } from "@/firmware/lenovoDmi/lenovoDmiValue";
import { LENVBlock } from "@/firmware/lenovoDmi/lenvBlock";

/**
 * Something about the area a technician should know before trusting it.
 *
 * - `wiped`: both blocks are signed and empty — generation 0, no entries,
 *   nothing written. The board's identity is not here.
 * - `noUsableBlock`: neither block is signed with a generation the firmware
 *   would use.
 * - `erased`: the block's page is all `FF`: erased, and never written again.
 * - `entriesDoNotFit`: the header's entry count runs past the end of the block
 *   under either reading.
 * - `storedInTheClear`: the block's body is not encoded although its key is
 *   not zero.
 * - `blocksDiffer`: the two blocks hold different values for these keys. Normal
 *   right after the firmware writes — it rewrites one copy at a time — and the
 *   reason a donor copy has to be read from the live block.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIFinding
 */
export type LenovoDMIFinding =
  | { readonly kind: "wiped" }
  | { readonly kind: "noUsableBlock" }
  | { readonly kind: "missingSignature"; readonly block: number }
  | { readonly kind: "erased"; readonly block: number }
  | {
      readonly kind: "checksumMismatch";
      readonly block: number;
      readonly stored: number;
      readonly computed: number;
    }
  | { readonly kind: "entriesDoNotFit"; readonly block: number }
  | { readonly kind: "storedInTheClear"; readonly block: number }
  | { readonly kind: "blocksDiffer"; readonly keys: readonly LenovoDMIKey[] }
  | { readonly kind: "logWriteOffsetOutOfRange"; readonly value: number }
  | { readonly kind: "logWriteOffsetMisaligned"; readonly value: number };

/**
 * A problem, as opposed to something worth knowing.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIFinding.isProblem
 */
export const findingIsProblem = (finding: LenovoDMIFinding): boolean =>
  finding.kind !== "blocksDiffer" &&
  finding.kind !== "storedInTheClear" &&
  finding.kind !== "wiped";

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIFinding.text */
export function findingText(finding: LenovoDMIFinding): string {
  switch (finding.kind) {
    case "wiped":
      return L(
        "Both LENV blocks are empty: the store has been wiped or was never written. The board's serial number and UUID are not in this image."
      );
    case "noUsableBlock":
      return L("Neither LENV block is one the firmware would read.");
    case "erased":
      return L(
        "LENV block %1$@ is erased: every byte is FF. The firmware reads the other copy.",
        finding.block + 1
      );
    case "missingSignature":
      return L("LENV block %1$@ has no signature where it should start.", finding.block + 1);
    case "checksumMismatch":
      return L(
        "LENV block %1$@: the checksum is %2$@, the body adds up to %3$@.",
        finding.block + 1,
        hexText(finding.stored, 4),
        hexText(finding.computed, 4)
      );
    case "entriesDoNotFit":
      return L(
        "LENV block %1$@: the entries its header counts do not fit in the block.",
        finding.block + 1
      );
    case "storedInTheClear":
      return L(
        "LENV block %1$@ is stored decoded. Whether the firmware accepts that is not known.",
        finding.block + 1
      );
    case "blocksDiffer":
      return L(
        "The two LENV blocks hold different values for: %1$@. The firmware reads the block in use.",
        finding.keys.map(entryName).join(", ")
      );
    case "logWriteOffsetOutOfRange":
      return L("The change log's write offset %1$@ is outside the log.", hexText(finding.value, 8));
    case "logWriteOffsetMisaligned":
      return L(
        "The change log's write offset %1$@ does not fall on an entry boundary.",
        hexText(finding.value, 8)
      );
  }
}

const sameBytes = (left: Uint8Array | undefined, right: Uint8Array | undefined): boolean =>
  left === undefined || right === undefined
    ? left === right
    : left.length === right.length && left.every((byte, index) => byte === right[index]);

/**
 * The store as found in one image: the change log, the two `LENV` blocks, and
 * which block the firmware reads.
 *
 * The three sit back to back — log, block 1, block 2 — on every dump examined,
 * and an Insyde flash device map declares them as three regions of exactly
 * those sizes. Where in the image they are moves from board to board
 * (upstream's `0xFF620000` is one platform's address), so they are found by
 * signature, not by address.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.init
 */
export class LenovoDMIArea {
  /**
   * Where the area starts — the log's first byte.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.offset
   */
  readonly offset: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.log */
  readonly log: LDBGLog;
  /**
   * Block 1 and block 2, in file order. Either may be unsigned.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.blocks
   */
  readonly blocks: readonly LENVBlock[];

  constructor(offset: number, log: LDBGLog, blocks: readonly LENVBlock[]) {
    this.offset = offset;
    this.log = log;
    this.blocks = blocks;
  }

  /**
   * Half-open.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.range
   */
  get range(): readonly [number, number] {
    return [this.offset, this.offset + LenovoDMIFormat.areaSize];
  }

  /**
   * The block the firmware reads: the usable one with the higher generation,
   * and block 1 on a tie, which is how upstream decides it. Nothing when neither
   * is usable — a wiped store.
   *
   * Whether the firmware also passes over a block whose checksum is wrong is not
   * known; the panel says so where it matters.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.liveIndex
   */
  get liveIndex(): number | undefined {
    let live: number | undefined;
    for (const [index, block] of this.blocks.entries()) {
      if (!block.isUsable) continue;
      const current = live === undefined ? undefined : this.blocks[live];
      if (current === undefined || block.generation > current.generation) live = index;
    }
    return live;
  }

  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.live */
  get live(): LENVBlock | undefined {
    const index = this.liveIndex;
    return index === undefined ? undefined : this.blocks[index];
  }

  /**
   * Every key either block holds, in the live block's order, then the other
   * block's.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.keys
   */
  get keys(): LenovoDMIKey[] {
    const seen = new Map<string, LenovoDMIKey>();
    const live = this.liveIndex;
    const order =
      live === undefined
        ? [...this.blocks.keys()]
        : [live, ...[...this.blocks.keys()].filter((index) => index !== live)];
    for (const index of order) {
      for (const entry of this.blocks[index]?.entries ?? []) {
        const id = keyId(entry.key);
        if (!seen.has(id)) seen.set(id, entry.key);
      }
    }
    return [...seen.values()];
  }

  /**
   * What reads wrong in the area, worst first.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.findings
   */
  get findings(): LenovoDMIFinding[] {
    const found: LenovoDMIFinding[] = [];
    if (this.blocks.every((block) => block.isBlank)) {
      found.push({ kind: "wiped" });
    } else if (this.liveIndex === undefined) {
      found.push({ kind: "noUsableBlock" });
    }
    for (const [index, block] of this.blocks.entries()) {
      if (block.isErased) {
        found.push({ kind: "erased", block: index });
        continue;
      }
      if (!block.hasSignature) {
        found.push({ kind: "missingSignature", block: index });
        continue;
      }
      if (block.isBlank) continue;
      if (!block.checksumIsValid) {
        found.push({
          kind: "checksumMismatch",
          block: index,
          stored: block.checksum,
          computed: block.expectedChecksum,
        });
      }
      if (!block.entriesFit) found.push({ kind: "entriesDoNotFit", block: index });
      if (block.encoding === "plain") found.push({ kind: "storedInTheClear", block: index });
    }
    const [first, second] = this.blocks;
    if (
      this.blocks.length === 2 &&
      first !== undefined &&
      second !== undefined &&
      first.isUsable &&
      second.isUsable
    ) {
      const differing = this.keys.filter(
        (key) => !sameBytes(first.entry(key)?.data, second.entry(key)?.data)
      );
      if (differing.length > 0) found.push({ kind: "blocksDiffer", keys: differing });
    }
    switch (this.log.writeOffsetProblem) {
      case "outOfRange":
        found.push({ kind: "logWriteOffsetOutOfRange", value: this.log.writeOffset });
        break;
      case "misaligned":
        found.push({ kind: "logWriteOffsetMisaligned", value: this.log.writeOffset });
        break;
      default:
        break;
    }
    return found;
  }

  /**
   * Reads the area whose log starts at `offset` of `image`. Nothing when the
   * image ends before the second block does.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.read
   */
  static readAt(image: Uint8Array, offset: number): LenovoDMIArea | undefined {
    if (offset < 0 || offset + LenovoDMIFormat.areaSize > image.length) return undefined;
    return LenovoDMIArea.read(image.subarray(offset, offset + LenovoDMIFormat.areaSize), offset);
  }

  /**
   * Reads an area from its own bytes, `stored`, which start at `offset` of the
   * file. Nothing unless `stored` is exactly one area long.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.read
   */
  static read(stored: Uint8Array, offset: number): LenovoDMIArea | undefined {
    if (stored.length !== LenovoDMIFormat.areaSize) return undefined;
    const logSize = LenovoDMIFormat.ldbgSize;
    const blocks = [0, 1].map((index) => {
      const start = logSize + index * LenovoDMIFormat.lenvSize;
      return new LENVBlock(offset + start, stored.slice(start, start + LenovoDMIFormat.lenvSize));
    });
    const log = new LDBGLog(
      offset,
      stored.slice(0, logSize),
      blocks.filter((block) => block.hasSignature).map((block) => block.xorKey)
    );
    return new LenovoDMIArea(offset, log, blocks);
  }

  /**
   * The area `stored` holds, when it is one: the `LDBG` signature, its write
   * offset and eight zero bytes (upstream's pattern), and at least one of the
   * two blocks signed where it should be. The second condition is what upstream
   * does not check, and it is what keeps a stray `LDBG` in a driver's code from
   * being taken for the store.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIArea.found
   */
  static found(stored: Uint8Array, offset: number): LenovoDMIArea | undefined {
    if (
      stored.length !== LenovoDMIFormat.areaSize ||
      !startsWith(stored, LenovoDMIFormat.ldbgSignature) ||
      !stored.subarray(8, 16).every((byte) => byte === 0)
    ) {
      return undefined;
    }
    const area = LenovoDMIArea.read(stored, offset);
    return area?.blocks.some((block) => block.hasSignature) === true ? area : undefined;
  }
}

/**
 * What an image holds of the store: whole areas — the log and both blocks — and
 * `LENV` blocks found on their own, outside any area.
 *
 * A block on its own is what a fragment panel holds when a block was opened out
 * of the dump, decoded or as it is: the log and the other copy stayed behind,
 * and the block is still worth reading.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIReading
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIReading.init
 */
export interface LenovoDMIReading {
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIReading.areas */
  readonly areas: readonly LenovoDMIArea[];
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIReading.blocks */
  readonly blocks: readonly LENVBlock[];
}

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMIReading.isEmpty */
export const readingIsEmpty = (reading: LenovoDMIReading): boolean =>
  reading.areas.length === 0 && reading.blocks.length === 0;

/**
 * Where `signature` starts in `image` at or after `from`: the native search for
 * its first byte, then a check of the rest.
 *
 * @upstream-differs Uint8Array.indexOf in place of `memmem`, as the raw-area scan has it
 */
function nextSignature(image: Uint8Array, signature: readonly number[], from: number): number {
  const first = signature[0] ?? 0;
  let at = image.indexOf(first, from);
  while (at !== -1 && !startsWith(image, signature, at)) at = image.indexOf(first, at + 1);
  return at;
}

/**
 * The areas in `image`, and every `LENV` block outside them whose header reads
 * as one: signed, a whole page from its start, and holding entries that fit or
 * nothing at all.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMI
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMI.read
 */
export function readLenovoDMI(image: Uint8Array): LenovoDMIReading {
  const areas = locateLenovoDMI(image);
  const size = LenovoDMIFormat.lenvSize;
  const blocks: LENVBlock[] = [];
  let start = 0;
  while (start + size <= image.length) {
    const offset = nextSignature(image, LenovoDMIFormat.lenvSignature, start);
    if (offset === -1) break;
    start = offset + 1;
    if (offset + size > image.length) continue;
    if (areas.some((area) => area.range[0] <= offset && offset < area.range[1])) continue;
    const block = LENVBlock.found(image.slice(offset, offset + size), offset);
    if (block === undefined) continue;
    blocks.push(block);
    start = offset + size;
  }
  return { areas, blocks };
}

/**
 * Every area in `image`: each `LDBG` signature that starts one
 * (`LenovoDMIArea.found`).
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIArea.swift#LenovoDMI.locate
 */
export function locateLenovoDMI(image: Uint8Array): LenovoDMIArea[] {
  const areaSize = LenovoDMIFormat.areaSize;
  const areas: LenovoDMIArea[] = [];
  if (image.length < areaSize) return areas;
  let start = 0;
  while (start + areaSize <= image.length) {
    const offset = nextSignature(image, LenovoDMIFormat.ldbgSignature, start);
    if (offset === -1) break;
    start = offset + 1;
    if (offset + areaSize > image.length) continue;
    const area = LenovoDMIArea.found(image.subarray(offset, offset + areaSize), offset);
    if (area === undefined) continue;
    areas.push(area);
    start = offset + areaSize;
  }
  return areas;
}
