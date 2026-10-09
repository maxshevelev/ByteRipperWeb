import { describe, expect, it } from "vitest";
import type { PartParent } from "@/core/parts/partCodec";
import { overwriting } from "@/core/parts/partCodec";
import { LDBGLog } from "@/firmware/lenovoDmi/ldbgLog";
import {
  findingIsProblem,
  type LenovoDMIArea,
  locateLenovoDMI,
  readLenovoDMI,
} from "@/firmware/lenovoDmi/lenovoDmiArea";
import { LenovoDMIFormat, smbiosKey } from "@/firmware/lenovoDmi/lenovoDmiFormat";
import { keyReferences } from "@/firmware/lenovoDmi/lenovoDmiKeyReferences";
import {
  entryName,
  LenovoDMIBlockCodec,
  LenovoDMIDecodedBlock,
  type LenovoDMIWrite,
  setEntry,
  valueHex,
  valueText,
  WindowsKey,
} from "@/firmware/lenovoDmi/lenovoDmiValue";
import { entryDataRange, LENVBlock, type LENVEntry } from "@/firmware/lenovoDmi/lenvBlock";
import {
  SERIAL,
  STANDARD_ENTRIES,
  STANDARD_LOG,
  standardStoreImage,
  type TestEntry,
  testBlock,
  testLog,
  testStoreImage,
  UNKNOWN,
  UUID,
  wipedStoreImage,
} from "@/firmware/testing/testLenovoDMI";

const text = (value: string): Uint8Array => Uint8Array.from(value, (c) => c.charCodeAt(0));

function firstArea(image: Uint8Array): LenovoDMIArea {
  const area = locateLenovoDMI(image)[0];
  if (area === undefined) throw new Error("no store in the image");
  return area;
}

function entryOf(block: LENVBlock | undefined, type: number): LENVEntry {
  const entry = block?.entry(smbiosKey(type));
  if (entry === undefined) throw new Error(`no entry ${type}`);
  return entry;
}

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LocateTests
describe("finding the store", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LocateTests.testFindsTheAreaWhereverItIs
  it("finds the area wherever it is", () => {
    const areas = locateLenovoDMI(standardStoreImage());
    expect(areas.map((area) => area.offset)).toEqual([0x3000]);
    expect(areas[0]?.blocks.map((block) => block.offset)).toEqual([0x5000, 0x6000]);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LocateTests.testAStrayLDBGIsNotTheStore
  it("does not take a stray LDBG for the store", () => {
    // In a driver's code, say — with zeros after it but no blocks behind it.
    // Upstream takes the first match.
    const stray = new Uint8Array(0x1000 + 4 + 0x5000).fill(0xff);
    stray.set(text("LDBG"), 0x1000);
    stray.fill(0, 0x1004);
    const image = new Uint8Array(stray.length + standardStoreImage().length);
    image.set(stray);
    image.set(standardStoreImage(), stray.length);
    const areas = locateLenovoDMI(image);
    expect(areas).toHaveLength(1);
    expect(areas[0]?.offset).toBe(0x1000 + 0x5004 + 0x3000);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LocateTests.testAnImageTooShortForTheAreaHasNone
  it("finds nothing in an image too short for the area", () => {
    expect(locateLenovoDMI(standardStoreImage().slice(0, 0x3000 + 0x3800))).toEqual([]);
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LENVBlockTests
describe("a LENV block", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LENVBlockTests.testReadsAnEncodedBlock
  it("reads an encoded block", () => {
    const block = firstArea(standardStoreImage()).blocks[0];
    expect(block?.hasSignature).toBe(true);
    expect(block?.generation).toBe(127);
    expect(block?.xorKey).toBe(0x7f);
    expect(block?.encoding).toBe("encoded");
    expect(block?.entriesFit).toBe(true);
    expect(block?.checksumIsValid).toBe(true);
    expect(block?.entries.map((entry) => entry.key)).toEqual(STANDARD_ENTRIES.map((e) => e.key));
    expect(entryOf(block, 0x0400).data).toEqual(text("PF0TEST1"));
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LENVBlockTests.testPlacesEachEntryInTheFile
  it("places each entry in the file", () => {
    const block = firstArea(standardStoreImage()).blocks[0];
    const first = block?.entries[0];
    expect(first?.offset).toBe(0x5010);
    expect(first === undefined ? undefined : entryDataRange(first)).toEqual([0x5028, 0x5030]);
    expect(block?.entries[1]?.offset).toBe(0x5030);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LENVBlockTests.testReadsABlockStoredInTheClear
  it("reads a block stored in the clear", () => {
    // What upstream's "decode" toggle leaves: the body in the clear under a
    // non-zero key. Told apart by which reading parses, not by the last byte.
    const stored = testBlock({
      generation: 5,
      key: 0x77,
      entries: STANDARD_ENTRIES,
      encode: false,
    });
    const block = new LENVBlock(0, stored);
    expect(block.encoding).toBe("plain");
    expect(block.effectiveKey).toBe(0);
    expect(entryOf(block, 0x0200).data).toEqual(text("82XX0000GE"));
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LENVBlockTests.testAKeyOfZeroIsNeitherReading
  it("calls a key of zero neither reading", () => {
    const stored = testBlock({ generation: 5, key: 0, entries: STANDARD_ENTRIES });
    expect(new LENVBlock(0, stored).encoding).toBe("keyIsZero");
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LENVBlockTests.testACountThatRunsPastTheBlockIsUndetermined
  it("leaves a count that runs past the block undetermined", () => {
    const stored = testBlock({
      generation: 5,
      key: 0x7f,
      entries: STANDARD_ENTRIES,
      declared: 400,
    });
    const block = new LENVBlock(0, stored);
    expect(block.encoding).toBe("undetermined");
    expect(block.entriesFit).toBe(false);
    // What the encoded reading got through before it ran out is kept.
    expect(block.entries).toHaveLength(STANDARD_ENTRIES.length);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LENVBlockTests.testTheChecksumIsOverTheStoredBody
  it("sums the body as stored", () => {
    // Encoded — which is what makes it line up on every real block examined.
    const good = new LENVBlock(
      0,
      testBlock({ generation: 1, key: 0x7f, entries: STANDARD_ENTRIES })
    );
    const bad = new LENVBlock(
      0,
      testBlock({ generation: 1, key: 0x7f, entries: STANDARD_ENTRIES, checksum: 0x1234 })
    );
    expect(good.checksumIsValid).toBe(true);
    expect(bad.checksumIsValid).toBe(false);
    expect(bad.computedChecksum).toBe(good.checksum);
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LiveBlockTests
describe("the block in use", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LiveBlockTests.area
  const area = (generation1: number, generation2: number): LenovoDMIArea =>
    firstArea(
      testStoreImage({
        log: testLog([], 0x7f),
        blocks: [
          testBlock({ generation: generation1, key: 0x7f, entries: STANDARD_ENTRIES }),
          testBlock({ generation: generation2, key: 0x7f, entries: STANDARD_ENTRIES }),
        ],
      })
    );

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LiveBlockTests.testTheHigherGenerationIsLive
  it("is the higher generation", () => {
    expect(area(127, 126).liveIndex).toBe(0);
    expect(area(83, 84).liveIndex).toBe(1);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LiveBlockTests.testATieGoesToBlockOne
  it("is block 1 on a tie", () => {
    expect(area(9, 9).liveIndex).toBe(0);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LiveBlockTests.testGenerationZeroIsNeverLive
  it("is never generation zero", () => {
    expect(area(0, 3).liveIndex).toBe(1);
    expect(area(0, 0).liveIndex).toBeUndefined();
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LiveBlockTests.testAWipedStoreSaysSo
  it("says so when the store is wiped", () => {
    const wiped = firstArea(wipedStoreImage());
    expect(wiped.blocks.every((block) => block.isBlank)).toBe(true);
    expect(wiped.liveIndex).toBeUndefined();
    expect(wiped.findings).toEqual([{ kind: "wiped" }]);
    expect(wiped.log.writeOffsetProblem).toBe("erased");
    expect(wiped.log.entries).toEqual([]);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LiveBlockTests.testBlocksThatDifferAreNamedByKey
  it("names the keys two blocks differ by", () => {
    // Block 2 lacks the last entry, which is what a newer write leaves.
    const findings = firstArea(standardStoreImage()).findings;
    expect(findings).toEqual([{ kind: "blocksDiffer", keys: [smbiosKey(0x0200)] }]);
    expect(findings[0] === undefined ? true : findingIsProblem(findings[0])).toBe(false);
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LDBGLogTests
describe("the change log", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LDBGLogTests.testReadsThirtyTwoByteEntriesUnderTheBlocksKey
  it("reads 32-byte entries under the blocks' key", () => {
    const log = firstArea(standardStoreImage()).log;
    expect(log.writeOffset).toBe(0x20 + 3 * 0x20);
    expect(log.writeOffsetProblem).toBeUndefined();
    expect(log.key).toBe(0x7f);
    expect(log.entries).toHaveLength(3);
    expect(log.entries.map((entry) => entry.key)).toEqual(STANDARD_LOG.map((entry) => entry.key));
    expect(log.entries.map((entry) => entry.size)).toEqual([1, 16, 8]);
    expect(log.entries[2]?.knownOperation).toBe("setData");
    expect(log.entries[2]?.offset).toBe(0x3000 + 0x20 + 2 * 0x20);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LDBGLogTests.testTheYearIsACenturyAndAYear
  it("reads the year as a century and a year", () => {
    // `22 20` is 2022: a BCD year and a BCD century, not "2000 + a byte".
    const log = firstArea(standardStoreImage()).log;
    expect(log.entries[2]?.timestampText).toBe("2022-06-29 20:30:25");
    expect(log.entries[1]?.timestampText).toBe("2015-11-15 00:01:08");
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LDBGLogTests.testATimestampWrittenBeforeTheClockWasSetIsNoDate
  it("reads a timestamp written before the clock was set as no date", () => {
    expect(firstArea(standardStoreImage()).log.entries[0]?.timestamp).toBeUndefined();
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LDBGLogTests.testAMisalignedWriteOffsetIsReported
  it("reports a misaligned write offset", () => {
    const log = new LDBGLog(0, testLog(STANDARD_LOG, 0x7f, 0x30), [0x7f]);
    expect(log.writeOffsetProblem).toBe("misaligned");
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LDBGLogTests.testAWriteOffsetPastTheEndReadsNothing
  it("reads nothing past a write offset beyond the end", () => {
    const log = new LDBGLog(0, testLog(STANDARD_LOG, 0x7f, 0x9000), [0x7f]);
    expect(log.writeOffsetProblem).toBe("outOfRange");
    expect(log.entries).toEqual([]);
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#ValueTests
describe("an entry's value", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#ValueTests.entry
  const entry = (fixture: TestEntry): LENVEntry => ({
    index: 0,
    offset: 0,
    key: fixture.key,
    flags: 0,
    unknown1: 0,
    unknown2: 0,
    data: fixture.data,
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#ValueTests.testTextReadsAsText
  it("reads text as text", () => {
    expect(valueText(entry(SERIAL))).toBe("PF0TEST1");
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#ValueTests.testPaddingIsNotPartOfTheText
  it("leaves the padding out of the text", () => {
    const padded: TestEntry = {
      key: smbiosKey(0x0200),
      data: Uint8Array.from([...text("82XX"), 0, 0, 0x20]),
    };
    expect(valueText(entry(padded))).toBe("82XX");
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#ValueTests.testTheUUIDReadsInSMBIOSOrder
  it("reads a UUID in SMBIOS order", () => {
    // The first three fields little-endian: that is what gives a version-1 UUID
    // on the dumps examined.
    expect(valueText(entry(UUID))).toBe("2B678236-3B1B-11ED-80F2-010203040506");
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#ValueTests.testAnUnknownEntryThatIsNotTextReadsAsHex
  it("reads an unknown entry that is not text as hex", () => {
    expect(valueText(entry(UNKNOWN))).toBe("19");
    expect(entryName(UNKNOWN.key)).toBe("Unknown SMBIOS entry 0x0700");
    expect(entryName(SERIAL.key)).toBe("Baseboard serial number");
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#EditTests
describe("an edit of the store", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#EditTests.apply
  const apply = (writes: readonly LenovoDMIWrite[], image: Uint8Array): Uint8Array => {
    const edited = image.slice();
    for (const write of writes) edited.set(write.bytes, write.offset);
    return edited;
  };

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#EditTests.testSetsBothCopies
  it("sets both copies", () => {
    // The new value lands in both copies, encoded, with both checksums right —
    // and reads back as what was written.
    const image = standardStoreImage();
    const area = firstArea(image);
    const result = setEntry(smbiosKey(0x0400), text("PF9NEW99"), area);
    if (!result.ok) throw new Error(result.refusal.kind);
    expect(result.blocks).toEqual([0, 1]);

    const after = firstArea(apply(result.writes, image));
    for (const [index, block] of after.blocks.entries()) {
      expect(block.checksumIsValid).toBe(true);
      expect(block.encoding).toBe("encoded");
      expect(entryOf(block, 0x0400).data).toEqual(text("PF9NEW99"));
      expect(block.generation).toBe(area.blocks[index]?.generation);
    }
    // The log is the firmware's record, and nothing was added to it.
    expect(after.log).toEqual(area.log);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#EditTests.testAnEntryOnlyOneBlockHoldsIsWrittenThereAlone
  it("writes an entry only one block holds there alone", () => {
    const result = setEntry(smbiosKey(0x0200), text("82YY1111GE"), firstArea(standardStoreImage()));
    expect(result.ok && result.blocks).toEqual([0]);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#EditTests.testTheLengthNeverChanges
  it("never changes the length", () => {
    const result = setEntry(smbiosKey(0x0400), text("SHORT"), firstArea(standardStoreImage()));
    expect(!result.ok && result.refusal).toEqual({ kind: "lengthChanges", expected: 8, got: 5 });
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#EditTests.testAProtectedEntryIsRefused
  it("refuses a protected entry", () => {
    const serial: TestEntry = { ...SERIAL, flags: 1 };
    const image = testStoreImage({
      log: testLog([], 0x7f),
      blocks: [
        testBlock({ generation: 2, key: 0x7f, entries: [serial] }),
        testBlock({ generation: 1, key: 0x7f, entries: [serial] }),
      ],
    });
    const result = setEntry(smbiosKey(0x0400), text("PF9NEW99"), firstArea(image));
    expect(!result.ok && result.refusal).toEqual({ kind: "writeProtected", block: 0 });
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#EditTests.testAKeyNoBlockHoldsIsRefused
  it("refuses a key no block holds", () => {
    const result = setEntry(
      smbiosKey(0x1000),
      Uint8Array.of(1, 2, 3),
      firstArea(standardStoreImage())
    );
    expect(!result.ok && result.refusal).toEqual({ kind: "noSuchEntry" });
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#EditTests.testABlockInTheClearStaysInTheClear
  it("keeps a block in the clear in the clear", () => {
    // The edit does not quietly change how the block is stored.
    const image = testStoreImage({
      log: testLog([], 0x7f),
      blocks: [
        testBlock({ generation: 2, key: 0x7f, entries: STANDARD_ENTRIES, encode: false }),
        testBlock({ generation: 1, key: 0x7f, entries: STANDARD_ENTRIES }),
      ],
    });
    const result = setEntry(smbiosKey(0x0400), text("PF9NEW99"), firstArea(image));
    if (!result.ok) throw new Error(result.refusal.kind);
    const after = firstArea(apply(result.writes, image));
    expect(after.blocks.map((block) => block.encoding)).toEqual(["plain", "encoded"]);
    expect(after.blocks.every((block) => block.checksumIsValid)).toBe(true);
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#DecodedBlockTests
describe("a block decoded", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#DecodedBlockTests.testTheBodyReadsInTheClearAndTheHeaderAsStored
  it("reads the body in the clear and the header as stored", () => {
    const block = firstArea(standardStoreImage()).blocks[0] as LENVBlock;
    const clear = LenovoDMIDecodedBlock.decode(block);
    expect(clear.slice(0, 16)).toEqual(block.stored.slice(0, 16));
    const start = entryDataRange(entryOf(block, 0x0400))[0] - block.offset;
    expect(clear.slice(start, start + 8)).toEqual(text("PF0TEST1"));
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#DecodedBlockTests.testAnUntouchedBlockGoesBackAsItWas
  it("puts an untouched block back as it was", () => {
    const block = firstArea(standardStoreImage()).blocks[0] as LENVBlock;
    expect(LenovoDMIDecodedBlock.encode(LenovoDMIDecodedBlock.decode(block), true)).toEqual(
      block.stored
    );
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#DecodedBlockTests.testAnEditGoesBackEncodedWithItsChecksum
  it("puts an edit back encoded, with its checksum", () => {
    const block = firstArea(standardStoreImage()).blocks[0] as LENVBlock;
    const clear = LenovoDMIDecodedBlock.decode(block);
    const start = entryDataRange(entryOf(block, 0x0400))[0] - block.offset;
    clear.set(text("PF9NEW99"), start);

    const encoded = LenovoDMIDecodedBlock.encode(clear, true);
    if (encoded === undefined) throw new Error("not a block");
    const back = new LENVBlock(block.offset, encoded);
    expect(back.encoding).toBe("encoded");
    expect(back.checksumIsValid).toBe(true);
    expect(entryOf(back, 0x0400).data).toEqual(text("PF9NEW99"));
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#DecodedBlockTests.testABlockStoredInTheClearStaysInTheClear
  it("keeps a block stored in the clear in the clear", () => {
    const stored = testBlock({
      generation: 5,
      key: 0x77,
      entries: STANDARD_ENTRIES,
      encode: false,
    });
    const block = new LENVBlock(0, stored);
    expect(LenovoDMIDecodedBlock.encode(LenovoDMIDecodedBlock.decode(block), false)).toEqual(
      stored
    );
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#DecodedBlockTests.testAWipedBlockIsNotOffered
  it("is not offered for a wiped block", () => {
    const block = firstArea(wipedStoreImage()).blocks[0] as LENVBlock;
    expect(LenovoDMIDecodedBlock.canOpen(block)).toBe(false);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#DecodedBlockTests.testAnotherLengthIsRefused
  it("refuses another length", () => {
    expect(LenovoDMIDecodedBlock.encode(Uint8Array.of(0, 1, 2), true)).toBeUndefined();
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#BlockCodecTests
describe("a block's codec", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#BlockCodecTests.testTheBlockOpensInTheClearAndGoesBackEncoded
  it("opens the block in the clear and puts it back encoded", async () => {
    // Opened from the file and put back unchanged, the block is the bytes it
    // was; edited, it lands encoded with a checksum that adds up.
    const image = standardStoreImage();
    const block = firstArea(image).blocks[0] as LENVBlock;
    const parent: PartParent = {
      content: {
        size: image.length,
        read: async (offset, length) => image.slice(offset, offset + length),
      },
      source: block.range,
      name: "dump.bin",
      partName: "",
    };
    const codec = new LenovoDMIBlockCodec(block);

    const clear = await codec.decode(parent);
    expect(clear).toEqual(LenovoDMIDecodedBlock.decode(block));
    expect(await codec.encode(clear, parent)).toEqual(overwriting(block.range, block.stored));

    const start = entryDataRange(entryOf(block, 0x0400))[0] - block.offset;
    clear.set(text("PF9NEW99"), start);
    const update = await codec.encode(clear, parent);
    const back = new LENVBlock(block.offset, update.bytes);
    expect(back.checksumIsValid).toBe(true);
    expect(entryOf(back, 0x0400).data).toEqual(text("PF9NEW99"));
    expect(codec.badge.text).toBe("XOR 7F");
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#BlockOnItsOwnTests
describe("a block on its own", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#BlockOnItsOwnTests.testADecodedBlockOnItsOwnReads
  it("reads when it was opened out of the dump decoded", () => {
    // The header as the store holds it, the body in the clear.
    const clear = LenovoDMIDecodedBlock.decode(
      firstArea(standardStoreImage()).blocks[0] as LENVBlock
    );
    const reading = readLenovoDMI(clear);
    expect(reading.areas).toEqual([]);
    const block = reading.blocks[0];
    expect(block?.offset).toBe(0);
    expect(block?.encoding).toBe("plain");
    expect(entryOf(block, 0x0400).data).toEqual(text("PF0TEST1"));
    // The header's checksum is the encoded body's, and that is in order.
    expect(block?.checksumIsOfEncodedBody).toBe(true);
    expect(block?.checksumIsValid).toBe(true);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#BlockOnItsOwnTests.testAnEditInTheClearIsAChecksumToRecompute
  it("has a checksum to recompute after an edit in the clear", () => {
    // The block says what it should be — encoded, since that is the one it
    // carries.
    const stored = firstArea(standardStoreImage()).blocks[0] as LENVBlock;
    const clear = LenovoDMIDecodedBlock.decode(stored);
    const start = entryDataRange(entryOf(stored, 0x0400))[0] - stored.offset;
    clear[start] = "Q".charCodeAt(0);
    const block = readLenovoDMI(clear).blocks[0];
    expect(block?.checksumIsValid).toBe(false);
    const fixed = LenovoDMIDecodedBlock.encode(clear, true);
    expect(block?.expectedChecksum).toBe((fixed?.[0x0e] ?? 0) | ((fixed?.[0x0f] ?? 0) << 8));
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#BlockOnItsOwnTests.testAStoresBlocksAreNotCountedTwice
  it("is not counted twice when it is a store's", () => {
    const reading = readLenovoDMI(standardStoreImage());
    expect(reading.areas).toHaveLength(1);
    expect(reading.blocks).toEqual([]);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#BlockOnItsOwnTests.testAStraySignatureIsNotABlock
  it("is not a stray signature", () => {
    // `LENV` in code, followed by nothing that parses.
    const image = new Uint8Array(0x2000).fill(0x41);
    image.set(text("LENV"), 0x100);
    expect(readLenovoDMI(image).blocks).toEqual([]);
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#WindowsKeyTests
describe("the Windows key", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#WindowsKeyTests.header
  const header = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x1d, 0, 0, 0];
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#WindowsKeyTests.key
  const key = "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY";
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#WindowsKeyTests.entry
  const entry = (data: Uint8Array): LENVEntry => ({
    index: 0,
    offset: 0,
    key: smbiosKey(0x0001),
    flags: 0,
    unknown1: 0,
    unknown2: 0,
    data,
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#WindowsKeyTests.testTheValueIsTheKeyWithoutItsHeader
  it("is the key without the MSDM header in front of it", () => {
    expect(valueText(entry(Uint8Array.from([...header, ...text(key)])))).toBe(key);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#WindowsKeyTests.testALengthThatDoesNotMatchIsShownAsBytes
  it("is shown as bytes behind a length that does not match", () => {
    const short = Uint8Array.from([...header, ...text(key.slice(0, -1))]);
    expect(WindowsKey.key(short)).toBeUndefined();
    expect(WindowsKey.problem(short)).toEqual({ kind: "length", declared: 29, actual: 28 });
    expect(valueText(entry(short))).toBe(valueHex(short));
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#WindowsKeyTests.testAnotherSignatureIsShownAsBytes
  it("is shown as bytes behind another signature", () => {
    const other = Uint8Array.from([...header, ...text(key)]);
    other[8] = 2;
    expect(WindowsKey.key(other)).toBeUndefined();
    expect(WindowsKey.problem(other)).toEqual({
      kind: "signature",
      head: Array.from(other.slice(0, 16)),
    });
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LogKeyAndErasedBlockTests
describe("a log under its own key, and an erased block", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LogKeyAndErasedBlockTests.testALogUnderAKeyOfItsOwnReads
  it("reads a log under a key of its own", () => {
    // `88` against the blocks' `A0` on a real dump: its free space names it.
    const image = testStoreImage({
      log: testLog(STANDARD_LOG, 0x88),
      blocks: [
        testBlock({ generation: 2, key: 0xa0, entries: STANDARD_ENTRIES }),
        testBlock({ generation: 1, key: 0xa0, entries: STANDARD_ENTRIES }),
      ],
    });
    const area = firstArea(image);
    expect(area.log.key).toBe(0x88);
    expect(area.log.entries.map((entry) => entry.key)).toEqual(STANDARD_LOG.map((e) => e.key));
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#LogKeyAndErasedBlockTests.testAnErasedBlockIsErased
  it("calls a block erased to FF erased", () => {
    // Not a block with a strange header.
    const image = testStoreImage({
      log: testLog(STANDARD_LOG, 0x58),
      blocks: [
        testBlock({ generation: 74, key: 0x58, entries: STANDARD_ENTRIES }),
        new Uint8Array(0x1000).fill(0xff),
      ],
    });
    const area = firstArea(image);
    expect(area.blocks[1]?.isErased).toBe(true);
    expect(area.liveIndex).toBe(0);
    expect(area.findings).toContainEqual({ kind: "erased", block: 1 });
    expect(area.findings).not.toContainEqual({ kind: "missingSignature", block: 1 });
  });
});

// @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests
describe("the keys a driver names", () => {
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests.ns
  const ns = LenovoDMIFormat.smbiosNamespace;
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests.found
  const found = (code: number[]): number[] =>
    keyReferences(Uint8Array.from(code), [ns])
      .map((key) => key.type)
      .sort((left, right) => left - right);
  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests.pad
  const pad = [0x90, 0x90, 0x90, 0x90];

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests.testAConstantKey
  it("finds a key held as a constant in the driver's data", () => {
    expect(found([...pad, ...ns, 0x01, 0x00, ...pad])).toEqual([0x0001]);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests.testAKeyBuiltOnTheStack
  it("finds a key built on the stack", () => {
    // Four dword stores into the frame — `InstallMsdm`'s form.
    const store = (d: number, imm: readonly number[]) => [0xc7, 0x45, d, ...imm];
    const code = [
      ...pad,
      ...store(0xf0, ns.slice(0, 4)),
      ...store(0xf4, ns.slice(4, 8)),
      ...store(0xf8, ns.slice(8, 12)),
      ...store(0xfc, [...ns.slice(12, 14), 0x01, 0x00]),
      ...pad,
    ];
    expect(found(code)).toEqual([0x0001]);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests.testAKeyBuiltOnTheStackThroughRSP
  it("finds the same through [rsp+d]", () => {
    const store = (d: number, imm: readonly number[]) => [0xc7, 0x44, 0x24, d, ...imm];
    const code = [
      ...pad,
      ...store(0x34, ns.slice(0, 4)),
      ...store(0x38, ns.slice(4, 8)),
      ...store(0x3c, ns.slice(8, 12)),
      ...store(0x40, [...ns.slice(12, 14), 0x11, 0x00]),
      ...pad,
    ];
    expect(found(code)).toEqual([0x0011]);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests.testATypeSetByteByByte
  it("finds the types set byte by byte before each call", () => {
    // `L05SmbiosOverride`'s table; clearing the low byte is not a key.
    const code = [
      ...pad,
      ...[0xc7, 0x45, 0xf0, ...ns.slice(0, 4)],
      ...[0xc7, 0x45, 0xf4, ...ns.slice(4, 8)],
      ...[0xc7, 0x45, 0xf8, ...ns.slice(8, 12)],
      ...[0x66, 0xc7, 0x45, 0xfc, ...ns.slice(12, 14)],
      ...[0xc6, 0x45, 0xfe, 0x00], // clear the low byte
      ...[0xc6, 0x45, 0xff, 0x02, ...pad], // 0x0200
      ...[0xc6, 0x45, 0xff, 0x05, ...pad], // 0x0500
      ...[0x66, 0xc7, 0x45, 0xfe, 0x0b, 0x00, ...pad], // 0x000B
      ...[0xc3, 0xcc],
      ...[0xc6, 0x45, 0xff, 0x09], // another function: not ours
    ];
    expect(found(code)).toEqual([0x000b, 0x0200, 0x0500]);
  });

  // @upstream Packages/LenovoDMI/Tests/LenovoDMITests/LenovoDMITests.swift#KeyReferencesTests.testCodeWithoutTheNamespaceNamesNothing
  it("finds nothing in code without the namespace", () => {
    expect(found(new Array<number>(64).fill(0xc7))).toEqual([]);
  });
});
