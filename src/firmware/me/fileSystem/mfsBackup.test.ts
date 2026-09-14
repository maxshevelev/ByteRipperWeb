import { describe, expect, it } from "vitest";
import { crc32 } from "@/firmware/me/crypto/checksum";
import { parseMfsBackup, reconstructR0Body } from "@/firmware/me/fileSystem/mfsBackup";

/**
 * The MFS backup decode. Ported from upstream's `MFSBackupTests`: no real dump
 * carries an MFSB area, so the fixtures are the oracle — R0's CRC is computed by
 * an independent bitwise implementation, never the decoder's own path.
 */

const SIGNATURE = 0x4d46_5342;
const R1_HEADER_SIZE = 0x24;
const ENTRY_HEADER_SIZE = 0x10;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const put16 = (bytes: Uint8Array, at: number, value: number) =>
  view(bytes).setUint16(at, value, true);
const put32 = (bytes: Uint8Array, at: number, value: number) =>
  view(bytes).setUint32(at, value >>> 0, true);

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0));
  let at = 0;
  for (const one of parts) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

/** Bitwise reflected CRC-32 from a zero register, no final xor. */
function crcFromZero(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
  }
  return crc >>> 0;
}

const fill = (count: number, seed = 0x11) =>
  Uint8Array.from({ length: count }, (_, i) => (seed + i) & 0xff);

function makeEntry(data: Uint8Array): Uint8Array {
  const blob = new Uint8Array(ENTRY_HEADER_SIZE + data.length);
  put32(blob, 0, 1);
  put32(blob, 8, data.length);
  put32(blob, 4, crc32(concat(blob.subarray(0, 4), new Uint8Array(4), blob.subarray(8, 0x0c))));
  put32(blob, 0x0c, crc32(data));
  blob.set(data, ENTRY_HEADER_SIZE);
  return blob;
}

function makeR1(data6: Uint8Array, data9: Uint8Array, data7: Uint8Array, revision = 1): Uint8Array {
  const b6 = makeEntry(data6);
  const b9 = makeEntry(data9);
  const b7 = makeEntry(data7);
  const header = new Uint8Array(R1_HEADER_SIZE);
  put32(header, 0, SIGNATURE);
  put32(header, 4, revision);
  put32(header, 0x0c, R1_HEADER_SIZE);
  put32(header, 0x10, b6.length);
  put32(header, 0x14, R1_HEADER_SIZE + b6.length);
  put32(header, 0x18, b9.length);
  put32(header, 0x1c, R1_HEADER_SIZE + b6.length + b9.length);
  put32(header, 0x20, b7.length);
  put32(header, 8, crc32(concat(header.subarray(0, 8), new Uint8Array(4), header.subarray(0x0c))));
  return concat(header, b6, b9, b7);
}

/** A two-page MFS volume: the target an R0 backup rebuilds into. */
function makeMfsVolume(): Uint8Array {
  const system = new Uint8Array(0x2000).fill(0xff);
  put32(system, 0, 0xaa55_7887);
  put32(system, 4, 1);
  put32(system, 8, 0);
  put16(system, 12, 2);
  put16(system, 14, 0);
  const sysChunkCount = Math.floor((0x2000 - 0x12 - 2) / (2 + 0x42));
  put16(system, 0x12, 0x0b5b);
  for (let slot = 1; slot <= sysChunkCount; slot++) put16(system, 0x12 + slot * 2, 0xc000);
  const chunk = new Uint8Array(0x40);
  put32(chunk, 0, 0x724f_6201);
  chunk[4] = 0x0a;
  chunk[5] = 0x01;
  put16(chunk, 6, 0xabcd);
  put32(chunk, 8, 0x1200);
  put16(chunk, 12, 7);
  put16(chunk, 0x0e, 0x0005);
  put16(chunk, 0x10, 0xffff);
  system.set(chunk, 0x12 + sysChunkCount * 2 + 2);

  const data = new Uint8Array(0x2000).fill(0xff);
  put32(data, 0, 0xaa55_7887);
  put32(data, 4, 2);
  put16(data, 14, 1);
  return concat(system, data);
}

/** Every run of 0xFF replaced by the marker and its big-endian length. */
function compact(image: Uint8Array): Uint8Array {
  const out: number[] = [];
  let index = 0;
  while (index < image.length) {
    if (image[index] === 0xff) {
      let end = index;
      while (end < image.length && image[end] === 0xff) end++;
      const length = end - index;
      out.push(
        0x01,
        0x03,
        0x02,
        0x04,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff
      );
      index = end;
    } else {
      out.push(image[index] ?? 0);
      index++;
    }
  }
  return Uint8Array.from(out);
}

function makeR0(body: Uint8Array): Uint8Array {
  const area = new Uint8Array(0x20 + body.length).fill(0xff);
  put32(area, 0, SIGNATURE);
  put32(area, 4, crcFromZero(body));
  area.set(body, 0x20);
  return area;
}

const parse = (area: Uint8Array, absoluteOffset = 0) =>
  parseMfsBackup(area, 0, area.length, absoluteOffset);

describe("an R0 backup", () => {
  it("reads its header and rebuilds into a valid volume", () => {
    const backup = parse(makeR0(compact(makeMfsVolume())), 0x4000);
    expect(backup).toEqual({
      offset: 0x4000,
      format: "r0",
      headerCRCStored: backup?.headerCRCStored,
      headerCRCValid: true,
      reservedAllFF: true,
      reconstructedVolumeParses: true,
      headerRevision: undefined,
      headerRevisionValid: undefined,
      entries: [],
    });
  });

  it("round-trips the compaction", () => {
    const target = makeMfsVolume();
    expect(reconstructR0Body(compact(target))).toEqual(target);
  });

  it("reports a corrupted body", () => {
    const area = makeR0(compact(makeMfsVolume()));
    area[0x20 + 0x10] = (area[0x20 + 0x10] ?? 0) ^ 0xff;
    const backup = parse(area);
    expect(backup?.format).toBe("r0");
    expect(backup?.headerCRCValid).toBe(false);
  });

  it("says a body that rebuilds into no MFS does not parse", () => {
    const backup = parse(makeR0(new Uint8Array(0x400).fill(0x55)));
    expect(backup?.headerCRCValid).toBe(true);
    expect(backup?.reconstructedVolumeParses).toBe(false);
  });
});

describe("an R1 backup", () => {
  it("reads its header and its three entries", () => {
    const d6 = fill(0x10);
    const d9 = fill(0x20, 0x22);
    const d7 = fill(0x30, 0x33);
    const backup = parse(makeR1(d6, d9, d7), 0x1000);

    expect(backup).toMatchObject({
      offset: 0x1000,
      format: "r1",
      reservedAllFF: undefined,
      reconstructedVolumeParses: undefined,
      headerRevision: 1,
      headerRevisionValid: true,
      headerCRCValid: true,
    });
    const entries = backup?.entries ?? [];
    expect(entries.map((one) => one.fileIndex)).toEqual([6, 9, 7]);
    const b6 = ENTRY_HEADER_SIZE + d6.length;
    const b9 = ENTRY_HEADER_SIZE + d9.length;
    expect(entries.map((one) => [one.blobOffset, one.blobSize])).toEqual([
      [R1_HEADER_SIZE, b6],
      [R1_HEADER_SIZE + b6, b9],
      [R1_HEADER_SIZE + b6 + b9, ENTRY_HEADER_SIZE + d7.length],
    ]);
    [d6, d9, d7].forEach((data, index) => {
      expect(entries[index]).toMatchObject({
        revision: 1,
        revisionValid: true,
        headerCRCValid: true,
        dataSize: data.length,
        dataCRCValid: true,
      });
    });
  });

  it("reports a corrupted header CRC", () => {
    const area = makeR1(fill(0x10), fill(0x20), fill(0x30));
    area[0x08] = (area[0x08] ?? 0) ^ 0xff;
    const backup = parse(area);
    expect(backup?.headerCRCValid).toBe(false);
    expect(backup?.headerRevisionValid).toBe(true);
    expect(backup?.entries.every((one) => one.headerCRCValid && one.dataCRCValid)).toBe(true);
  });

  it("reports a header revision mismatch", () => {
    const backup = parse(makeR1(fill(0x10), fill(0x20), fill(0x30), 2));
    expect(backup?.headerRevision).toBe(2);
    expect(backup?.headerRevisionValid).toBe(false);
    expect(backup?.headerCRCValid).toBe(true);
  });

  it("isolates an invalid entry header CRC", () => {
    const area = makeR1(fill(0x10), fill(0x20), fill(0x30));
    area[R1_HEADER_SIZE + 0x04] = (area[R1_HEADER_SIZE + 0x04] ?? 0) ^ 0xff;
    const [e6, e9, e7] = parse(area)?.entries ?? [];
    expect(e6).toMatchObject({
      fileIndex: 6,
      headerCRCValid: false,
      revisionValid: true,
      dataCRCValid: true,
    });
    expect(e9?.headerCRCValid).toBe(true);
    expect(e7?.headerCRCValid).toBe(true);
  });

  it("isolates an invalid entry data CRC", () => {
    const area = makeR1(fill(0x10), fill(0x20), fill(0x30));
    const at = R1_HEADER_SIZE + ENTRY_HEADER_SIZE + 0x10 + 0x10 + 0x03;
    area[at] = (area[at] ?? 0) ^ 0xff;
    const [e6, e9, e7] = parse(area)?.entries ?? [];
    expect(e9).toMatchObject({ fileIndex: 9, dataCRCValid: false, headerCRCValid: true });
    expect(e6?.dataCRCValid).toBe(true);
    expect(e7?.dataCRCValid).toBe(true);
  });

  it("reports an out-of-range entry rather than failing", () => {
    const e6 = makeEntry(fill(0x10));
    const e9 = makeEntry(fill(0x20));
    const header = new Uint8Array(R1_HEADER_SIZE);
    put32(header, 0, SIGNATURE);
    put32(header, 4, 1);
    put32(header, 0x0c, R1_HEADER_SIZE);
    put32(header, 0x10, e6.length);
    put32(header, 0x14, R1_HEADER_SIZE + e6.length);
    put32(header, 0x18, e9.length);
    put32(header, 0x1c, 0xffff_ff00);
    put32(header, 0x20, 0x10);
    put32(
      header,
      8,
      crc32(concat(header.subarray(0, 8), new Uint8Array(4), header.subarray(0x0c)))
    );
    const backup = parse(concat(header, e6, e9));
    expect(backup?.headerCRCValid).toBe(true);
    expect(backup?.entries[0]?.dataCRCValid).toBe(true);
    expect(backup?.entries[1]?.dataCRCValid).toBe(true);
    expect(backup?.entries[2]).toMatchObject({
      fileIndex: 7,
      blobOffset: 0xffff_ff00,
      revisionValid: false,
      headerCRCValid: false,
      dataCRCValid: false,
    });
  });
});

describe("detection", () => {
  it("finds nothing in a normal volume or an erased area", () => {
    expect(
      parse(concat(Uint8Array.of(0x87, 0x78, 0x55, 0xaa), new Uint8Array(0x20).fill(0xff)))
    ).toBeUndefined();
    expect(parse(new Uint8Array(0x40).fill(0xff))).toBeUndefined();
  });

  it("finds nothing too small or out of bounds", () => {
    expect(parseMfsBackup(new Uint8Array(0x10), 0, 0x10, 0)).toBeUndefined();
    expect(parseMfsBackup(new Uint8Array(0x40), 0x20, 0x40, 0)).toBeUndefined();
  });

  it("stays graceful with a header shorter than R1's", () => {
    const area = new Uint8Array(0x20);
    put32(area, 0, SIGNATURE);
    const backup = parse(area);
    expect(backup?.format).toBe("r1");
    expect(backup?.headerRevisionValid).toBe(false);
    expect(backup?.entries.every((one) => one.headerCRCValid)).toBe(false);
  });
});
