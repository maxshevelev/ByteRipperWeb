import { describe, expect, it } from "vitest";
import { encodeUtf8 } from "@/core/text/utf";
import { sourceOver } from "@/firmware/byteSource";
import { file, volume } from "@/firmware/testing/testImage";
import { GUID_ZERO } from "@/firmware/uefi/efiGuid";
import { FFS } from "@/firmware/uefi/fileParser";
import { itemSubtype } from "@/firmware/uefi/itemClassification";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `PadFileBodyTests.swift`: a pad file's body, read the way
 * UEFITool's `parsePadFileBody` reads it — nothing when it is erased; otherwise
 * the leading erased bytes, rounded down to eight, as free space, and the rest
 * as the Startup AP data or as data that has no business there.
 */

const erased = (count: number) => new Uint8Array(count).fill(0xff);
const join = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));

function padFile(body: Uint8Array) {
  const parsed = parseUefiImage(
    sourceOver(
      volume({ length: 0x400, files: [file({ guid: GUID_ZERO, type: FFS.padType, body })] })
    )
  );
  return { file: (parsed.roots[0] as UEFINode).children[0] as UEFINode, parsed };
}

describe("a pad file's body", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PadFileBodyTests.swift#PadFileBodyTests.testAnErasedPadFileHoldsNothing
  it("holds nothing when erased", () => {
    const { file: pad, parsed } = padFile(erased(0x40));
    expect(pad.children).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PadFileBodyTests.swift#PadFileBodyTests.testTheStartupApDataIsRecognisedAfterTheFreeSpace
  it("recognises the Startup AP data after the free space", () => {
    const { file: pad, parsed } = padFile(
      join(erased(0x30), FFS.startupApDataX86_128K, Uint8Array.of(0x11, 0x22))
    );
    const start = pad.body.start;

    expect(pad.children.map((node) => node.kind)).toEqual(["freeSpace", "startupApData"]);
    expect(nodeRange(pad.children[0] as UEFINode)).toEqual({ start, end: start + 0x30 });
    expect(nodeRange(pad.children[1] as UEFINode)).toEqual({
      start: start + 0x30,
      end: pad.body.end,
    });
    expect((pad.children[1] as UEFINode).isFixed).toBe(true);
    expect(itemSubtype(pad.children[1] as UEFINode)).toBe(Sub.x86128kStartupApDataEntry);
    expect(parsed.diagnostics).toEqual([]);
  });

  // The free space is rounded down to eight, so the data starts on an eight-byte
  // boundary with a few erased bytes in front of it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PadFileBodyTests.swift#PadFileBodyTests.testTheFreeSpaceIsRoundedDownToEight
  it("rounds the free space down to eight", () => {
    const { file: pad } = padFile(join(erased(0x2b), Uint8Array.of(0x12, 0x34)));
    const start = pad.body.start;
    expect(nodeRange(pad.children[0] as UEFINode)).toEqual({ start, end: start + 0x28 });
    expect(nodeRange(pad.children[1] as UEFINode).start).toBe(start + 0x28);
  });

  // Fewer than eight erased bytes are not free space: the data is the whole body.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PadFileBodyTests.swift#PadFileBodyTests.testFewerThanEightErasedBytesAreNotFreeSpace
  it("does not call fewer than eight erased bytes free space", () => {
    const { file: pad } = padFile(join(erased(4), Uint8Array.of(0x12, 0x34)));
    expect(pad.children.map((node) => node.kind)).toEqual(["padding"]);
    expect(nodeRange(pad.children[0] as UEFINode)).toEqual(pad.body);
  });

  // Anything else is data, kept and reported.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/PadFileBodyTests.swift#PadFileBodyTests.testOtherDataIsReported
  it("reports other data", () => {
    const { file: pad, parsed } = padFile(join(erased(0x10), encodeUtf8("__KEYM__")));
    expect(pad.children.map((node) => node.kind)).toEqual(["freeSpace", "padding"]);
    expect((pad.children[1] as UEFINode).isErased).toBe(false);
    expect(parsed.diagnostics.map((one) => one.detail.kind)).toEqual(["nonUEFIDataInPadFile"]);
    expect(parsed.diagnostics[0]?.offset).toBe(nodeRange(pad.children[1] as UEFINode).start);
  });
});
