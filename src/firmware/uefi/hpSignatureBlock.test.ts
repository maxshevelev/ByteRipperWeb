import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { sha384 } from "@/firmware/me/crypto/digest";
import * as Test from "@/firmware/testing/testImage";
import {
  hpSignatureDate,
  hpSignatureName,
  readHPSignatureBlock,
} from "@/firmware/uefi/hpSignatureBlock";
import { itemType } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * HP's signature block (`HPSignatureBlock`): read out of padding as a row, its two
 * ranges marked, the digest checked only where its span is known.
 */

// 64 KiB mapped flush against the top of the address space: the block in the first
// 4 KiB, then a volume to the end with the Volume Top File.
const TOP = 0x1_0000_0000 - 0x10000;
type Span = readonly [number, number];
const VOLUME: Span = [0x1000, 0x10000];
const SIGNED: Span = [0x1000, 0x5000];

/**
 * A block of `version`, laid out as the dumps lay it out, naming two ranges by file
 * offset; `digest` goes where a version-3 payload keeps it.
 */
function block(options: {
  version?: number;
  first: Span;
  second: Span;
  digest?: Uint8Array;
  biosVersion?: string;
}): Uint8Array {
  const version = options.version ?? 3;
  const s = version === 3 ? 0x180 : 0x100;
  const payload = version === 3 ? 0x336 : 0x140;
  const bytes = new Uint8Array(0x30 + 2 * s + 8 + payload + 3 * s);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, version, true);
  view.setUint32(12, s, true);
  [options.first, options.second].forEach(([start, end], index) => {
    const at = 0x10 + index * 0x10;
    view.setUint32(at, start + TOP, true);
    view.setUint32(at + 4, end - start, true);
    view.setUint32(at + 8, 0xffff_ffff, true);
  });
  for (let index = 0; index < s; index++) bytes[0x30 + index] = (index * 31 + 7) & 0xff;
  bytes.fill(0xff, 0x30 + s, 0x30 + 2 * s);
  const at = 0x30 + 2 * s;
  view.setUint32(at, payload, true);
  view.setUint32(at + 4, payload - 2, true);
  const body = at + 8;
  bytes[body] = version;
  const name = options.biosVersion ?? "V77";
  for (let index = 0; index < name.length; index++)
    bytes[body + 8 + index] = name.charCodeAt(index);
  bytes.set([0xe6, 0x07, 0, 0, 0x0c, 0, 0x1a, 0], body + 0x18); // 2022-12-26
  for (let index = 0; index < 3 * s; index++)
    bytes[body + payload + index] = (index * 13 + 1) & 0xff;
  if (version === 3) {
    const id = "311547e914957b35a0628d1ef261a46c2f686136";
    for (let index = 0; index < id.length; index++) bytes[0x368 + index] = id.charCodeAt(index);
    if (options.digest !== undefined) bytes.set(options.digest, 0x43a);
  }
  return bytes;
}

function image(blockBytes: Uint8Array): Uint8Array {
  const head = new Uint8Array(0x1000).fill(0xff);
  head.set(blockBytes);
  head[0xfff] = 0x5a; // the padding is written, as it is around a real block
  const data = Test.file({
    body: Uint8Array.from({ length: 0x3000 }, (_, index) => (index * 5) & 0xff),
  });
  const volume = Test.volume({
    length: 0xf000,
    files: [data],
    lastFile: Test.volumeTopFile({ size: 0x100 }),
  });
  return Uint8Array.from([...head, ...volume]);
}

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const reader = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));
const hp = (bytes: Uint8Array) =>
  parse(bytes).protectedRanges?.ranges.filter((one) => one.kind === "hp");

describe("an HP signature block", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPSignatureBlockTests.swift#HPSignatureBlockTests.testABlockIsARowAndItsDigestOfTheSecondRangeIsChecked
  it("is a row, and the digest of its second range is checked", () => {
    const bytes = image(block({ first: VOLUME, second: SIGNED, digest: new Uint8Array(48) }));
    bytes.set(sha384(bytes.subarray(SIGNED[0], SIGNED[1])), 0x43a);
    const parsed = parse(bytes);
    const row = parsed.allNodes.find((one) => one.kind === "hpSignatureBlock");

    expect(row?.name).toBe("HP signature block V77");
    // Header, signature, payload and three blocks after it.
    expect(row && [row.header.start, row.body.end]).toEqual([0, 0xaee]);
    expect(row && itemType(row)).toBe(ItemType.padding);
    const read = readHPSignatureBlock(0, 0x1000, reader(bytes));
    expect(read && hpSignatureDate(read)).toBe("2022-12-26");
    expect(read && hpSignatureName(read)).toBe("RSA-3072");
    expect(read?.identifier).toBe("311547e914957b35a0628d1ef261a46c2f686136");

    const ranges = hp(bytes) ?? [];
    expect(ranges.map((one) => one.range)).toEqual([
      { start: VOLUME[0], end: VOLUME[1] },
      { start: SIGNED[0], end: SIGNED[1] },
    ]);
    expect(ranges.map((one) => one.verdict.kind)).toEqual(["unchecked", "matches"]);
    expect(ranges.map((one) => one.source)).toEqual([
      { start: 0, end: 0xaee },
      { start: 0, end: 0xaee },
    ]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPSignatureBlockTests.swift#HPSignatureBlockTests.testADigestThatDoesNotMatchIsReported
  it("reports a digest that does not match", () => {
    const bytes = image(
      block({ first: VOLUME, second: SIGNED, digest: new Uint8Array(48).fill(7) })
    );
    const parsed = parse(bytes);

    expect(hp(bytes)?.map((one) => one.verdict.kind)).toEqual(["unchecked", "mismatch"]);
    expect(
      parsed.diagnostics.some(
        (one) =>
          one.detail.kind === "protectedRangeHashMismatch" && one.detail.name === "HP signed range"
      )
    ).toBe(true);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPSignatureBlockTests.swift#HPSignatureBlockTests.testADigestOfUnknownSpanAndAVersion2BlockAreNotChecked
  it("does not check a digest of unknown span or a version 2 block", () => {
    const other = image(
      block({ first: [0x4000, 0x10000], second: VOLUME, digest: new Uint8Array(48).fill(7) })
    );
    expect(hp(other)?.map((one) => one.verdict.kind)).toEqual(["unchecked", "unchecked"]);

    const older = image(block({ version: 2, first: VOLUME, second: SIGNED, biosVersion: "Q22" }));
    const row = parse(older).allNodes.find((one) => one.kind === "hpSignatureBlock");
    expect(row && [row.header.start, row.body.end]).toEqual([0, 0x678]);
    const read = readHPSignatureBlock(0, 0x1000, reader(older));
    expect(read && hpSignatureName(read)).toBe("RSA-2048");
    expect(hp(older)?.map((one) => one.verdict.kind)).toEqual(["unchecked", "unchecked"]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/HPSignatureBlockTests.swift#HPSignatureBlockTests.testANearMissIsNoBlock
  it("is no block when the header is nearly one", () => {
    const filler = block({ first: VOLUME, second: SIGNED });
    filler[0x200] = 0;
    const unknown = block({ first: VOLUME, second: SIGNED });
    unknown[4] = 7;
    for (const bytes of [filler, unknown]) {
      expect(readHPSignatureBlock(0, 0x1000, reader(bytes))).toBeUndefined();
      expect(parse(image(bytes)).allNodes.some((one) => one.kind === "hpSignatureBlock")).toBe(
        false
      );
    }
  });
});
