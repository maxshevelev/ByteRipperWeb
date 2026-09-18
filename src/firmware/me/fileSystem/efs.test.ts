import { describe, expect, it } from "vitest";
import { crc32 } from "@/firmware/me/crypto/checksum";
import type { EfsTableEntry } from "@/firmware/me/data/fileTable";
import {
  efsDataArea,
  efsFiles,
  fitcConfigPayload,
  parseEfs,
  parseFitc,
} from "@/firmware/me/fileSystem/efs";

/**
 * The EFS volume and the FITC partition. Ported from upstream's `EFSTests`; the
 * fixtures' CRCs come from an independent bitwise implementation, so a shared
 * wrong one cannot fake a "valid".
 */

const PAGE_SIZE = 0x1000;
const PAGE_HEADER_SIZE = 0x10;

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

function crcFromZero(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
  }
  return crc >>> 0;
}

function systemPage(options: {
  dictionary?: number;
  committed?: number;
  reserved?: number;
  order: readonly number[];
}): Uint8Array {
  const page = new Uint8Array(PAGE_SIZE).fill(0xff);
  put16(page, 0, 0x0001);
  put16(page, 2, options.dictionary ?? 0x000a);
  put32(page, 4, 1);
  page[8] = 2;
  page[9] = options.committed ?? 2;
  page[10] = options.reserved ?? 0;
  page[11] = 1;
  put32(page, 12, crcFromZero(page.subarray(0, 12)));
  const index = concat(Uint8Array.from(options.order), new Uint8Array(8), new Uint8Array(4));
  put32(index, options.order.length + 8, crcFromZero(index.subarray(0, options.order.length + 8)));
  page.set(index, PAGE_HEADER_SIZE);
  return page;
}

function dataPage(seed: number, reserved = false): Uint8Array {
  const page = new Uint8Array(PAGE_SIZE).fill(0xff);
  put16(page, 0, 0x0000);
  put16(page, 2, 0x0000);
  put32(page, 4, 1);
  page.fill(0, 8, 12);
  put32(page, 12, crcFromZero(page.subarray(0, 12)));
  if (!reserved) {
    for (let i = 0; i < PAGE_SIZE - PAGE_HEADER_SIZE - 4; i++)
      page[PAGE_HEADER_SIZE + i] = (seed + i) & 0xff;
  }
  put32(page, PAGE_SIZE - 8, 0xffff_ffff);
  const body = page.subarray(PAGE_HEADER_SIZE, PAGE_SIZE - 4);
  put32(page, PAGE_SIZE - 4, reserved ? 0xffff_ffff : crcFromZero(body));
  return page;
}

/** A System page and two Data pages; the order [1, 0] proves the permutation is read. */
const makeVolume = () => concat(systemPage({ order: [1, 0] }), dataPage(0x00), dataPage(0x40));

const parse = (region: Uint8Array, absoluteOffset = 0, mfsDictionary?: number) =>
  parseEfs(region, 0, region.length, absoluteOffset, mfsDictionary);

describe("the EFS volume", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testParsesSystemVolumeFacts
  it("reads the System page's facts", () => {
    expect(parse(makeVolume(), 0x1000, 0x0a)).toEqual({
      offset: 0x1000,
      pageSize: 0x1000,
      systemPageCount: 1,
      dataPageCount: 2,
      scratchPageCount: 0,
      scratchPagesEmpty: true,
      dataPageCountMatchesSystem: true,
      dictionary: 0x000a,
      revision: 1,
      unknown1: 2,
      dictionaryRevision: 1,
      dataPagesCommitted: 2,
      dataPagesReserved: 0,
      systemHeaderCRCValid: true,
      indexesCRCValid: true,
      firstIndexPaddingEmpty: true,
      dataPageOrder: [1, 0],
      dataPageHeaderCRCsValid: true,
      dataPageFooterCRCsValid: true,
      matchesMFSDictionary: true,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testMatchesMFSDictionaryNilWhenNoMFS
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testMatchesMFSDictionaryFalseOnMismatch
  it("compares its dictionary with the MFS volume's only when there is one", () => {
    expect(parse(makeVolume())?.matchesMFSDictionary).toBeUndefined();
    expect(parse(makeVolume(), 0, 0x0b)?.matchesMFSDictionary).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testScratchPagesMustBeAllFF
  it("requires scratch pages to be erased", () => {
    const scratch = new Uint8Array(PAGE_SIZE).fill(0xff);
    scratch[0x123] = 0xab;
    const volume = parse(concat(makeVolume(), scratch));
    expect(volume?.scratchPageCount).toBe(1);
    expect(volume?.scratchPagesEmpty).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testDataPageReservedSkipsFooterCheck
  it("skips a reserved data page's footer", () => {
    const volume = parse(
      concat(systemPage({ order: [0, 1] }), dataPage(0x10), dataPage(0x00, true))
    );
    expect(volume?.dataPageHeaderCRCsValid).toBe(true);
    expect(volume?.dataPageFooterCRCsValid).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testCorruptedHeaderCRCReportedNotThrown
  it("reports a corrupted System header CRC", () => {
    const region = makeVolume();
    region[0x0c] = (region[0x0c] ?? 0) ^ 0xff;
    const volume = parse(region);
    expect(volume?.systemHeaderCRCValid).toBe(false);
    expect(volume?.indexesCRCValid).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testCorruptedDataPageHeaderCRCReported
  it("reports a corrupted data page header CRC", () => {
    const region = makeVolume();
    region[PAGE_SIZE + 0x0c] = (region[PAGE_SIZE + 0x0c] ?? 0) ^ 0xff;
    expect(parse(region)?.dataPageHeaderCRCsValid).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testDirtyFirstIndexPaddingReported
  it("reports dirty first index padding", () => {
    const region = makeVolume();
    region[PAGE_HEADER_SIZE + 2] = 0x01;
    expect(parse(region)?.firstIndexPaddingEmpty).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testNonSystemLeadingPageReturnsNil
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testScratchLeadingPageReturnsNil
  it("is nothing without a leading System page", () => {
    expect(parse(dataPage(0x00))).toBeUndefined();
    expect(parse(new Uint8Array(PAGE_SIZE).fill(0xff))).toBeUndefined();
  });
});

function makeFitc(mangle = false): Uint8Array {
  const payload = Uint8Array.from({ length: 0x80 }, (_, i) => (i * 7 + 3) & 0xff);
  const header = new Uint8Array(0x10);
  put32(header, 0, 1);
  put32(header, 8, payload.length);
  put32(header, 4, crc32(concat(header.subarray(0, 4), new Uint8Array(4), header.subarray(8, 12))));
  put32(header, 12, crc32(payload));
  if (mangle) header[0x04] = (header[0x04] ?? 0) ^ 0x80;
  return concat(header, payload);
}

describe("the FITC partition", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testParsesFITCRevision1
  it("reads a revision 1 header", () => {
    const region = makeFitc();
    expect(parseFitc(region, 0, region.length, 0x1000)).toEqual({
      offset: 0x1000,
      // The header is 0x10 on revision 1, and the payload starts behind it.
      payloadOffset: 0x1010,
      headerRevision: 1,
      dataLength: 0x80,
      headerCRCStored: crc32(Uint8Array.of(0x01, 0, 0, 0, 0, 0, 0, 0, 0x80, 0, 0, 0)),
      headerCRCValid: true,
      dataCRCStored: crc32(region.subarray(0x10)),
      dataCRCValid: true,
      configLength: undefined,
      paddingAllFF: undefined,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testCorruptedFITCHeaderCRCReported
  it("reports a corrupted header CRC and keeps the data facts", () => {
    const region = makeFitc(true);
    expect(parseFitc(region, 0, region.length, 0)).toMatchObject({
      headerRevision: 1,
      headerCRCValid: false,
      dataLength: 0x80,
      dataCRCValid: true,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testNonRevision1FITCAlphaLayout
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testNonRevision1DirtyPaddingReported
  it("reads the alpha layout's length and padding", () => {
    const config = Uint8Array.from({ length: 0x20 }, (_, i) => i);
    const region = new Uint8Array(0x200).fill(0xff);
    put32(region, 0, config.length);
    region.set(config, 4);
    expect(parseFitc(region, 0, region.length, 0)).toMatchObject({
      headerRevision: config.length,
      configLength: config.length,
      paddingAllFF: true,
      dataLength: undefined,
      headerCRCStored: undefined,
    });

    region[0x100] = 0x00;
    expect(parseFitc(region, 0, region.length, 0)?.paddingAllFF).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testRegionTooSmallForFITCReturnsNil
  it("is nothing too small for a header", () => {
    expect(parseFitc(new Uint8Array(0x0f), 0, 0x0f, 0)).toBeUndefined();
  });
});

describe("the FITC payload", () => {
  /**
   * The payload is where the records are read from, and where it starts is the
   * revision's answer: 0x10 past a revision-1 header, 0x04 past the alpha
   * layout's own length word. `payloadOffset` says so absolutely, so a record's
   * own offset becomes a position in the image.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testThePayloadIsHandedOutFromBehindTheHeader
   */
  it("is handed out from behind the header", () => {
    const region = makeFitc();
    const payload = fitcConfigPayload(region, 0, region.length);

    expect(payload?.length).toBe(0x80);
    // The payload's own bytes.
    expect([...(payload?.subarray(0, 2) ?? [])]).toEqual([3, 10]);
    expect(parseFitc(region, 0, region.length, 0x31_5000)?.payloadOffset).toBe(0x31_5010);

    const alpha = new Uint8Array(4 + 0x20 + 0x100).fill(0xff);
    put32(alpha, 0, 0x20);
    alpha.set(
      Uint8Array.from({ length: 0x20 }, (_, index) => index),
      4
    );
    const alphaPayload = fitcConfigPayload(alpha, 0, alpha.length);

    expect(alphaPayload?.length).toBe(0x20);
    expect(alphaPayload?.[0]).toBe(0);
    expect(parseFitc(alpha, 0, alpha.length, 0x1000)?.payloadOffset).toBe(0x1004);
  });

  /**
   * A length running past the partition is no payload: there is no saying how
   * much of it was meant, and cutting records out of the remainder would invent
   * them.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testAPayloadLongerThanThePartitionIsNil
   */
  it("is nothing where the length runs past the partition", () => {
    const region = new Uint8Array(0x40);
    put32(region, 0, 1);
    put32(region, 8, 0x1000);
    expect(fitcConfigPayload(region, 0, region.length)).toBeUndefined();

    // And a header that declares nothing has nothing to hand out.
    const empty = new Uint8Array(0x40);
    put32(empty, 0, 1);
    expect(fitcConfigPayload(empty, 0, empty.length)).toBeUndefined();
  });
});

// MARK: - The file walk (efs_anl 8745–8850)

/**
 * The same `MFS_Integrity_Table` builder the MFS split tests use — the tail an
 * EFS file ends with is that structure, not one of its own.
 *
 * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.integrityTable
 */
function integrityTableBytes(options: {
  readonly size: number;
  readonly flags: number;
  readonly hmac: Uint8Array;
  readonly nonce: Uint8Array;
  readonly arRandom?: number;
  readonly arCounter?: number;
}): Uint8Array {
  const out = new Uint8Array(options.size);
  out.set(options.hmac.subarray(0, options.size), 0);
  const random = options.arRandom ?? 0;
  const counter = options.arCounter ?? 0;
  if (options.size === 0x28) {
    put32(out, 0x10, options.flags);
    out.set(options.nonce, 0x1c);
    put32(out, 0x14, random);
    put32(out, 0x18, counter);
  } else {
    put32(out, 0x20, options.flags);
    out.set(options.nonce, 0x24);
    put32(out, 0x24, random);
    put32(out, 0x28, counter);
  }
  return out;
}

const entryAt = (dataOffset: number, size: number, fileId: number): EfsTableEntry => ({
  dataOffset,
  page: 0,
  pageOffset: dataOffset,
  size,
  fileId,
  reserved: 0,
  name: `FILE_${fileId}`,
});

const walk = (dataArea: Uint8Array, entries: readonly EfsTableEntry[], flagged: number[] = []) =>
  efsFiles({
    dataArea,
    entries,
    integrityFileIds: new Set(flagged),
    variant: "CSME",
    major: 15,
    minor: 0,
    platform: 4,
  });

describe("the EFS data area", () => {
  /**
   * The data area is the Data pages in *index* order — not physical order —
   * each stripped of its 0x10 header and 0x8 footer, which is the buffer the
   * table's offsets are offsets into.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testTheDataAreaIsTheDataPagesInIndexOrder
   */
  it("is the Data pages in index order", () => {
    const region = makeVolume();
    const area = efsDataArea(region, 0, region.length, [1, 0]);
    const pageData = PAGE_SIZE - PAGE_HEADER_SIZE - 0x08;

    expect(area.length).toBe(2 * pageData);
    // Index [1, 0]: the second physical Data page comes first, and its body
    // starts at its own seed.
    expect(area[0]).toBe(0x40);
    expect(area[pageData]).toBe(0x00);
  });

  /**
   * An index area that is not a permutation of the volume's Data pages leaves
   * no data area: without it there is no saying which page is first, and a
   * wrong order would name every file's bytes wrong.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testTheDataAreaIsEmptyWhenTheIndexOrderIsNotAPermutation
   */
  it("is empty when the index order is not a permutation", () => {
    const region = makeVolume();

    expect(efsDataArea(region, 0, region.length, [0, 0]).length).toBe(0);
    expect(efsDataArea(region, 0, region.length, [1]).length).toBe(0);
    expect(efsDataArea(region, 0, region.length, [0, 5]).length).toBe(0);
  });
});

describe("the EFS file walk", () => {
  /**
   * A file is its metadata header plus what that header says follows. The
   * table's own length is not it — upstream prefers the metadata, and the CSME
   * 15 dump's `ICC_MPHYTBL` is allotted 0x3000 and stores 0x15FC.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testAFileIsAsLongAsItsOwnMetadataSays
   */
  it("reads a file as long as its own metadata says", () => {
    const area = new Uint8Array(0x200).fill(0xff);
    put16(area, 0x10, 0x20);
    put16(area, 0x12, 0xab12);

    const file = walk(area, [entryAt(0x10, 0x100, 7)])[0];

    expect(file).toEqual({
      fileId: 7,
      dataOffset: 0x10,
      storedSize: 0x20,
      metadataUnknown: 0xab12,
      // Nothing flagged, nothing split off.
      contentSize: 0x20,
    });
  });

  /**
   * The Integrity flag comes from the FTBL row, and nothing in the EFS bytes
   * says so — a file that is flagged ends with the table, one that is not keeps
   * every byte.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testAFlaggedFileIsSplitFromTheTableItEndsWith
   */
  it("splits a flagged file from the table it ends with", () => {
    const table = integrityTableBytes({
      size: 0x28,
      flags: 0x2,
      hmac: new Uint8Array(16).fill(0xa1),
      nonce: new Uint8Array(12).fill(0xb2),
      arRandom: 0x55,
      arCounter: 9,
    });
    const first = new Uint8Array(4 + 0x40);
    put16(first, 0, 0x40 + 0x28);
    put16(first, 2, 0x1111);
    first.fill(0x33, 4);
    const second = new Uint8Array(4 + 0x10);
    put16(second, 0, 0x10);
    put16(second, 2, 0x2222);
    second.fill(0x44, 4);
    const area = concat(first, table, second);
    const flaggedEnd = first.length + table.length;

    const files = walk(area, [entryAt(0, 0x100, 5), entryAt(flaggedEnd, 0x100, 6)], [5]);

    // In data-area order.
    expect(files.map((one) => one.fileId)).toEqual([5, 6]);
    expect(files[0]?.storedSize).toBe(0x40 + 0x28);
    // The content, without the table.
    expect(files[0]?.contentSize).toBe(0x40);
    expect(files[0]?.integrity?.size).toBe(0x28);
    expect(files[0]?.integrity?.arCounter).toBe(9);
    expect(files[0]?.integrity?.hmacHex.slice(0, 4).toUpperCase()).toBe("A1A1");
    // Unflagged: whole.
    expect(files[1]?.contentSize).toBe(0x10);
    expect(files[1]?.integrity).toBeUndefined();
  });

  /**
   * Upstream's 0x28 workaround applies to an EFS file exactly as it does to an
   * MFS one: a counter no Anti-Replay index would hold means the table sits
   * 0x10 further back, and the file ends 0x38 from its content.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testAnAbsurdCounterMeansTheEFSTableSitsTenBytesEarlier
   */
  it("re-reads an EFS table that sits 0x10 earlier", () => {
    const table = integrityTableBytes({
      size: 0x28,
      flags: 0x2,
      hmac: new Uint8Array(16).fill(0xc3),
      nonce: new Uint8Array(12).fill(0xd4),
      arRandom: 0x7,
      arCounter: 4,
    });
    const head = new Uint8Array(4 + 0x20);
    put16(head, 0, 0x20 + 0x38);
    head.fill(0x66, 4);
    const area = concat(head, table, new Uint8Array(0x10).fill(0xee));

    const file = walk(area, [entryAt(0, 0x100, 4)], [4])[0];

    // 0x28 of table plus the 0x10 behind it, and the content is whole.
    expect((file?.storedSize ?? 0) - (file?.contentSize ?? 0)).toBe(0x38);
    expect(file?.contentSize).toBe(0x20);
    // Read where the table really is.
    expect(file?.integrity?.arCounter).toBe(4);
  });

  /**
   * A metadata size of 0xFFFF is a slot the volume never wrote. Upstream skips
   * it, and so does the inventory — listing it would be a file that does not
   * exist.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testAnUnwrittenFileIsNotListed
   */
  it("does not list an unwritten file", () => {
    const area = new Uint8Array(0x100).fill(0xff);
    put16(area, 0, 0xffff);

    expect(walk(area, [entryAt(0, 0x80, 3)])).toEqual([]);
  });

  /**
   * A file whose metadata claims more than the table allotted it means the
   * table is the wrong one for this volume (upstream warns and skips). The
   * bytes past the allotment belong to whatever the table put next — naming
   * them would be a guess.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testAFileLongerThanTheTableAllowsIsSkipped
   */
  it("skips a file longer than the table allows", () => {
    const area = new Uint8Array(0x200);
    put16(area, 0, 0x81);

    expect(walk(area, [entryAt(0, 0x80, 2)])).toEqual([]);
  });

  /**
   * An entry the data area does not reach — a table written for a volume with
   * more pages than this one has — is skipped rather than read off the end.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testAnEntryPastTheDataAreaIsSkipped
   */
  it("skips an entry past the data area", () => {
    const area = new Uint8Array(0x40);
    // Runs off the end.
    put16(area, 0x30, 0x20);

    expect(walk(area, [entryAt(0x100, 0x80, 1), entryAt(0x30, 0x80, 2)])).toEqual([]);
  });

  /**
   * A flagged file too short to hold the table it is flagged for still ends
   * where the flag says — upstream's slice of a too-short buffer is empty, not
   * negative, and no table is reported for it.
   *
   * @upstream Packages/MEFirmware/Tests/MEFirmwareTests/EFSTests.swift#EFSTests.testAFlaggedFileTooShortForItsTableHasNoContent
   */
  it("gives a flagged file too short for its table no content", () => {
    const area = new Uint8Array(0x40);
    put16(area, 0, 0x10);

    const file = walk(area, [entryAt(0, 0x80, 8)], [8])[0];

    expect(file?.storedSize).toBe(0x10);
    expect(file?.contentSize).toBe(0);
    expect(file?.integrity).toBeUndefined();
  });
});
