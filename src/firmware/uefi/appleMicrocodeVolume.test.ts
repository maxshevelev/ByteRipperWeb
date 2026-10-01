import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { microcode, volume } from "@/firmware/testing/testImage";
import { itemSubtype } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { FV } from "@/firmware/uefi/volumeFormat";

/**
 * Ported from `AppleMicrocodeVolumeTests.swift`: a Mac's microcode volume — no
 * file system inside, a run of microcode images after a `0x100`-byte header, and
 * padding after the last one — read the way UEFITool's
 * `parseMicrocodeVolumeBody` reads it.
 */

/** A volume with the Apple microcode GUID whose body, at `0x100`, is `body`. */
function appleVolume(body: Uint8Array): Uint8Array {
  // The standard header is 0x48 bytes; the reference takes 0x100 for this
  // volume whatever the header says, so the gap is filler.
  const filler = new Uint8Array(FV.appleMicrocodeHeaderSize - 0x48).fill(0xff);
  return volume({
    fileSystem: FV.appleMicrocodeFileSystem,
    length: 0x1000,
    trailing: Uint8Array.from([...filler, ...body]),
  });
}

const parse = (body: Uint8Array) => parseUefiImage(sourceOver(appleVolume(body)));
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

describe("an Apple microcode volume", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleMicrocodeVolumeTests.swift#AppleMicrocodeVolumeTests.testTheBodyReadsAsItsMicrocodeAndTheErasedRest
  it("reads its body as the microcode and the erased rest", () => {
    const first = microcode({ signature: 0x206a7, dataSize: 0x80 });
    const second = microcode({ signature: 0x306a9, dataSize: 0x40 });
    const parsed = parse(join(first, second));
    const root = parsed.roots[0] as UEFINode;

    expect(root.header).toEqual({ start: 0, end: 0x100 });
    expect(root.children.map((node) => node.kind)).toEqual(["microcode", "microcode", "padding"]);
    expect(nodeRange(root.children[0] as UEFINode)).toEqual({
      start: 0x100,
      end: 0x100 + first.length,
    });
    expect(nodeRange(root.children[1] as UEFINode).start).toBe(0x100 + first.length);
    expect((root.children[2] as UEFINode).isErased).toBe(true);
    expect(nodeRange(root.children[2] as UEFINode).end).toBe(0x1000);
    expect(itemSubtype(root)).toBe(Sub.appleMicrocodeVolume);
    expect(parsed.diagnostics).toEqual([]);
  });

  // The walk stops at the first bytes that are not a microcode and keeps the
  // rest whole, as the reference does.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleMicrocodeVolumeTests.swift#AppleMicrocodeVolumeTests.testBytesThatAreNotAMicrocodeEndTheWalkAsPadding
  it("ends the walk as padding at bytes that are not a microcode", () => {
    const first = microcode();
    const parsed = parse(join(first, Uint8Array.of(0x12, 0x34, 0x56, 0x78)));
    const children = (parsed.roots[0] as UEFINode).children;

    expect(children.map((node) => node.kind)).toEqual(["microcode", "padding"]);
    expect((children[1] as UEFINode).isErased).toBe(false);
    expect(nodeRange(children[1] as UEFINode)).toEqual({
      start: 0x100 + first.length,
      end: 0x1000,
    });
  });

  // An erased volume holds nothing but padding.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleMicrocodeVolumeTests.swift#AppleMicrocodeVolumeTests.testAnErasedVolumeIsPadding
  it("is padding when erased", () => {
    const children = (parse(new Uint8Array(0)).roots[0] as UEFINode).children;
    expect(children.map((node) => node.kind)).toEqual(["padding"]);
    expect(nodeRange(children[0] as UEFINode)).toEqual({ start: 0x100, end: 0x1000 });
  });
});
