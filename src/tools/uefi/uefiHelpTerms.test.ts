/**
 * Ported from `UEFIHelpTermsTests.swift`: which glossary entry a node's `?`
 * opens.
 *
 * Two things are worth pinning — that a reader standing in a region is told
 * about *that* region rather than about regions in general, and that every term
 * this file names is one the book actually holds. A mapping into nothing is a
 * `?` that opens an empty popover on a bench.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { bundledHelpContent } from "@/core/help/bundledHelp";
import { type HelpBook, helpTerm } from "@/core/help/helpBook";
import { termId } from "@/core/help/helpIds";
import { loadHelpBook } from "@/core/help/helpLoader";
import { makeNode, type UEFINodeKind } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";

const node = (kind: UEFINodeKind, subtype?: number) =>
  makeNode({
    kind,
    subtype,
    name: "",
    header: { start: 0, end: 0x10 },
    body: { start: 0x10, end: 0x20 },
  });

describe("which entry a node's ? opens", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHelpTermsTests.swift#UEFIHelpTermsTests.testAKindGoesToItsOwnEntry
  it("sends a kind to its own entry", () => {
    expect(uefiHelpTerm(node("volume"))).toBe(termId("volume"));
    expect(uefiHelpTerm(node("section"))).toBe(termId("section"));
    expect(uefiHelpTerm(node("flashDescriptor"))).toBe(termId("flash-descriptor"));
    expect(uefiHelpTerm(node("freeSpace"))).toBe(termId("free-space"));
    expect(uefiHelpTerm(node("nonUEFIData"))).toBe(termId("non-uefi-data"));
  });

  /**
   * The most useful thing the panel can explain about a region row is which
   * region the reader is standing in.
   */
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHelpTermsTests.swift#UEFIHelpTermsTests.testARegionGoesToThatRegionsOwnEntry
  it("sends a region to that region's own entry", () => {
    expect(uefiHelpTerm(node("region", Sub.meRegion))).toBe(termId("me-region"));
    expect(uefiHelpTerm(node("region", Sub.gbeRegion))).toBe(termId("gbe-region"));
    expect(uefiHelpTerm(node("region", Sub.biosRegion))).toBe(termId("bios-region"));
    expect(uefiHelpTerm(node("region", Sub.bios2Region))).toBe(termId("bios-region"));
    // One nobody has written a page about falls back to the general entry
    // rather than to nothing.
    expect(uefiHelpTerm(node("region", 0xfe))).toBe(termId("region"));
    expect(uefiHelpTerm(node("region", undefined))).toBe(termId("region"));
  });

  /**
   * A pad file is a file only in the sense that every slot in a volume has a
   * header; sending the reader to the page about files would answer a question
   * they did not ask.
   */
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHelpTermsTests.swift#UEFIHelpTermsTests.testAPadFileIsNotAFile
  it("does not call a pad file a file", () => {
    expect(uefiHelpTerm(node("file", 0xf0))).toBe(termId("pad-file"));
    expect(uefiHelpTerm(node("file", 0x07))).toBe(termId("ffs-file"));
  });

  /**
   * Every NVRAM store and entry answers the same question, so they share one
   * entry rather than each getting a page about a vendor's format.
   */
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHelpTermsTests.swift#UEFIHelpTermsTests.testTheNVRAMStoresShareOneEntry
  it("gives every NVRAM store and entry the one entry", () => {
    const stores: UEFINodeKind[] = [
      "vssStore",
      "vss2Store",
      "ftwStore",
      "fdcStore",
      "sysFStore",
      "flashMapStore",
      "evsaStore",
      "cmdbStore",
      "flashDeviceMapStore",
      "vssEntry",
      "sysFEntry",
      "evsaEntry",
      "flashMapEntry",
      "flashDeviceMapEntry",
    ];
    for (const kind of stores) {
      expect(uefiHelpTerm(node(kind)), `${kind} should read as an NVRAM store`).toBe(termId("vss"));
    }
  });
});

describe("every mapping lands in the book", () => {
  let book: HelpBook;
  beforeAll(async () => {
    book = await loadHelpBook("en", bundledHelpContent);
  });

  /**
   * The test that matters: every node kind the parser can produce maps to a
   * term the book holds. A `?` that opens nothing is worse than no `?`.
   */
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIHelpTermsTests.swift#UEFIHelpTermsTests.testEveryKindMapsToATermTheBookHolds
  it("maps every kind the parser can produce to a term the glossary has", () => {
    const kinds: UEFINodeKind[] = [
      "capsule",
      "intelImage",
      "uefiImage",
      "flashDescriptor",
      "region",
      "volume",
      "file",
      "section",
      "microcode",
      "vssStore",
      "vss2Store",
      "ftwStore",
      "fdcStore",
      "sysFStore",
      "flashMapStore",
      "evsaStore",
      "cmdbStore",
      "slicData",
      "vssEntry",
      "sysFEntry",
      "evsaEntry",
      "flashMapEntry",
      "flashDeviceMapStore",
      "flashDeviceMapEntry",
      "padding",
      "freeSpace",
      "nonUEFIData",
    ];
    for (const kind of kinds) {
      const term = uefiHelpTerm(node(kind));
      if (term === undefined) continue;
      expect(
        helpTerm(book, term),
        `${kind} points at “${term}”, which is not in the glossary`
      ).toBeDefined();
    }
    // And every region the descriptor can name, which the mapping answers for
    // by subtype rather than by kind.
    for (const subtype of Object.values(Sub)) {
      const term = uefiHelpTerm(node("region", subtype));
      expect(
        helpTerm(book, term ?? termId("region")),
        `a region of subtype ${subtype} points at “${term}”, which is not in the glossary`
      ).toBeDefined();
    }
  });
});
