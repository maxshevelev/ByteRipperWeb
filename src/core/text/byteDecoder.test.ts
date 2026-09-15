import { describe, expect, it } from "vitest";
import { SeededRandom } from "@/core/testing/support";
import {
  BYTE_DECODERS,
  DEFAULT_DECODER_IDENTIFIER,
  makeByteDecoder,
} from "@/core/text/byteDecoderRegistry";

/**
 * Ported from `TextDecoderTests.swift`, less its settings-store cases: those
 * persist through `UserDefaults`, whose counterpart here is IndexedDB and
 * arrives with the rest of Settings in M11.
 */

const decoder = (identifier: string, placeholder?: string) =>
  makeByteDecoder(identifier, placeholder);

const decodeAll = (identifier: string, bytes: number[]) =>
  decoder(identifier).decodeAll(new Uint8Array(bytes));

// @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testCp1252Vectors
describe("the cp1252 vectors", () => {
  // One character per byte, so each expected string states every byte's
  // rendering at its own position.
  const cases: {
    name: string;
    bytes: number[];
    expected: string;
    displayable: number[];
    undisplayable: number[];
  }[] = [
    {
      // 0x9C œ at 3, 0xD6 Ö at 7, 0xFF ÿ in the tail; 0x90 at 4 is one of
      // cp1252's undefined slots.
      name: "vector 1",
      bytes: [
        0x11, 0x00, 0x00, 0x9c, 0x90, 0x02, 0x00, 0xd6, 0x00, 0x00, 0x00, 0x05, 0xff, 0xff, 0xff,
        0xff,
      ],
      expected: "...œ...Ö....ÿÿÿÿ",
      displayable: [3, 7, 15],
      undisplayable: [4],
    },
    {
      // 0xA0 NO-BREAK SPACE at 2 displays as a regular space, 0x40 @ at 6,
      // 0x80 € at 10.
      name: "vector 2",
      bytes: [
        0x00, 0x0f, 0xa0, 0x00, 0x00, 0x0d, 0x40, 0x00, 0x00, 0x09, 0x80, 0x00, 0x00, 0x00, 0x00,
        0x00,
      ],
      expected: ".. ...@...€.....",
      displayable: [2, 6, 10],
      undisplayable: [],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const cp = decoder("cp1252");
      const decoded = decodeAll("cp1252", testCase.bytes);
      expect(Array.from(decoded).length).toBe(testCase.bytes.length); // one per byte
      expect(decoded).toBe(testCase.expected);
      for (const index of testCase.displayable) {
        expect(cp.isDisplayable(testCase.bytes[index] ?? 0)).toBe(true);
      }
      for (const index of testCase.undisplayable) {
        expect(cp.isDisplayable(testCase.bytes[index] ?? 0)).toBe(false);
      }
    });
  }
});

describe("what never draws", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testUndefinedCp1252Slots
  it("leaves cp1252's undefined slots as placeholders", () => {
    const cp = decoder("cp1252");
    for (const byte of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
      expect(cp.decode(byte), `0x${byte.toString(16)}`).toBe(".");
      expect(cp.isDisplayable(byte)).toBe(false);
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testControlsDecodeToPlaceholderInAllPresets
  it("placeholders the controls in every preset", () => {
    for (const identifier of ["cp1252", "isoLatin1", "strictASCII"]) {
      const d = decoder(identifier);
      for (let byte = 0x00; byte <= 0x1f; byte++) {
        expect(d.decode(byte), `${identifier} 0x${byte.toString(16)}`).toBe(".");
        expect(d.isDisplayable(byte)).toBe(false);
      }
      expect(d.decode(0x7f), identifier).toBe(".");
      expect(d.isDisplayable(0x7f)).toBe(false);
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testSoftHyphenIsFilteredInBothLatinTables
  it("filters the soft hyphen out of both Latin tables", () => {
    // 0xAD is SOFT HYPHEN — an invisible format character, so it is a
    // placeholder rather than being drawn as nothing at all.
    for (const identifier of ["cp1252", "isoLatin1"]) {
      const d = decoder(identifier);
      expect(d.decode(0xad), identifier).toBe(".");
      expect(d.isDisplayable(0xad), identifier).toBe(false);
    }
  });
});

describe("strict ASCII", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testStrictASCIIPrintable
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testStrictASCIIHighBytesPlaceholder
  it("draws the printable range and nothing else", () => {
    const d = decoder("strictASCII");
    for (let byte = 0x20; byte <= 0x7e; byte++) {
      expect(d.decode(byte)).toBe(String.fromCodePoint(byte));
      expect(d.isDisplayable(byte)).toBe(true);
    }
    for (let byte = 0x80; byte <= 0xff; byte++) {
      expect(d.decode(byte)).toBe(".");
      expect(d.isDisplayable(byte)).toBe(false);
    }
  });
});

describe("ISO-8859-1 against cp1252", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testISOLatin1LeavesTheC1RangeAsPlaceholdersWhereCp1252HasCharacters
  it("is the difference that makes the menu item worth having", () => {
    // 0x80–0x9F is the C1 control block there, so every byte in it is a
    // placeholder — where cp1252 spends the same range on €, œ, ™ and the rest.
    // The Latin-1 accents above it must still decode, or a decoder that
    // placeholdered everything would pass this.
    const iso = decoder("isoLatin1");
    const cp = decoder("cp1252");

    for (let byte = 0x80; byte <= 0x9f; byte++) {
      expect(iso.decode(byte), `isoLatin1 0x${byte.toString(16)}`).toBe(".");
      expect(iso.isDisplayable(byte)).toBe(false);
    }
    expect(cp.decode(0x80)).toBe("€");
    expect(cp.decode(0x9c)).toBe("œ");
    expect(cp.decode(0x99)).toBe("™");
    expect(iso.encode("€")).toBeUndefined();

    // The high half above C1 is plain Latin-1 in both tables.
    expect(iso.decode(0xe9)).toBe("é");
    expect(iso.decode(0xff)).toBe("ÿ");
    expect(iso.decode(0xa0)).toBe(" "); // NO-BREAK SPACE shows as a space
    expect(iso.isDisplayable(0xe9)).toBe(true);
    expect(iso.encode("é")).toBe(0xe9);
  });
});

describe("encoding, for typing in the text column", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testRoundTrip
  it("round-trips every displayable byte", () => {
    const d = decoder("cp1252");
    for (let byte = 0x00; byte <= 0xff; byte++) {
      if (!d.isDisplayable(byte)) continue;
      const character = d.decode(byte);
      if (byte === 0xa0) {
        // ASCII space is the canonical encoding of the NBSP byte's display
        // character, so 0xA0 round-trips to 0x20.
        expect(character).toBe(" ");
        expect(d.encode(character)).toBe(0x20);
      } else {
        expect(d.encode(character), `byte 0x${byte.toString(16)}`).toBe(byte);
      }
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testExplicitEncodeVectors
  it("encodes the vectors", () => {
    const d = decoder("cp1252");
    expect(d.encode("ÿ")).toBe(0xff);
    expect(d.encode("œ")).toBe(0x9c);
    expect(d.encode("€")).toBe(0x80);
    expect(d.encode(" ")).toBe(0x20);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testNonRepresentableEncodeReturnsNil
  it("refuses what the table cannot hold", () => {
    const d = decoder("cp1252");
    expect(d.encode("汉")).toBeUndefined(); // CJK
    expect(d.encode("😀")).toBeUndefined(); // emoji
    expect(d.encode("🖖")).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testEncodePlaceholderDoesNotAffectInverse
  it("is unaffected by the placeholder setting", () => {
    const plain = decoder("cp1252", ".");
    const custom = decoder("cp1252", "·");
    for (let byte = 0x00; byte <= 0xff; byte++) {
      if (!plain.isDisplayable(byte)) continue;
      const character = plain.decode(byte);
      expect(custom.encode(character)).toBe(plain.encode(character));
    }
  });
});

describe("alignment", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testAlignmentDecodedLengthEqualsByteCount
  it("decodes exactly one character per byte, whatever the bytes", () => {
    // The property the hex grid depends on: the text column and the hex column
    // line up because they have to have the same number of cells.
    const random = new SeededRandom(0x01234567);
    const d = decoder("cp1252");
    for (let length = 0; length < 64; length++) {
      const bytes = random.bytes(length);
      expect(Array.from(d.decodeAll(bytes)).length, `length ${length}`).toBe(length);
    }
  });
});

describe("the custom placeholder", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testCustomPlaceholder
  it("replaces every undrawable byte and no drawable one", () => {
    const d = decoder("cp1252", "·");
    expect(d.decode(0x00)).toBe("·");
    expect(d.decode(0x81)).toBe("·");
    expect(d.decode(0x7f)).toBe("·");
    expect(d.isDisplayable(0x00)).toBe(false);
    expect(d.isDisplayable(0x81)).toBe(false);

    expect(d.decode(0x41)).toBe("A");
    expect(d.decode(0x9c)).toBe("œ");
    expect(d.isDisplayable(0x41)).toBe(true);
  });
});

describe("the registry", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testRegistryListsBuiltins
  it("lists the built-ins in menu order", () => {
    expect(BYTE_DECODERS.map((d) => d.identifier)).toEqual(["cp1252", "isoLatin1", "strictASCII"]);
    expect(BYTE_DECODERS.map((d) => d.displayName)).toEqual([
      "Windows-1252",
      "ISO-8859-1",
      "Strict ASCII",
    ]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/TextDecoderTests.swift#TextDecoderTests.testRegistryFallbackToCp1252
  it("falls back to cp1252 for an identifier it does not know", () => {
    // A persisted setting from a newer version should leave the column
    // readable rather than empty.
    const d = decoder("no-such-table");
    expect(d.identifier).toBe(DEFAULT_DECODER_IDENTIFIER);
    expect(d.displayName).toBe("Windows-1252");
    expect(d.decode(0x9c)).toBe("œ");
  });
});
