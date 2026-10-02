import { describe, expect, it } from "vitest";
import { encodeUtf8 } from "@/core/text/utf";
import { sourceOver } from "@/firmware/byteSource";
import { BinaryWriter, DRIVER_GUID, section } from "@/firmware/testing/testImage";
import {
  checksummedNvarEntry,
  nvarDataEntry,
  nvarEntry,
  nvarSectionVolume,
  nvarStore,
  nvarVolume,
} from "@/firmware/testing/testNvar";
import { guid } from "@/firmware/uefi/efiGuid";
import { itemSubtype, itemType } from "@/firmware/uefi/itemClassification";
import { NVAR } from "@/firmware/uefi/nvarParser";
import {
  nvramNvarBbDefaultsFileGuid,
  nvramNvarExternalDefaultsFileGuid,
  nvramNvarPeiExternalDefaultsFileGuid,
} from "@/firmware/uefi/nvramGuids";
import { Section } from "@/firmware/uefi/sectionParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType, Sub, subtypeName } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `NvarParseTests.swift`: reading AMI NVAR stores (§9) — where they
 * are found (three file GUIDs and raw sections) and what a store reads as:
 * entries, their chains, free space, and the GUID table at the end.
 */

const vendor = guid("8BE4DF61-93CA-11D2-AA0D-00E098032B8C");
const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const fileIn = (parsed: ReturnType<typeof parse>): UEFINode =>
  parsed.roots[0]?.children[0] as UEFINode;
const bytes = (...values: number[]) => Uint8Array.from(values);
const kindsOf = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);

describe("a store", () => {
  /**
   * Two variables — one carrying its GUID and an ASCII name, one naming its
   * GUID by index and spelling its name in UCS-2 — then the erased rest of the
   * store, then the one-GUID table the second entry points into.
   */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testAStoreFileReadsAsItsEntriesFreeSpaceAndGuidTable
  it("reads a store file as its entries, free space and GUID table", () => {
    const setup = nvarEntry({ name: "Setup", data: bytes(0x01, 0x02) });
    const lang = nvarEntry({
      attributes: NVAR.valid,
      guidIndex: 0,
      name: "Lang",
      data: bytes(0x65, 0x6e),
    });
    const parsed = parse(nvarVolume({ body: nvarStore([setup, lang], { guids: [vendor] }) }));
    const file = fileIn(parsed);
    const base = file.body.start;

    expect(kindsOf(file.children)).toEqual([
      "nvarEntry",
      "nvarEntry",
      "freeSpace",
      "nvarGuidStore",
    ]);
    expect(parsed.diagnostics).toEqual([]);

    // Ten bytes of header, the sixteen-byte GUID and "Setup\0" are the entry's
    // header; the two bytes after are its value.
    const first = file.children[0] as UEFINode;
    expect(first.name).toBe("Setup");
    expect(first.guid).toEqual(DRIVER_GUID);
    expect(first.subtype).toBe(Sub.fullNvarEntry);
    expect(first.header).toEqual({ start: base, end: base + 32 });
    expect(first.body).toEqual({ start: base + 32, end: base + 34 });
    expect(first.tail.end - first.tail.start).toBe(0);

    const second = file.children[1] as UEFINode;
    expect(second.name).toBe("Lang");
    expect(second.guid).toEqual(vendor);
    expect(second.header).toEqual({ start: base + 34, end: base + 34 + 10 + 1 + 10 });

    expect(nodeRange(file.children[2] as UEFINode)).toEqual({
      start: base + setup.length + lang.length,
      end: base + 0x100 - 16,
    });
    expect((file.children[2] as UEFINode).isErased).toBe(true);
    expect((file.children[3] as UEFINode).body).toEqual({
      start: base + 0x100 - 16,
      end: base + 0x100,
    });
    expect(itemType(file.children[3] as UEFINode)).toBe(ItemType.nvarGuidStore);
  });

  /** The PEI and BB defaults are stores too, under GUIDs of their own. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testBothDefaultsFilesReadAsStores
  it("reads both defaults files as stores", () => {
    for (const fileGuid of [nvramNvarPeiExternalDefaultsFileGuid, nvramNvarBbDefaultsFileGuid]) {
      const parsed = parse(nvarVolume({ fileGuid, body: nvarStore([nvarEntry()]) }));
      expect(kindsOf(fileIn(parsed).children)).toEqual(["nvarEntry", "freeSpace"]);
    }
  });

  /** A raw file with any other GUID is bytes, whatever it holds. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testARawFileWithAnotherGuidIsNotReadAsAStore
  it("does not read a raw file with another GUID as a store", () => {
    const parsed = parse(nvarVolume({ fileGuid: DRIVER_GUID, body: nvarStore([nvarEntry()]) }));
    expect(fileIn(parsed).children).toEqual([]);
  });

  /** A store file that was never written is an empty store, not a defect. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testAnErasedStoreFileIsFreeSpace
  it("reads an erased store file as free space", () => {
    const parsed = parse(nvarVolume({ body: nvarStore([]) }));
    expect(kindsOf(fileIn(parsed).children)).toEqual(["freeSpace"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  /** A store file whose body is not entries stays a leaf, and the parse says so. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testAStoreFileThatIsNotAStoreStaysALeafAndSaysSo
  it("keeps a store file that is not a store as a leaf, and says so", () => {
    const body = Uint8Array.from([0x12, 0x34, 0x56, 0x78, ...nvarStore([])]);
    const parsed = parse(nvarVolume({ body }));
    const file = fileIn(parsed);
    expect(file.children).toEqual([]);
    expect(parsed.diagnostics.map((one) => one.detail.kind)).toEqual(["unreadableNvarEntry"]);
    expect(parsed.diagnostics[0]?.offset).toBe(file.body.start);
  });
});

describe("chains", () => {
  /**
   * A variable written twice: the first entry links to a data-only entry with
   * the new value. The link holds the name and GUID; the data entry, the last
   * of the chain, takes them from it. The chain starts at the store's first
   * entry — the case the reference misses.
   */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testADataEntryTakesItsNameFromTheEntryThatLinksToIt
  it("gives a data entry the name of the entry that links to it", () => {
    // `next` changes no size, so an entry's length is known before it is
    // written.
    const linked = nvarEntry({ next: nvarEntry({ data: bytes(0x01) }).length, data: bytes(0x01) });
    const parsed = parse(
      nvarVolume({ body: nvarStore([linked, nvarDataEntry({ data: bytes(0x02) })]) })
    );
    const entries = fileIn(parsed).children;

    expect(entries[0]?.subtype).toBe(Sub.linkNvarEntry);
    expect(entries[1]?.subtype).toBe(Sub.dataNvarEntry);
    expect(entries[1]?.name).toBe("Setup");
    expect(entries[1]?.guid).toEqual(DRIVER_GUID);
    expect((entries[1] as UEFINode).header.end - (entries[1] as UEFINode).header.start).toBe(
      NVAR.headerSize
    );
    expect(parsed.diagnostics).toEqual([]);
  });

  /** A link in the middle of a chain is a link; only the last is data. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testOnlyTheLastLinkOfAChainIsData
  it("makes only the last link of a chain data", () => {
    const head = nvarEntry({ next: nvarEntry({ data: bytes(0x01) }).length, data: bytes(0x01) });
    const middle = nvarDataEntry({
      next: nvarDataEntry({ data: bytes(0x02) }).length,
      data: bytes(0x02),
    });
    const parsed = parse(
      nvarVolume({
        body: nvarStore([
          nvarEntry({ name: "Other", data: bytes(0x00) }),
          head,
          middle,
          nvarDataEntry({ data: bytes(0x03) }),
        ]),
      })
    );
    const entries = fileIn(parsed).children;

    expect(entries[1]?.subtype).toBe(Sub.linkNvarEntry);
    expect(entries[2]?.subtype).toBe(Sub.linkNvarEntry);
    expect(entries[2]?.name).toBe("Setup");
    expect(entries[3]?.subtype).toBe(Sub.dataNvarEntry);
    expect(entries[3]?.name).toBe("Setup");
  });

  /**
   * A superseded entry is invalid, and a data entry whose chain starts at one —
   * or at nothing — is a broken link.
   */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testASupersededEntryAndADataEntryWithNoValidHeadAreInvalid
  it("calls a superseded entry, and a data entry with no valid head, invalid", () => {
    const invalid = NVAR.localGuid | NVAR.asciiName;
    const head = nvarEntry({
      attributes: invalid,
      next: nvarEntry({ attributes: invalid, data: bytes(0x01) }).length,
      data: bytes(0x01),
    });
    const parsed = parse(
      nvarVolume({
        body: nvarStore([
          head,
          nvarDataEntry({ data: bytes(0x02) }),
          nvarDataEntry({ data: bytes(0x03) }),
        ]),
      })
    );
    const entries = fileIn(parsed).children;

    expect(entries[0]?.subtype).toBe(Sub.invalidNvarEntry);
    expect(entries[0]?.name).toBe("Invalid");
    expect(entries[1]?.subtype).toBe(Sub.invalidLinkNvarEntry);
    expect(entries[2]?.subtype).toBe(Sub.invalidLinkNvarEntry);
    expect(entries[2]?.name).toBe("Invalid link");
    expect(entries[2]?.guid).toBeUndefined();
  });
});

describe("the extended header", () => {
  /**
   * A checksum that adds up says nothing; one that does not is reported with
   * the byte it should be. The extended header is the entry's tail.
   */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testAnExtendedHeaderChecksumIsVerified
  it("verifies its checksum", () => {
    const good = parse(
      nvarVolume({
        body: nvarStore([checksummedNvarEntry({ name: "Setup", data: bytes(0x10, 0x20, 0x30) })]),
      })
    );
    const entry = fileIn(good).children[0] as UEFINode;
    expect(good.diagnostics).toEqual([]);
    expect(entry.tail.end - entry.tail.start).toBe(4);
    expect(entry.body.end - entry.body.start).toBe(3);

    const bad = parse(
      nvarVolume({
        body: nvarStore([
          checksummedNvarEntry({ name: "Setup", data: bytes(0x10, 0x20, 0x30), wrongBy: 1 }),
        ]),
      })
    );
    const detail = bad.diagnostics[0]?.detail;
    expect(detail?.kind).toBe("checksumMismatch");
    if (detail?.kind !== "checksumMismatch") return;
    expect(detail.structure).toBe("nvarEntry");
    expect(detail.computed).toBe((detail.stored - 1) & 0xff);
    expect(bad.diagnostics[0]?.offset).toBe(nodeRange(fileIn(bad).children[0] as UEFINode).end - 3);
  });
});

describe("a broken store", () => {
  /** An entry that does not read stops the walk: what came before stays, and the rest is padding. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testABrokenEntryKeepsTheEntriesBeforeIt
  it("keeps the entries before a broken one", () => {
    const broken = new BinaryWriter()
      .u32(NVAR.signature)
      .u16(4) // smaller than the header
      .u24(NVAR.noNext)
      .u8(NVAR.valid).bytes;
    const first = nvarEntry();
    const parsed = parse(nvarVolume({ body: nvarStore([first, broken]) }));
    const file = fileIn(parsed);

    expect(kindsOf(file.children)).toEqual(["nvarEntry", "padding"]);
    expect(parsed.diagnostics.map((one) => one.detail.kind)).toEqual(["unreadableNvarEntry"]);
    expect(parsed.diagnostics[0]?.offset).toBe(file.body.start + first.length);
  });
});

describe("nested stores", () => {
  /** A variable whose value is a store of its own opens onto it. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testAnEntryWhoseValueIsAStoreOpensOntoIt
  it("opens an entry whose value is a store onto it", () => {
    const inner = nvarEntry({ name: "Inner", data: bytes(0x07) });
    const parsed = parse(
      nvarVolume({ body: nvarStore([nvarEntry({ name: "StdDefaults", data: inner })]) })
    );
    const outer = fileIn(parsed).children[0] as UEFINode;
    expect(outer.children.map((one) => one.name)).toEqual(["Inner"]);
    expect(nodeRange(outer.children[0] as UEFINode)).toEqual(outer.body);
  });
});

describe("raw sections", () => {
  /** The reference tries every raw section as a store, and so does this. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testARawSectionHoldingAStoreReadsAsOne
  it("reads a raw section holding a store as one", () => {
    const store = nvarStore([nvarEntry()], { length: 0x40 });
    const parsed = parse(
      nvarSectionVolume({ sections: [section({ type: Section.raw, body: store })] })
    );
    const holder = fileIn(parsed).children[0] as UEFINode;
    expect(kindsOf(holder.children)).toEqual(["nvarEntry", "freeSpace"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  /** A raw section that is not a store is left alone, quietly — even one that opens on the same first byte. */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testARawSectionThatIsNotAStoreIsLeftAloneQuietly
  it("leaves a raw section that is not a store alone, quietly", () => {
    for (const body of [
      bytes(0x4d, 0x5a, 0x90, 0x00),
      encodeUtf8("Nope"),
      bytes(0xff, 0xff, 0xff, 0xff),
    ]) {
      const parsed = parse(nvarSectionVolume({ sections: [section({ type: Section.raw, body })] }));
      expect((fileIn(parsed).children[0] as UEFINode).children, `${body}`).toEqual([]);
      expect(parsed.diagnostics, `${body}`).toEqual([]);
    }
  });

  /**
   * The external defaults file's raw section is meant to be a store: an erased
   * one is an empty store, anything else is reported.
   */
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testTheExternalDefaultsRawSectionIsMeantToBeAStore
  it("expects the external defaults file's raw section to be a store", () => {
    const fileGuid = nvramNvarExternalDefaultsFileGuid;
    const erased = parse(
      nvarSectionVolume({
        fileGuid,
        sections: [section({ type: Section.raw, body: new Uint8Array(0x20).fill(0xff) })],
      })
    );
    expect(kindsOf((fileIn(erased).children[0] as UEFINode).children)).toEqual(["freeSpace"]);
    expect(erased.diagnostics).toEqual([]);

    const garbage = parse(
      nvarSectionVolume({
        fileGuid,
        sections: [section({ type: Section.raw, body: bytes(0x12, 0x34, 0x56, 0x78) })],
      })
    );
    expect(garbage.diagnostics.map((one) => one.detail.kind)).toEqual(["unreadableNvarEntry"]);
  });
});

describe("classification", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvarParseTests.swift#NvarParseTests.testAnEntryClassifiesAsAnNvarEntryWithItsSubtype
  it("classifies an entry as an NVAR entry with its subtype", () => {
    const parsed = parse(nvarVolume({ body: nvarStore([nvarEntry()]) }));
    const entry = fileIn(parsed).children[0] as UEFINode;
    expect(itemType(entry)).toBe(ItemType.nvarEntry);
    expect(itemSubtype(entry)).toBe(Sub.fullNvarEntry);
    expect(subtypeName(itemType(entry), itemSubtype(entry) as number)).toBe("Full");
  });
});
