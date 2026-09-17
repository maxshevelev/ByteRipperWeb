import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { outermostSection } from "@/firmware/uefi/byteSpace";
import type { DiagnosticKind, UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { guidEquals } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapParser";
import {
  AMI_DXE_CORE,
  AMI_HASH_FILE,
  DXE_CORE,
  PHOENIX_HASH_FILE,
} from "@/firmware/uefi/knownGuids";
import { Section } from "@/firmware/uefi/sectionParser";
import { TCGHash, tcgDigest } from "@/firmware/uefi/tcgHash";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import {
  flattened,
  isNodeCompressed,
  nodeFileRange,
  nodeRange,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * A run of the file whose hash something checks at boot: change a byte inside it
 * and the check fails, whatever the tree around it says.
 *
 * Ported from `Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift`,
 * which follows `Design/UEFI/BOOT_GUARD_PROTECTED_RANGES.md` in the macOS
 * repository.
 */

/**
 * Where the list that named the range came from.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.Kind
 */
export type ProtectedRangeKind =
  /**
   * A Boot Policy IBB segment: checked by the processor and the ACM before the
   * firmware runs.
   */
  | "ibb"
  /** The Boot Policy's post-IBB hash, over the DXE root volume. */
  | "postIbb"
  /** An entry of the Microsoft PMDA element in the Boot Policy. */
  | "pmda"
  | "phoenix"
  | "amiV1"
  | "amiV2"
  | "amiV3"
  | "insyde";

/**
 * The one kind the ACM checks before the first instruction of the BIOS; every
 * other kind is checked by the firmware itself.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.Kind.isIBB
 */
export const isIbbKind = (kind: ProtectedRangeKind): boolean => kind === "ibb";

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.Kind.name */
export function protectedRangeKindName(kind: ProtectedRangeKind): string {
  switch (kind) {
    case "ibb":
      return "Boot Guard IBB segment";
    case "postIbb":
      return "Boot Guard post-IBB range";
    case "pmda":
      return "Microsoft PMDA entry";
    case "phoenix":
      return "Phoenix vendor hash range";
    case "amiV1":
      return "AMI vendor hash range (v1)";
    case "amiV2":
      return "AMI vendor hash range (v2)";
    case "amiV3":
      return "AMI vendor hash range (v3)";
    case "insyde":
      return "Insyde flash device map range";
  }
}

/**
 * A stored digest, by its TCG algorithm id.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.Digest
 */
export interface StoredDigest {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.Digest.algorithm */
  readonly algorithm: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.Digest.bytes */
  readonly bytes: Uint8Array;
}

/**
 * What hashing the range's bytes said.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.Verdict
 */
export type ProtectedRangeVerdict =
  | { readonly kind: "matches" }
  | { readonly kind: "mismatch" }
  /**
   * Stored with an algorithm this tool does not compute — SM3, or an id it does
   * not know. The range is still a range.
   */
  | { readonly kind: "unsupported"; readonly algorithm: number }
  /**
   * Not hashed: the range, or one hashed together with it, could not be placed
   * in this image, or the list stored no digest.
   */
  | { readonly kind: "unchecked" };

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange */
export interface ProtectedRange {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.kind */
  readonly kind: ProtectedRangeKind;
  /**
   * Half-open, in file offsets. Nothing when the list names the range but the
   * image cannot place it — no Volume Top File for a physical address, or no DXE
   * Core volume to start from.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.range
   */
  readonly range: ImageRange | undefined;
  /**
   * Usually one. A v2 IBB carries a digest per algorithm.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.digests
   */
  readonly digests: readonly StoredDigest[];
  /**
   * Where the list that named it is in the file.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.source
   */
  readonly source: ImageRange;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRange.verdict */
  readonly verdict: ProtectedRangeVerdict;
}

/**
 * What an edit to a run of the file breaks, strongest first.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.Protection
 */
export type Protection =
  /** Entirely within the union of the IBB ranges. */
  | "ibb"
  /** Entirely within the union of all ranges. */
  | "protected"
  /** Overlaps a range without lying inside the union. */
  | "partial";

/**
 * Every protected range an image names, and what hashing them found.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges
 */
export interface ProtectedRanges {
  /**
   * In the order the lists were read: the Boot Policy's, then the vendor hash
   * files' in the order of the tree.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.ranges
   */
  readonly ranges: readonly ProtectedRange[];
  /**
   * OBB digests a v2 Boot Policy names. Nothing in the manifest says where the
   * OBB is, so they are noted and not placed.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.obbDigests
   */
  readonly obbDigests: readonly StoredDigest[];
  /**
   * What the reading had to complain about.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.diagnostics
   */
  readonly diagnostics: readonly UEFIDiagnostic[];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.isEmpty */
export const noProtection = (ranges: ProtectedRanges): boolean =>
  ranges.ranges.length === 0 && ranges.obbDigests.length === 0;

/**
 * Against the union of the ranges, so that neither their order nor a node
 * spanning two adjacent segments changes the answer.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.protection
 */
export function protectionOfRange(
  ranges: ProtectedRanges,
  range: ImageRange
): Protection | undefined {
  if (range.end <= range.start) return undefined;
  const placed = ranges.ranges.flatMap((one) => (one.range === undefined ? [] : [one.range]));
  if (!placed.some((one) => overlaps(one, range))) return undefined;
  const ibb = ranges.ranges.flatMap((one) =>
    isIbbKind(one.kind) && one.range !== undefined ? [one.range] : []
  );
  if (unionOfRanges(ibb).some((one) => encloses(one, range))) return "ibb";
  if (unionOfRanges(placed).some((one) => encloses(one, range))) return "protected";
  return "partial";
}

/**
 * A node's protection: by its bytes of the file, or — for a node inside a
 * compressed section, whose offsets mean nothing in the file — by the outermost
 * compressed section that holds it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.protection
 */
export function protectionOfNode(
  ranges: ProtectedRanges,
  node: UEFINode,
  image: UEFIImage
): Protection | undefined {
  const range = fileRangeHolding(node, image);
  return range === undefined ? undefined : protectionOfRange(ranges, range);
}

/**
 * The ranges that share a byte with `range`, in list order.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.ranges
 */
export const rangesTouching = (
  ranges: ProtectedRanges,
  range: ImageRange
): readonly ProtectedRange[] =>
  ranges.ranges.filter((one) => one.range !== undefined && overlaps(one.range, range));

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.ranges */
export function rangesTouchingNode(
  ranges: ProtectedRanges,
  node: UEFINode,
  image: UEFIImage
): readonly ProtectedRange[] {
  const range = fileRangeHolding(node, image);
  return range === undefined ? [] : rangesTouching(ranges, range);
}

/**
 * The file bytes a node's protection is decided by.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.fileRange
 */
export function fileRangeHolding(node: UEFINode, image: UEFIImage): ImageRange | undefined {
  const own = nodeFileRange(node);
  if (own !== undefined) return own;
  const outermost = outermostSection(node.space);
  if (outermost === undefined) return undefined;
  const section = image.innermostNodeContaining(outermost);
  if (section === undefined || section.header.start !== outermost) return undefined;
  return nodeFileRange(section);
}

/**
 * Sorted, disjoint, with touching ranges joined.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.union
 */
export function unionOfRanges(ranges: readonly ImageRange[]): ImageRange[] {
  const merged: ImageRange[] = [];
  const sorted = ranges.filter((one) => one.end > one.start).sort((a, b) => a.start - b.start);
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

const overlaps = (one: ImageRange, other: ImageRange) =>
  one.start < other.end && other.start < one.end;
/**
 * Whether `other` lies entirely inside this range.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#Range
 */
const encloses = (one: ImageRange, other: ImageRange) =>
  one.start <= other.start && other.end <= one.end;

/**
 * Reads every list an image carries: the Boot Policy through the FIT, the
 * Phoenix and AMI hash files among the image's files, and the Insyde flash
 * device maps the raw-area scan found — then hashes what they name.
 *
 * Reads what `image` has materialized. The DXE root volume is found only when
 * the branch holding the DXE Core is open, so a caller that wants a post-IBB
 * range placed opens the compressed sections first.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRanges.read
 */
export function readProtectedRanges(image: UEFIImage, file: ImageReader): ProtectedRanges {
  const reading = new ProtectedRangeReading(image, file);
  reading.readBootPolicies();
  reading.readVendorHashFiles();
  reading.readFlashDeviceMaps();
  return reading.finish();
}

/**
 * The constants of the Boot Policy and the vendor tables.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy
 */
export const BootPolicy = {
  /**
   * Where the pointer to the FIT is.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.fitPointerAddress
   */
  fitPointerAddress: 0xffff_ffc0,
  /**
   * `_FIT_   `, as a pair of dwords: JavaScript has no exact 64-bit integer.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.fitSignature
   */
  fitSignatureLow: 0x5449_465f,
  fitSignatureHigh: 0x2020_205f,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.fitEntrySize */
  fitEntrySize: 16,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.fitType */
  fitType: 0x0c,

  /**
   * `__ACBP__`, each as two dwords for the same reason.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.structureID
   */
  structureIdLow: 0x4341_5f5f,
  structureIdHigh: 0x5f5f_5042,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.ibbs */
  ibbsLow: 0x4249_5f5f,
  ibbsHigh: 0x5f5f_5342,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.pmda */
  pmdaLow: 0x4d50_5f5f,
  pmdaHigh: 0x5f5f_4144,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.pmsg */
  pmsgLow: 0x4d50_5f5f,
  pmsgHigh: 0x5f5f_4753,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.v2MinVersion */
  v2MinVersion: 0x20,

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.v1HeaderSize */
  v1HeaderSize: 0x10,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.v1ElementHeaderSize */
  v1ElementHeaderSize: 9,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.v2HeaderSize */
  v2HeaderSize: 0x14,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.v2ElementHeaderSize */
  v2ElementHeaderSize: 0x0c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.segmentSize */
  segmentSize: 0x0c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.hashV1Size */
  hashV1Size: 0x24,

  /**
   * More elements than any manifest has: a list that goes on is a loop.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.maxElements
   */
  maxElements: 64,

  /**
   * `$HASHTBL`, as two dwords.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.phoenixSignature
   */
  phoenixSignatureLow: 0x5341_4824,
  phoenixSignatureHigh: 0x4c42_5448,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#BootPolicy.vendorEntrySize */
  vendorEntrySize: 0x28,
} as const;

/** One IBB segment, as the manifest stores it. */
interface Segment {
  readonly flags: number;
  readonly base: number;
  readonly size: number;
}

/**
 * The ranges one digest covers: an IBB's segments, an AMI v3 table's four — or a
 * single range. One verdict for all of them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.Group
 */
interface Group {
  readonly kind: ProtectedRangeKind;
  members: (ImageRange | undefined)[];
  readonly digests: readonly StoredDigest[];
  readonly source: ImageRange;
  /**
   * A member was dropped as outside the image, so the bytes the digest was taken
   * over are not all here.
   */
  incomplete: boolean;
  /** AMI v3 hashes its ranges in file order, whatever the table's order. */
  readonly hashedInFileOrder: boolean;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.Placement */
type Placement =
  | { readonly kind: "placed"; readonly range: ImageRange }
  /** An erased or unused slot, not a range. */
  | { readonly kind: "unused" }
  | { readonly kind: "outside" }
  /** A physical address with no Volume Top File to map it. */
  | { readonly kind: "unmapped" };

/**
 * One read of the lists. A class because every list appends to the same groups
 * and diagnostics, as the parser does.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading
 */
class ProtectedRangeReading {
  private readonly image: UEFIImage;
  private readonly file: ImageReader;
  private readonly nodes: readonly UEFINode[];
  private readonly groups: Group[] = [];
  private readonly obbDigests: StoredDigest[] = [];
  private readonly diagnostics: UEFIDiagnostic[] = [];
  private dxeRoot: { readonly range: ImageRange | undefined } | undefined;
  private regionsBase: number | undefined;

  constructor(image: UEFIImage, file: ImageReader) {
    this.image = image;
    this.file = file;
    this.nodes = image.roots.flatMap((root) => flattened(root));
  }

  private note(detail: DiagnosticKind, offset: number): void {
    this.diagnostics.push({ detail, offset });
  }

  // MARK: - The Boot Policy

  /**
   * Every FIT row of type `0x0C`. The table's own validation is the FIT tool's;
   * this is one read of the rows.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.readBootPolicies
   */
  readBootPolicies(): void {
    const pointer = this.image.offsetForAddress(BootPolicy.fitPointerAddress);
    if (pointer === undefined) return;
    const tableAddress = this.file.uint32(pointer);
    if (tableAddress === undefined) return;
    const table = this.image.offsetForAddress(tableAddress);
    if (table === undefined) return;
    if (
      this.file.uint32(table) !== BootPolicy.fitSignatureLow ||
      this.file.uint32(table + 4) !== BootPolicy.fitSignatureHigh
    ) {
      return;
    }
    const declared = this.file.uint24(table + 8);
    if (declared === undefined) return;
    const rows = Math.min(
      declared,
      Math.floor((this.file.count - table) / BootPolicy.fitEntrySize)
    );
    if (rows <= 1) return;
    for (let index = 1; index < rows; index++) {
      const row = table + index * BootPolicy.fitEntrySize;
      const type = this.file.uint8(row + 0x0e);
      const address = this.file.uint64(row);
      if (type === undefined || (type & 0x7f) !== BootPolicy.fitType || address === undefined) {
        continue;
      }
      const manifest = this.image.offsetForAddress(address);
      if (manifest === undefined) {
        this.note({ kind: "protectedRangeOutsideImage", name: "Boot Policy Manifest" }, row);
        continue;
      }
      const version = this.file.uint8(manifest + 8);
      if (
        this.file.uint32(manifest) !== BootPolicy.structureIdLow ||
        this.file.uint32(manifest + 4) !== BootPolicy.structureIdHigh ||
        version === undefined
      ) {
        this.note({ kind: "truncated", structure: "bootPolicy" }, manifest);
        continue;
      }
      if (version < BootPolicy.v2MinVersion) this.bootPolicyV1(manifest);
      else this.bootPolicyV2(manifest);
    }
  }

  /**
   * An element has no size, so an unknown one ends the reading.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.bootPolicyV1
   */
  private bootPolicyV1(manifest: number): void {
    let offset = manifest + BootPolicy.v1HeaderSize;
    for (let element = 0; element < BootPolicy.maxElements; element++) {
      const low = this.file.uint32(offset);
      const high = this.file.uint32(offset + 4);
      if (low === undefined || high === undefined) {
        this.note({ kind: "truncated", structure: "bootPolicy" }, offset);
        return;
      }
      const body = offset + BootPolicy.v1ElementHeaderSize;
      if (low === BootPolicy.ibbsLow && high === BootPolicy.ibbsHigh) {
        const postIbb = this.hashV1(body + 0x2f);
        const ibb = this.hashV1(body + 0x57);
        const count = this.file.uint8(body + 0x7b);
        const list =
          count === undefined ? undefined : this.segments(body + 0x7c, count, this.file.count);
        if (
          postIbb === undefined ||
          ibb === undefined ||
          count === undefined ||
          list === undefined
        ) {
          this.note({ kind: "truncated", structure: "bootPolicy" }, offset);
          return;
        }
        const end = body + 0x7c + count * BootPolicy.segmentSize;
        this.addIbb(list, [ibb], { start: offset, end });
        this.addPostIbb(postIbb, { start: offset, end });
        offset = end;
      } else if (low === BootPolicy.pmdaLow && high === BootPolicy.pmdaHigh) {
        const version = this.file.uint32(body + 2);
        const count = this.file.uint32(body + 6);
        if (version === undefined || count === undefined) {
          this.note({ kind: "truncated", structure: "bootPolicy" }, offset);
          return;
        }
        let entrySize: number;
        if (version === 1) entrySize = 0x28;
        else if (version === 2) entrySize = 0x2c;
        else {
          this.note(
            { kind: "unknownType", structure: "bootPolicy", code: version & 0xff },
            body + 2
          );
          return;
        }
        const entries = body + 0x0a;
        const span = this.file.range(entries, count * entrySize);
        if (span === undefined) {
          this.note({ kind: "truncated", structure: "bootPolicy" }, offset);
          return;
        }
        for (let index = 0; index < count; index++) {
          const entry = entries + index * entrySize;
          // Version 1 stores a bare SHA-256, version 2 a `HASH_V1`.
          const stored =
            version === 1 ? this.digestAt(entry + 8, 32, TCGHash.sha256) : this.hashV1(entry + 8);
          const base = this.file.uint32(entry);
          const size = this.file.uint32(entry + 4);
          if (base === undefined || size === undefined || stored === undefined) {
            this.note({ kind: "truncated", structure: "bootPolicy" }, entry);
            return;
          }
          this.addSingle("pmda", this.physical(base, size), stored, {
            start: entry,
            end: entry + entrySize,
          });
        }
        offset = span.end;
      } else {
        // `__PMSG__` is always last; anything else cannot be stepped over.
        return;
      }
    }
  }

  /**
   * Elements carry their size, so unknown ones are stepped over.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.bootPolicyV2
   */
  private bootPolicyV2(manifest: number): void {
    let offset = manifest + BootPolicy.v2HeaderSize;
    for (let index = 0; index < BootPolicy.maxElements; index++) {
      const low = this.file.uint32(offset);
      const high = this.file.uint32(offset + 4);
      const total = this.file.uint16(offset + 0x0a);
      if (low === undefined || high === undefined || total === undefined) {
        this.note({ kind: "truncated", structure: "bootPolicy" }, offset);
        return;
      }
      if (total === 0 || (low === BootPolicy.pmsgLow && high === BootPolicy.pmsgHigh)) return;
      const element = this.file.range(offset, total);
      if (total < BootPolicy.v2ElementHeaderSize || element === undefined) {
        this.note({ kind: "truncated", structure: "bootPolicy" }, offset);
        return;
      }
      const body = offset + BootPolicy.v2ElementHeaderSize;
      if (low === BootPolicy.ibbsLow && high === BootPolicy.ibbsHigh) {
        if (!this.ibbsV2(body, element)) {
          this.note({ kind: "truncated", structure: "bootPolicy" }, offset);
          return;
        }
      } else if (low === BootPolicy.pmdaLow && high === BootPolicy.pmdaHigh) {
        if (!this.pmdaV2(body, element)) {
          this.note({ kind: "truncated", structure: "bootPolicy" }, offset);
          return;
        }
      }
      offset = element.end;
    }
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.ibbsV2 */
  private ibbsV2(body: number, element: ImageRange): boolean {
    const limit = element.end;
    let cursor = body + 0x30;
    const postIbb = this.hashV2(cursor, limit);
    if (postIbb === undefined) return false;
    cursor = postIbb.end;
    const count = this.file.uint16(cursor + 6);
    if (!this.fits(cursor, 8, limit) || count === undefined) return false;
    cursor += 8; // IbbEntryPoint, IbbDigestsSize, NumIbbDigests
    const digests: StoredDigest[] = [];
    for (let index = 0; index < count; index++) {
      const digest = this.hashV2(cursor, limit);
      if (digest === undefined) return false;
      digests.push(digest.digest);
      cursor = digest.end;
    }
    const obb = this.hashV2(cursor, limit);
    if (obb === undefined) return false;
    cursor = obb.end;
    const segmentCount = this.file.uint8(cursor + 3);
    if (!this.fits(cursor, 4, limit) || segmentCount === undefined) return false;
    const segments = this.segments(cursor + 4, segmentCount, limit);
    if (segments === undefined) return false;
    this.addIbb(segments, digests, element);
    this.addPostIbb(postIbb.digest, element);
    if (!isUniform(obb.digest.bytes)) this.obbDigests.push(obb.digest);
    return true;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.pmdaV2 */
  private pmdaV2(body: number, element: ImageRange): boolean {
    const limit = element.end;
    const version = this.file.uint32(body + 4);
    const count = this.file.uint32(body + 8);
    if (!this.fits(body, 0x0c, limit) || version === undefined || count === undefined) return false;
    if (version !== 3) {
      this.note({ kind: "unknownType", structure: "bootPolicy", code: version & 0xff }, body + 4);
      return true;
    }
    let entry = body + 0x0c;
    for (let index = 0; index < count; index++) {
      const base = this.file.uint32(entry + 4);
      const size = this.file.uint32(entry + 8);
      const entrySize = this.file.uint16(entry + 0x0c);
      if (
        !this.fits(entry, 0x14, limit) ||
        base === undefined ||
        size === undefined ||
        entrySize === undefined ||
        entrySize < 0x14
      ) {
        return false;
      }
      const digest = this.hashV2(entry + 0x10, limit);
      if (digest === undefined) return false;
      this.addSingle("pmda", this.physical(base, size), digest.digest, {
        start: entry,
        end: entry + entrySize,
      });
      entry += entrySize;
    }
    return true;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.hashV1 */
  private hashV1(offset: number): StoredDigest | undefined {
    const algorithm = this.file.uint16(offset);
    const size = this.file.uint16(offset + 2);
    const bytes = this.file.bytes({ start: offset + 4, end: offset + 4 + 32 });
    if (algorithm === undefined || size === undefined || bytes === undefined) return undefined;
    return { algorithm, bytes: bytes.subarray(0, Math.min(size, 32)) };
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.hashV2 */
  private hashV2(
    cursor: number,
    limit: number
  ): { readonly digest: StoredDigest; readonly end: number } | undefined {
    const algorithm = this.file.uint16(cursor);
    const size = this.file.uint16(cursor + 2);
    if (!this.fits(cursor, 4, limit) || algorithm === undefined || size === undefined) {
      return undefined;
    }
    if (!this.fits(cursor + 4, size, limit)) return undefined;
    const bytes = this.file.bytes({ start: cursor + 4, end: cursor + 4 + size });
    if (bytes === undefined) return undefined;
    return { digest: { algorithm, bytes }, end: cursor + 4 + size };
  }

  private digestAt(offset: number, count: number, algorithm: number): StoredDigest | undefined {
    const bytes = this.file.bytes({ start: offset, end: offset + count });
    return bytes === undefined ? undefined : { algorithm, bytes };
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.segments */
  private segments(offset: number, count: number, limit: number): Segment[] | undefined {
    if (!this.fits(offset, count * BootPolicy.segmentSize, limit)) return undefined;
    const list: Segment[] = [];
    for (let index = 0; index < count; index++) {
      const segment = offset + index * BootPolicy.segmentSize;
      const flags = this.file.uint16(segment + 2);
      const base = this.file.uint32(segment + 4);
      const size = this.file.uint32(segment + 8);
      if (flags === undefined || base === undefined || size === undefined) continue;
      list.push({ flags, base, size });
    }
    return list;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.fits */
  private fits(offset: number, count: number, limit: number): boolean {
    const range = this.file.range(offset, count);
    return range !== undefined && range.end <= limit;
  }

  /**
   * Segments with `Flags == 0` make up the IBB; the rest are non-IBB and name
   * nothing.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.addIBB
   */
  private addIbb(
    segments: readonly Segment[],
    digests: readonly StoredDigest[],
    source: ImageRange
  ): void {
    const group: Group = {
      kind: "ibb",
      members: [],
      digests,
      source,
      incomplete: false,
      hashedInFileOrder: false,
    };
    for (const segment of segments) {
      if (segment.flags !== 0) continue;
      this.add(this.physical(segment.base, segment.size), group);
    }
    if (group.members.length > 0 || group.incomplete) this.groups.push(group);
  }

  /**
   * Only when the digest is not uniform: all `0x00` or all `0xFF` is a manifest
   * that names no post-IBB range.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.addPostIBB
   */
  private addPostIbb(digest: StoredDigest, source: ImageRange): void {
    if (isUniform(digest.bytes)) return;
    const volume = this.dxeRootVolume();
    const group: Group = {
      kind: "postIbb",
      members: [],
      digests: [digest],
      source,
      incomplete: false,
      hashedInFileOrder: false,
    };
    if (volume !== undefined) {
      group.members = [volume];
    } else {
      this.note(
        { kind: "protectedRangeNotPlaced", name: protectedRangeKindName("postIbb") },
        source.start
      );
      group.members = [undefined];
    }
    this.groups.push(group);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.addSingle */
  private addSingle(
    kind: ProtectedRangeKind,
    placement: Placement,
    digest: StoredDigest,
    source: ImageRange
  ): void {
    const group: Group = {
      kind,
      members: [],
      digests: [digest],
      source,
      incomplete: false,
      hashedInFileOrder: false,
    };
    this.add(placement, group);
    if (group.members.length > 0 || group.incomplete) this.groups.push(group);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.add */
  private add(placement: Placement, group: Group): void {
    switch (placement.kind) {
      case "placed":
        group.members.push(placement.range);
        break;
      case "unused":
        break;
      case "outside":
        // Not in this image: reported and dropped, never used unconverted the
        // way UEFITool does.
        this.note(
          { kind: "protectedRangeOutsideImage", name: protectedRangeKindName(group.kind) },
          group.source.start
        );
        group.incomplete = true;
        break;
      case "unmapped":
        this.note(
          { kind: "protectedRangeNotPlaced", name: protectedRangeKindName(group.kind) },
          group.source.start
        );
        group.members.push(undefined);
        break;
    }
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.physical */
  private physical(base: number, size: number): Placement {
    if (!isUsed(base, size)) return { kind: "unused" };
    const addressDiff = this.image.addressDiff;
    if (addressDiff === undefined) return { kind: "unmapped" };
    if (base < addressDiff) return { kind: "outside" };
    return this.inImage(base - addressDiff, size);
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.inImage */
  private inImage(offset: number, size: number): Placement {
    const range = this.file.range(offset, size);
    return range === undefined ? { kind: "outside" } : { kind: "placed", range };
  }

  // MARK: - Where a range with no address starts

  /**
   * The outermost volume holding the first DXE Core, in the file — through any
   * compressed section the core itself sits in.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.dxeRootVolume
   */
  private dxeRootVolume(): ImageRange | undefined {
    if (this.dxeRoot !== undefined) return this.dxeRoot.range;
    const core = this.nodes.find(
      (node) =>
        node.kind === "file" &&
        node.guid !== undefined &&
        (guidEquals(node.guid, DXE_CORE) || guidEquals(node.guid, AMI_DXE_CORE))
    );
    let outermost: UEFINode | undefined;
    if (core !== undefined) {
      const path = [...core.id];
      while (path.length > 0) {
        path.pop();
        const ancestor = this.image.node(path);
        if (ancestor?.kind === "volume" && !isNodeCompressed(ancestor)) outermost = ancestor;
      }
    }
    const range = outermost === undefined ? undefined : nodeFileRange(outermost);
    this.dxeRoot = { range };
    return range;
  }

  /**
   * What Phoenix entries are relative to: the first element of the BIOS region,
   * or the image's start when there is no descriptor.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.protectedRegionsBase
   */
  private protectedRegionsBase(): number {
    if (this.regionsBase !== undefined) return this.regionsBase;
    const bios = this.nodes.find(
      (node) => node.kind === "region" && node.subtype === Sub.biosRegion
    );
    if (bios === undefined) {
      this.regionsBase = 0;
      return 0;
    }
    const first = bios.children.find((child) => child.kind !== "padding");
    this.regionsBase = first === undefined ? bios.body.start : nodeRange(first).start;
    return this.regionsBase;
  }

  // MARK: - Vendor hash files

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.readVendorHashFiles */
  readVendorHashFiles(): void {
    for (const node of this.nodes) {
      if (node.kind !== "file" || isNodeCompressed(node) || node.guid === undefined) continue;
      if (guidEquals(node.guid, PHOENIX_HASH_FILE)) this.phoenix(node);
      else if (guidEquals(node.guid, AMI_HASH_FILE)) this.ami(node);
    }
  }

  /**
   * The file's body is the table.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.phoenix
   */
  private phoenix(node: UEFINode): void {
    const body = node.body;
    if (
      this.file.uint32(body.start) !== BootPolicy.phoenixSignatureLow ||
      this.file.uint32(body.start + 4) !== BootPolicy.phoenixSignatureHigh
    ) {
      return;
    }
    const count = this.file.uint32(body.start + 8);
    if (count === undefined || count * BootPolicy.vendorEntrySize + 0x0c > body.end - body.start) {
      this.note({ kind: "truncated", structure: "vendorHashFile" }, body.start);
      return;
    }
    for (let index = 0; index < count; index++) {
      const entry = body.start + 0x0c + index * BootPolicy.vendorEntrySize;
      const hash = this.digestAt(entry, 32, TCGHash.sha256);
      const base = this.file.uint32(entry + 32);
      const size = this.file.uint32(entry + 36);
      if (hash === undefined || base === undefined || size === undefined) {
        this.note({ kind: "truncated", structure: "vendorHashFile" }, entry);
        return;
      }
      const placement: Placement = isUsed(base, size)
        ? this.inImage(this.protectedRegionsBase() + base, size)
        : { kind: "unused" };
      this.addSingle("phoenix", placement, hash, {
        start: entry,
        end: entry + BootPolicy.vendorEntrySize,
      });
    }
  }

  /**
   * The body of a raw section, versioned by its size alone.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.ami
   */
  private ami(node: UEFINode): void {
    const raw = flattened(node)
      .slice(1)
      .find(
        (one) => one.kind === "section" && one.subtype === Section.raw && !isNodeCompressed(one)
      );
    if (raw === undefined) return;
    const body = raw.body;
    const start = body.start;
    const size = body.end - body.start;
    const hash = this.digestAt(start, Math.min(size, 32), TCGHash.sha256);
    if (hash === undefined) {
      this.note({ kind: "truncated", structure: "vendorHashFile" }, start);
      return;
    }

    if (size === 0x24) {
      const length = this.file.uint32(start + 32);
      if (length === undefined || !isUsed(0, length)) return;
      const volume = this.dxeRootVolume();
      const group: Group = {
        kind: "amiV1",
        members: [],
        digests: [hash],
        source: body,
        incomplete: false,
        hashedInFileOrder: false,
      };
      if (volume !== undefined) {
        this.add(this.inImage(volume.start, length), group);
      } else {
        this.note(
          { kind: "protectedRangeNotPlaced", name: protectedRangeKindName("amiV1") },
          start
        );
        group.members = [undefined];
      }
      if (group.members.length > 0 || group.incomplete) this.groups.push(group);
      return;
    }

    if (size === 0x50) {
      for (let index = 0; index < 2; index++) {
        const entry = start + index * BootPolicy.vendorEntrySize;
        const entryHash = this.digestAt(entry, 32, TCGHash.sha256);
        const base = this.file.uint32(entry + 32);
        const length = this.file.uint32(entry + 36);
        if (entryHash === undefined || base === undefined || length === undefined) return;
        this.addSingle("amiV2", this.physical(base, length), entryHash, {
          start: entry,
          end: entry + BootPolicy.vendorEntrySize,
        });
      }
      return;
    }

    if (size === 0x70) {
      const group: Group = {
        kind: "amiV3",
        members: [],
        digests: [hash],
        source: body,
        incomplete: false,
        hashedInFileOrder: true,
      };
      // Three FvMain segments, then the nested volume.
      const fields: readonly (readonly [number, number])[] = [
        [32, 44],
        [36, 48],
        [40, 52],
        [56, 60],
      ];
      for (const [baseAt, sizeAt] of fields) {
        const base = this.file.uint32(start + baseAt);
        const length = this.file.uint32(start + sizeAt);
        if (base === undefined || length === undefined) return;
        this.add(this.physical(base, length), group);
      }
      if (group.members.length > 0 || group.incomplete) this.groups.push(group);
      return;
    }

    this.note({ kind: "unknownVendorHashFileSize", size }, start);
  }

  // MARK: - The Insyde flash device map

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.readFlashDeviceMaps */
  readFlashDeviceMaps(): void {
    for (const store of this.nodes) {
      if (store.kind !== "flashDeviceMapStore" || isNodeCompressed(store)) continue;
      const base = this.file.uint64(store.header.start + FlashDeviceMap.baseAddressOffset);
      if (base === undefined) continue;
      for (const entry of store.children) {
        if (entry.kind !== "flashDeviceMapEntry") continue;
        const at = entry.header.start;
        const offset = this.file.uint64(at + FlashDeviceMap.regionOffsetOffset);
        const size = this.file.uint64(at + FlashDeviceMap.regionSizeOffset);
        const attributes = this.file.uint32(at + FlashDeviceMap.attributesOffset);
        const hash = this.digestAt(at + FlashDeviceMap.hashOffset, 32, TCGHash.sha256);
        if (
          offset === undefined ||
          size === undefined ||
          attributes === undefined ||
          hash === undefined
        ) {
          continue;
        }
        // UEFITool looks at MODIFIABLE alone: an entry marked IGNORED and not
        // MODIFIABLE is still a range. Followed until a real image says
        // otherwise.
        if ((attributes & FlashDeviceMap.modifiable) !== 0) continue;
        const address = (low32(base) + low32(offset)) >>> 0;
        this.addSingle("insyde", this.physical(address, low32(size)), hash, entry.header);
      }
    }
  }

  // MARK: - Hashing

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.finish */
  finish(): ProtectedRanges {
    const ranges: ProtectedRange[] = [];
    for (const group of this.groups) {
      const verdict = this.verdict(group);
      for (const member of group.members) {
        ranges.push({
          kind: group.kind,
          range: member,
          digests: group.digests,
          source: group.source,
          verdict,
        });
      }
    }
    return { ranges, obbDigests: this.obbDigests, diagnostics: this.diagnostics };
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.verdict */
  private verdict(group: Group): ProtectedRangeVerdict {
    const placed = group.members.filter((one): one is ImageRange => one !== undefined);
    const digests = group.digests.filter(
      (one) => one.bytes.length > 0 && one.algorithm !== TCGHash.null
    );
    if (
      group.incomplete ||
      placed.length === 0 ||
      placed.length !== group.members.length ||
      digests.length === 0
    ) {
      return { kind: "unchecked" };
    }
    const hashed = group.hashedInFileOrder ? [...placed].sort((a, b) => a.start - b.start) : placed;
    let computedAny = false;
    let mismatch = false;
    let unsupported: number | undefined;
    for (const digest of digests) {
      const computed = tcgDigest(hashed, this.file, digest.algorithm);
      if (computed === undefined) {
        unsupported = unsupported ?? digest.algorithm;
        continue;
      }
      computedAny = true;
      if (!sameDigest(computed, digest.bytes)) mismatch = true;
    }
    if (unsupported !== undefined && !computedAny) {
      this.note({ kind: "unsupportedHashAlgorithm", algorithm: unsupported }, group.source.start);
      return { kind: "unsupported", algorithm: unsupported };
    }
    if (mismatch) {
      this.note(
        { kind: "protectedRangeHashMismatch", name: protectedRangeKindName(group.kind) },
        placed[0]?.start ?? group.source.start
      );
      return { kind: "mismatch" };
    }
    return { kind: "matches" };
  }
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.isUsed */
const isUsed = (base: number, size: number) =>
  base !== 0xffff_ffff && size !== 0 && size !== 0xffff_ffff;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ProtectedRanges.swift#ProtectedRangeReading.isUniform */
const isUniform = (bytes: Uint8Array) =>
  bytes.every((byte) => byte === 0x00) || bytes.every((byte) => byte === 0xff);

const sameDigest = (one: Uint8Array, other: Uint8Array) =>
  one.length === other.length && one.every((byte, index) => byte === other[index]);

/**
 * The low 32 bits of a 64-bit field, which is what the flash device map's
 * addresses are truncated to.
 */
const low32 = (value: number) => (value % 0x1_0000_0000) >>> 0;
