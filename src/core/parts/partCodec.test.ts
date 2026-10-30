import { describe, expect, it } from "vitest";
import { LocalizedText } from "@/core/localization/localization";
import {
  CopyPartCodec,
  GatherPartCodec,
  overwriting,
  type PartParent,
  type PartReader,
  PartRefusal,
  ReadOnlyPartCodec,
} from "@/core/parts/partCodec";

// @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#Bytes
// @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#Bytes.bytes
// @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#Bytes.size
// @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#Bytes.read
function bytesReader(bytes: Uint8Array): PartReader {
  return {
    size: bytes.length,
    async read(offset, length) {
      if (offset + length > bytes.length) throw new Error("past the end");
      return bytes.slice(offset, offset + length);
    },
  };
}

// @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#PartCodecTests
// @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#PartCodecTests.parent
const parent: PartParent = {
  content: bytesReader(Uint8Array.from({ length: 32 }, (_, index) => index)),
  source: [8, 12],
  name: "dump.bin",
  partName: "",
};

describe("a part's codec", () => {
  // @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#PartCodecTests.testACopyOpensAsTheSourceAndGoesBackOverIt
  it("opens a copy as the source and puts it back over it", async () => {
    const codec = new CopyPartCodec();

    expect(await codec.decode(parent)).toEqual(Uint8Array.from([8, 9, 10, 11]));
    const back = Uint8Array.from([1, 2, 3, 4]);
    expect(await codec.encode(back, parent)).toEqual(overwriting([8, 12], back));
    expect(codec.isImmediate).toBe(true);
    expect(codec.keepsOffsets).toBe(true);
    expect(codec.badge).toBeUndefined();
  });

  // @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#PartCodecTests.testACopyGoesBackOnlyAtItsLength
  it("puts a copy back only at its length", async () => {
    const refused = await new CopyPartCodec()
      .encode(Uint8Array.from([1, 2, 3]), parent)
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(PartRefusal);
    expect((refused as PartRefusal).title.textIn("en")).toBe("The length changed");
  });

  // @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#PartCodecTests.testAReadOnlyPartOpensAsGivenAndIsRefused
  it("opens a read-only part as given and refuses it on the way back", async () => {
    const codec = new ReadOnlyPartCodec(
      Uint8Array.from([7, 7]),
      LocalizedText.verbatim("No"),
      LocalizedText.verbatim("Nothing compresses it again.")
    );

    expect(await codec.decode()).toEqual(Uint8Array.from([7, 7]));
    const refused = await codec.encode().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PartRefusal);
    expect(refused).toEqual(
      new PartRefusal(
        LocalizedText.verbatim("No"),
        LocalizedText.verbatim("Nothing compresses it again.")
      )
    );
    expect(codec.keepsOffsets).toBe(false);
    expect(codec.badge.text).toBe("Read-only");
  });

  // A scattered thing opens as its stretches one after another, in the owner's order, and goes
  // back to the same places: the bytes between them stay what they were.
  // @upstream Packages/PartCodec/Tests/PartCodecTests/PartCodecTests.swift#PartCodecTests.testAGatheredPartOpensInTheOwnersOrderAndGoesBackToTheSamePlaces
  it("opens a gathered part in the owner's order and puts it back in the same places", async () => {
    const scattered: PartParent = { ...parent, source: [4, 16] };
    const codec = new GatherPartCodec([
      [12, 16],
      [4, 6],
    ]);

    expect(await codec.decode(scattered)).toEqual(Uint8Array.from([12, 13, 14, 15, 4, 5]));
    expect(await codec.encode(Uint8Array.from([0xa, 0xb, 0xc, 0xd, 0xe, 0xf]), scattered)).toEqual(
      overwriting([4, 16], Uint8Array.from([0xe, 0xf, 6, 7, 8, 9, 10, 11, 0xa, 0xb, 0xc, 0xd]))
    );
    expect(codec.keepsOffsets).toBe(false);
    const refused = await codec
      .encode(Uint8Array.from([1, 2, 3]), scattered)
      .catch((error: unknown) => error);
    expect((refused as PartRefusal).title.textIn("en")).toBe("The length changed");
  });
});
