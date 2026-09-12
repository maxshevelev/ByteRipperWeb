import {
  FIT,
  FIT_ENTRY_SIZE,
  FIT_SIGNATURE_BYTES,
  type FITEntry,
  isEmptySlot,
  isHeaderEntry,
  readFitEntry,
  sizeInBytes,
} from "@/firmware/fit/fitEntry";
import type { FITProblem } from "@/firmware/fit/fitProblem";
import { problemsIn } from "@/firmware/fit/fitValidator";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { sum8Of } from "@/firmware/uefi/checksums";
import { type MicrocodeHeader, readMicrocodeHeader } from "@/firmware/uefi/microcodeParser";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";

/**
 * The table as it was found: where it is, what is in it, and what its rows
 * actually point at.
 */
export interface FITTable {
  /** The table itself, header row included. */
  readonly range: ImageRange;
  /** Where the pointer that led here lives, and what it held. */
  readonly pointerOffset: number;
  readonly pointerAddress: number;
  readonly rows: readonly FITRow[];
  /** The header's checksum byte, and what it should be for the table as it stands. */
  readonly storedChecksum: number;
  readonly computedChecksum: number;
  /**
   * The header's `ChecksumValid` bit: when it is clear, the checksum means
   * nothing and nobody checks it.
   */
  readonly checksumIsChecked: boolean;
}

export const tableHeader = (table: FITTable): FITEntry | undefined => table.rows[0]?.entry;
/** Every row but the header — what a reader of the table is actually interested in. */
export const tableEntries = (table: FITTable): readonly FITRow[] => table.rows.slice(1);
export const checksumIsCorrect = (table: FITTable): boolean =>
  table.storedChecksum === table.computedChecksum;

/** A row and what it leads to. */
export interface FITRow {
  readonly entry: FITEntry;
  readonly target: FITTarget;
}

/**
 * The size worth showing.
 *
 * For microcode the row's own field is required to be zero and the truth is in
 * the component — showing the field raw is how a tool comes to display a silent
 * `0` that is indistinguishable from "this type does not use the field".
 */
export function effectiveSize(row: FITRow): number | undefined {
  if (row.target.kind === "microcode") return row.target.header.totalSize;
  return row.entry.size === 0 ? undefined : sizeInBytes(row.entry);
}

/**
 * The first eight bytes of a policy row at version 0: a descriptor of Index/IO
 * registers rather than a pointer.
 *
 * ```
 *   0x00   2   IndexRegisterAddress
 *   0x02   2   DataRegisterAddress
 *   0x04   1   AccessWidthInBytes   (1 or 2)
 *   0x05   1   BitPosition
 *   0x06   2   Index
 * ```
 */
export interface FITIndexIODescriptor {
  readonly indexRegister: number;
  readonly dataRegister: number;
  readonly accessWidth: number;
  readonly bitPosition: number;
  readonly index: number;
}

/** What is at a row's address. */
export type FITTarget =
  /** The row points nowhere by design: the header, an empty slot. */
  | { readonly kind: "nothing" }
  /**
   * A policy row whose first eight bytes are an Index/IO register descriptor
   * rather than a pointer. Reading it as an address is exactly the mistake the
   * format invites here.
   */
  | { readonly kind: "indexIORegisters"; readonly descriptor: FITIndexIODescriptor }
  /** The address does not land in this image. */
  | { readonly kind: "outsideTheImage" }
  | { readonly kind: "microcode"; readonly header: MicrocodeHeader }
  /**
   * `FF FF FF FF`: a slot reserved for a later update, which the specification
   * allows a row to point at.
   */
  | { readonly kind: "emptyMicrocodeSlot"; readonly offset: number }
  /** Bytes in the image, named by whatever the tree says covers them. */
  | { readonly kind: "bytes"; readonly offset: number; readonly description?: string | undefined };

/** Where it is in the file, when it is anywhere. */
export function targetOffset(target: FITTarget): number | undefined {
  switch (target.kind) {
    case "microcode":
      return target.header.offset;
    case "emptyMicrocodeSlot":
    case "bytes":
      return target.offset;
    default:
      return undefined;
  }
}

/** What one look at an image found. */
export interface FITReport {
  readonly table: FITTable | undefined;
  readonly problems: readonly FITProblem[];
  /**
   * Offsets carrying the `_FIT_   ` signature, collected when the pointer did
   * not lead to a table. Both sides of the link are worth checking, and a table
   * the pointer has lost is still a table the user can look at.
   */
  readonly candidates: readonly number[];
  /** `address = offset + addressDiff`. */
  readonly addressDiff: number;
  /**
   * No Volume Top File said so, so the image was taken to be mapped against the
   * top of the address space. True for a full flash dump and false for a region
   * cut out of one — which is why it is said out loud.
   */
  readonly addressDiffIsAssumed: boolean;
}

/**
 * Finds the table and reads it.
 *
 * The image is the parse from the UEFI side, and it is used for exactly two
 * things: the address mapping, which comes from the Volume Top File and
 * therefore from a full parse, and naming what a row points at. Absent is
 * allowed — the table can still be read, on the assumption every full flash
 * dump satisfies.
 */
export function readFitTable(reader: ImageReader, image?: UEFIImage): FITReport {
  const assumed = image?.addressDiff === undefined;
  const addressDiff = image?.addressDiff ?? 0x1_0000_0000 - reader.count;
  // That the mapping was assumed is not a problem with the table: it is a
  // caveat about the reading, and it belongs in the line that says what was
  // read rather than in the list of what is wrong.
  const problems: FITProblem[] = [];

  const report = (table: FITTable | undefined, candidates: number[] = []): FITReport => ({
    table,
    problems,
    candidates,
    addressDiff,
    addressDiffIsAssumed: assumed,
  });

  const pointerOffset =
    reader.count > 0 && addressDiff <= FIT.pointerAddress
      ? offsetOf(FIT.pointerAddress, addressDiff, reader)
      : undefined;
  const pointerAddress = pointerOffset === undefined ? undefined : reader.uint32(pointerOffset);
  if (pointerOffset === undefined || pointerAddress === undefined) {
    problems.push({ detail: { kind: "imageHasNoPointer" } });
    return report(undefined, scanForSignatures(reader));
  }

  const tableOffset = offsetOf(pointerAddress, addressDiff, reader);
  if (tableOffset === undefined) {
    problems.push({
      detail: { kind: "pointerLeadsOutsideTheImage", address: pointerAddress },
      offset: pointerOffset,
    });
    return report(undefined, scanForSignatures(reader));
  }
  if (reader.uint64Bits(tableOffset) !== FIT.signature) {
    problems.push({
      detail: { kind: "noTableAtThePointer", address: pointerAddress },
      offset: tableOffset,
    });
    return report(undefined, scanForSignatures(reader));
  }

  const header = readFitEntry(tableOffset, 0, reader);
  if (header === undefined || header.size === 0) {
    problems.push({ detail: { kind: "tableHasNoEntries" }, offset: tableOffset + 0x08 });
    return report(undefined);
  }

  // The header's `Size` counts entries, not bytes — the field everyone reads
  // wrong.
  let count = header.size;
  if (tableOffset + count * FIT_ENTRY_SIZE > reader.count) {
    problems.push({
      detail: { kind: "tableRunsPastTheEnd", entries: header.size },
      offset: tableOffset + 0x08,
    });
    count = Math.floor((reader.count - tableOffset) / FIT_ENTRY_SIZE);
  }

  const rows: FITRow[] = [];
  for (let index = 0; index < count; index++) {
    const offset = tableOffset + index * FIT_ENTRY_SIZE;
    const entry = readFitEntry(offset, index, reader);
    if (entry === undefined) continue;
    rows.push({ entry, target: targetOf(entry, addressDiff, reader, image) });
  }
  const range: ImageRange = {
    start: tableOffset,
    end: tableOffset + rows.length * FIT_ENTRY_SIZE,
  };

  const table: FITTable = {
    range,
    pointerOffset,
    pointerAddress,
    rows,
    storedChecksum: header.checksum,
    computedChecksum: fitChecksum(range, reader),
    checksumIsChecked: header.checksumValid,
  };
  problems.push(...problemsIn(table));
  return report(table);
}

/**
 * The checksum the table should carry: every byte of it, with the header's own
 * checksum field counted as zero, summing to zero.
 */
export function fitChecksum(range: ImageRange, reader: ImageReader): number {
  const sum = sum8Of(range, reader);
  const stored = reader.uint8(range.start + 0x0f);
  if (sum === undefined || stored === undefined) return 0;
  return (0x100 - ((sum - stored) & 0xff)) & 0xff;
}

function offsetOf(address: number, diff: number, reader: ImageReader): number | undefined {
  if (address < diff) return undefined;
  const offset = address - diff;
  return offset + 4 <= reader.count ? offset : undefined;
}

/**
 * What a row leads to, checked by reading it — one look at forty-eight bytes,
 * and the whole class of "missed the address by a digit" is caught.
 */
function targetOf(
  entry: FITEntry,
  diff: number,
  reader: ImageReader,
  image: UEFIImage | undefined
): FITTarget {
  if (isHeaderEntry(entry) || isEmptySlot(entry)) return { kind: "nothing" };
  if (
    (entry.type === FIT.tpmPolicyType || entry.type === FIT.txtPolicyType) &&
    entry.version === FIT.policyIndexIOVersion
  ) {
    // The first eight bytes are a descriptor of Index/IO registers, not a
    // pointer — and reading them as an address is exactly the mistake the
    // format invites here. They are the row's own `Address` field, already
    // read, so there is nothing left to fetch.
    const raw = reader.uint64Bits(entry.offset) ?? 0n;
    const part = (shift: bigint, mask: bigint) => Number((raw >> shift) & mask);
    return {
      kind: "indexIORegisters",
      descriptor: {
        indexRegister: part(0n, 0xffffn),
        dataRegister: part(16n, 0xffffn),
        accessWidth: part(32n, 0xffn),
        bitPosition: part(40n, 0xffn),
        index: part(48n, 0xffffn),
      },
    };
  }
  if (entry.address < diff) return { kind: "outsideTheImage" };
  const offset = entry.address - diff;
  if (offset >= reader.count) return { kind: "outsideTheImage" };

  if (entry.type === FIT.microcodeType) {
    const header = readMicrocodeHeader(offset, reader);
    if (header !== undefined) return { kind: "microcode", header };
    if (reader.uint32(offset) === 0xffff_ffff) return { kind: "emptyMicrocodeSlot", offset };
  }
  // Named only once the tree has read that far. A node still marked expandable
  // is not an answer to "what is there" — it is the container the reading has
  // reached so far, and naming a row after it would put "BIOS region" in front
  // of an address whose real answer is a file two levels down.
  const node = image?.innermostNodeContaining(offset);
  return {
    kind: "bytes",
    offset,
    description: node === undefined || node.isExpandable ? undefined : node.name,
  };
}

/**
 * Every `_FIT_   ` in the image. Only worth doing when the pointer has failed:
 * a table the pointer agrees with makes every other candidate somebody else's
 * bytes that happened to match.
 */
export function scanForSignatures(reader: ImageReader): number[] {
  const found: number[] = [];
  const first = FIT_SIGNATURE_BYTES[0] ?? 0;
  const window = 1 << 20;
  let offset = 0;
  while (offset + FIT_SIGNATURE_BYTES.length <= reader.count) {
    const end = Math.min(offset + window, reader.count);
    const bytes = reader.bytes({ start: offset, end });
    if (bytes === undefined) break;
    // The platform's own byte search finds the candidates; the other seven
    // bytes confirm them. A step-per-byte loop over a 32 MB image is the cost
    // this exists to avoid.
    for (let at = bytes.indexOf(first); at >= 0; at = bytes.indexOf(first, at + 1)) {
      if (at + FIT_SIGNATURE_BYTES.length > bytes.length) break;
      let matches = true;
      for (let index = 1; index < FIT_SIGNATURE_BYTES.length; index++) {
        if (bytes[at + index] !== FIT_SIGNATURE_BYTES[index]) {
          matches = false;
          break;
        }
      }
      if (matches) found.push(offset + at);
    }
    if (end === reader.count) break;
    offset = end - (FIT_SIGNATURE_BYTES.length - 1);
  }
  return found;
}
