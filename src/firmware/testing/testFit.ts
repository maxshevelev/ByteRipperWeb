import { sourceOver } from "@/firmware/byteSource";
import { FIT, FIT_SIGNATURE_BYTES } from "@/firmware/fit/fitEntry";
import { ImageReader } from "@/firmware/imageReader";
import { BinaryWriter } from "@/firmware/testing/testImage";
import { sum8, sum32Of } from "@/firmware/uefi/checksums";

/**
 * Images with a FIT in them, built byte by byte. Ported from upstream's
 * `TestFIT.swift`.
 *
 * The tables worth testing against are the broken ones — an address off by a
 * digit, a checksum left over from the edit before, types out of order — and
 * those have to be built rather than found. Every way of breaking one is a
 * parameter here, and no real dump goes into this repository.
 */

/** A row of the table, said in terms of what it is meant to point at. */
export interface TestRow {
  readonly type: number;
  /** An offset in the image; turned into an address by the builder. */
  readonly target?: number;
  /** Or an address written literally, for the rows that are wrong. */
  readonly address?: number;
  readonly size?: number;
  readonly reserved?: number;
  readonly version?: number;
  readonly checksumValid?: boolean;
  readonly checksum?: number;
}

/** What the reader assumes when no volume top file says otherwise. */
export const assumedAddressDiff = (size: number): number => 0x1_0000_0000 - size;

function entryBytes(options: {
  readonly addressBytes?: Uint8Array;
  readonly address?: number;
  readonly size: number;
  readonly reserved: number;
  readonly version: number;
  readonly type: number;
  readonly checksumValid: boolean;
  readonly checksum: number;
}): Uint8Array {
  const writer = new BinaryWriter();
  if (options.addressBytes !== undefined) writer.raw(options.addressBytes);
  else writer.u64(options.address ?? 0);
  writer
    .u24(options.size)
    .u8(options.reserved)
    .u16(options.version)
    .u8((options.type & 0x7f) | (options.checksumValid ? 0x80 : 0))
    .u8(options.checksum);
  return writer.bytes;
}

/** An image the size of a small flash chip, erased, with a table in it. */
export function fitImage(options: {
  readonly size?: number;
  readonly tableOffset?: number;
  readonly rows: readonly TestRow[];
  readonly pointerAddress?: number;
  readonly entryCount?: number;
  readonly checksum?: number;
  readonly checksumValid?: boolean;
  readonly headerType?: number;
  readonly addressDiff?: number;
  readonly contents?: ReadonlyMap<number, Uint8Array>;
}): Uint8Array {
  const size = options.size ?? 0x1_0000;
  const tableOffset = options.tableOffset ?? 0x1000;
  const image = new Uint8Array(size).fill(0xff);
  const diff = options.addressDiff ?? assumedAddressDiff(size);
  for (const [offset, bytes] of options.contents ?? new Map()) image.set(bytes, offset);

  const table = new BinaryWriter();
  // The header's own `Address` field holds the signature, not a pointer.
  table.raw(
    entryBytes({
      addressBytes: FIT_SIGNATURE_BYTES,
      size: options.entryCount ?? options.rows.length + 1,
      reserved: 0,
      version: 0x0100,
      type: options.headerType ?? FIT.headerType,
      checksumValid: options.checksumValid ?? true,
      checksum: 0,
    })
  );
  for (const row of options.rows) {
    table.raw(
      entryBytes({
        address: row.address ?? (row.target === undefined ? 0 : row.target + diff),
        size: row.size ?? 0,
        reserved: row.reserved ?? 0,
        version: row.version ?? 0x0100,
        type: row.type,
        checksumValid: row.checksumValid ?? false,
        checksum: row.checksum ?? 0,
      })
    );
  }
  // The header's checksum is what makes every byte of the table sum to zero.
  const tableBytes = table.bytes;
  tableBytes[0x0f] = options.checksum ?? (0x100 - sum8(tableBytes)) & 0xff;
  image.set(tableBytes, tableOffset);

  const pointer = options.pointerAddress ?? tableOffset + diff;
  const pointerOffset = FIT.pointerAddress - diff;
  for (let index = 0; index < 4; index++) {
    image[pointerOffset + index] = Math.floor(pointer / 2 ** (8 * index)) & 0xff;
  }
  return image;
}

/** An Intel microcode image, its dword checksum correct. */
export function fitMicrocode(
  options: {
    readonly signature?: number;
    readonly revision?: number;
    readonly totalSize?: number;
    readonly platformIDs?: number;
  } = {}
): Uint8Array {
  const totalSize = options.totalSize ?? 0x100;
  const writer = new BinaryWriter()
    .u32(1) // HeaderType
    .u32(options.revision ?? 0xf0)
    .raw([0x19, 0x20]) // DateYear, BCD little-endian
    .raw([0x15, 0x07]) // DateDay, DateMonth, BCD
    .u32(options.signature ?? 0x0008_06ea)
    .u32(0) // Checksum, filled in below
    .u32(1) // LoaderRevision
    .u32(options.platformIDs ?? 1)
    .u32(0x40) // DataSize
    .u32(totalSize)
    .u32(0) // MetadataSize
    .u32(0) // UpdateRevisionMin
    .u32(0); // Reserved

  const bytes = new Uint8Array(totalSize);
  bytes.set(writer.bytes);
  bytes.fill(0x5a, writer.count);

  const sum = sum32Of({ start: 0, end: bytes.length }, new ImageReader(sourceOver(bytes))) ?? 0;
  const stored = (0x1_0000_0000 - sum) >>> 0;
  for (let index = 0; index < 4; index++) {
    bytes[0x10 + index] = (stored >>> (8 * index)) & 0xff;
  }
  return bytes;
}
