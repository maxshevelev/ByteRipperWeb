import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { fitMicrocode } from "@/firmware/testing/testFit";
import { type MicrocodeHeader, readMicrocodeHeader } from "@/firmware/uefi/microcodeParser";
import {
  catalogueCounts,
  entriesFromTree,
  entryAt,
  entryFileName,
  filterCatalogue,
  latestOf,
  type MicrocodeCatalogueEntry,
  platformText,
} from "@/tools/fit/microcodeCatalogue";

/**
 * The list of microcode that can be browsed and added, read from the file names
 * in `github.com/platomav/CPUMicrocodes` — upstream's
 * `MicrocodeCatalogueTests`.
 */

/**
 * A slice of GitHub's recursive tree listing, with one of every shape the four
 * vendors write: they agree about almost nothing.
 */
const TREE = `
{"sha": "abc", "tree": [
  {"path": "Intel", "type": "tree"},
  {"path": "Intel/LICENSE", "type": "blob", "size": 1642},
  {"path": "Intel/cpu906EB_plat02_ver0000007C_2017-12-03_PRD_5046D998.bin",
   "type": "blob", "size": 98304},
  {"path": "Intel/cpu00611_plat00_ver00000B27_1996-12-18_PRD_05793E46.bin",
   "type": "blob", "size": 2048},
  {"path": "Intel/cpu906EB_plat22_ver000000F0_2021-11-12_PRE_1B2C3D4E.bin",
   "type": "blob", "size": 102400},
  {"path": "AMD/cpu00800F11_ver08001129_2017-07-14_4F426450.bin",
   "type": "blob", "size": 3200},
  {"path": "VIA/cpu10690_ver00000001_sig[BJ_10690.020]_2017-01-09_A8B24DC2.bin",
   "type": "blob", "size": 2048},
  {"path": "Freescale/soc8360_rev2.1_sig[Soft-UART]_3725F40B.bin",
   "type": "blob", "size": 1024},
  {"path": "README.md", "type": "blob", "size": 4096}
], "truncated": false}
`;

const entries = (): MicrocodeCatalogueEntry[] => entriesFromTree(TREE);

function entry(contains: string): MicrocodeCatalogueEntry {
  const found = entries().find((one) => one.path.includes(contains));
  if (found === undefined) throw new Error(`the fixture has no ${contains}`);
  return found;
}

/** An installed header as it comes off a FIT row: read from the same bytes. */
function header(signature: number, revision: number, platformIDs: number): MicrocodeHeader {
  const bytes = fitMicrocode({ signature, revision, platformIDs });
  const found = readMicrocodeHeader(0, new ImageReader(sourceOver(bytes)));
  if (found === undefined) throw new Error("the fixture is not a microcode");
  return found;
}

describe("reading a file name", () => {
  it("reads an Intel name field by field", () => {
    // Everything shown in the form comes out of the name, which is what makes
    // thousands of files searchable without downloading one of them.
    const one = entry("906EB_plat02");

    expect(one.vendor).toBe("Intel");
    expect(one.cpuid).toBe(0x906eb);
    expect(one.cpuidText).toBe("906EB");
    expect(one.platformID).toBe(0x02);
    expect(platformText(one)).toBe("02"); // as the file name writes it
    expect(one.revisionText).toBe("7C");
    expect(one.date).toBe("2017-12-03");
    expect(one.isProduction).toBe(true);
    expect(one.size).toBe(98304);
    expect(entryFileName(one)).toBe("cpu906EB_plat02_ver0000007C_2017-12-03_PRD_5046D998.bin");
  });

  it("gives an AMD name no platform", () => {
    // Only Intel has one, and its absence is not a defect in the other three.
    const one = entry("AMD/");

    expect(one.vendor).toBe("AMD");
    expect(one.cpuidText).toBe("800F11");
    expect(one.platformID).toBeUndefined();
    expect(platformText(one)).toBe("");
    expect(one.revisionText).toBe("8001129");
    expect(one.date).toBe("2017-07-14");
  });

  it("reads a VIA name past its signature field", () => {
    // VIA puts a signature in the middle of the name, which is neither a date
    // nor a version and must not be read as either.
    const one = entry("VIA/");

    expect(one.vendor).toBe("VIA");
    expect(one.cpuidText).toBe("10690");
    expect(one.revisionText).toBe("1");
    expect(one.date).toBe("2017-01-09");
  });

  it("gives a Freescale name no CPUID and no hex revision", () => {
    // It names a system-on-chip where the others name a CPUID, and its revision
    // is `2.1` rather than a hexadecimal number. Neither fits the fields the
    // others use, and neither is dropped.
    const one = entry("Freescale/");

    expect(one.vendor).toBe("Freescale");
    expect(one.cpuid).toBeUndefined();
    expect(one.cpuidText).toBe("8360");
    expect(one.revisionText).toBe("2.1");
    expect(one.date).toBe("");
  });

  it("marks a pre-release", () => {
    // Worth telling apart from a production one before it goes into a board.
    expect(entry("PRE").isProduction).toBe(false);
    expect(entry("906EB_plat02").isProduction).toBe(true);
  });

  it("skips what is not a microcode file", () => {
    expect(entries().some((one) => one.path.endsWith("LICENSE"))).toBe(false);
    expect(entries().some((one) => one.path === "README.md")).toBe(false);
    expect(entries()).toHaveLength(6);

    expect(entryAt("Intel/README.md", 10)).toBeUndefined();
    expect(entryAt("Intel/notes.bin", 10)).toBeUndefined();
    // A name with no revision field in it is not one of these.
    expect(entryAt("Intel/cpu906EB_plat02_2017-12-03_PRD_5046D998.bin", 10)).toBeUndefined();
    // Named like microcode, in no vendor's directory.
    expect(entryAt("cpu906EB_plat02_ver0000007C_2017-12-03_PRD_5046D998.bin", 10)).toBeUndefined();
  });

  it("orders the list by CPUID and then revision", () => {
    // Shortest first, so a five-digit Intel CPUID does not sort in among AMD's
    // longer ones, and the revisions of one processor stay together — an order
    // of the *processors*, which is what a person scrolls this list looking
    // for, rather than of the paths the files happen to sit at.
    expect(entries().map((one) => one.cpuidText)).toEqual([
      "611",
      "8360",
      "10690",
      "906EB",
      "906EB",
      "800F11",
    ]);
    expect(filterCatalogue(entries(), { vendor: "Intel" }).map((one) => one.revisionText)).toEqual([
      "B27",
      "7C",
      "F0",
    ]);
  });
});

describe("narrowing it down", () => {
  it("lists by vendor", () => {
    // Only Intel is ever offered — a FIT names no other kind — but all four are
    // read, because telling them apart is what keeps AMD's names from being
    // read as Intel's.
    expect(filterCatalogue(entries(), { vendor: "Intel" }).map((one) => one.cpuidText)).toEqual([
      "611",
      "906EB",
      "906EB",
    ]);
    expect(filterCatalogue(entries(), { vendor: "Freescale" }).map((one) => one.cpuidText)).toEqual(
      ["8360"]
    );
    expect([...catalogueCounts(entries())]).toEqual([
      ["Intel", 3],
      ["Freescale", 1],
      ["VIA", 1],
      ["AMD", 1],
    ]);
  });

  it("matches the CPUID as it is written", () => {
    expect(filterCatalogue(entries(), { vendor: "Intel", search: "906" })).toHaveLength(2);
    expect(filterCatalogue(entries(), { vendor: "Intel", search: "  906eb " })).toHaveLength(2);
    expect(filterCatalogue(entries(), { vendor: "Intel", search: "zzz" })).toEqual([]);
  });

  it("searches by the CPUID only", () => {
    // The revision and the file name are the catalogue's, and a bench does not
    // type them, so neither matches.
    expect(filterCatalogue(entries(), { vendor: "Intel", search: "B27" })).toEqual([]);
    expect(filterCatalogue(entries(), { vendor: "Intel", search: "1996" })).toEqual([]);
  });

  it("filters to the CPUIDs already in the image", () => {
    // The narrowing a bench asks for by hand: a dump is for one board.
    const found = filterCatalogue(entries(), {
      vendor: "Intel",
      cpuidsInTheImage: new Set([0x906eb]),
    });

    expect(found.map((one) => one.cpuidText)).toEqual(["906EB", "906EB"]);
    expect(filterCatalogue(entries(), { vendor: "Intel", cpuidsInTheImage: new Set() })).toEqual(
      []
    );
    // Freescale has no CPUID at all, so nothing of it survives that filter.
    expect(
      filterCatalogue(entries(), { vendor: "Freescale", cpuidsInTheImage: new Set([0x8360]) })
    ).toEqual([]);
  });

  it("combines the filters", () => {
    const found = filterCatalogue(entries(), {
      vendor: "Intel",
      search: "906",
      cpuidsInTheImage: new Set([0x906eb]),
    });

    expect(found.map((one) => one.revisionText)).toEqual(["7C", "F0"]);
  });
});

describe("whether it is the latest", () => {
  // The fixture tree holds two 906EB updates: `plat02` at r.7C and `plat22` at
  // r.F0. `plat22` is bits 1 and 5, `plat02` is bit 1 — so the `plat22` update
  // serves every platform the `plat02` one does.

  it("outdates a platform set an update covers", () => {
    expect(latestOf(header(0x906eb, 0x7c, 0x02), entries())).toEqual({
      kind: "outdated",
      newestRevision: 0xf0,
    });
  });

  it("calls the newest that serves this board latest", () => {
    expect(latestOf(header(0x906eb, 0xf0, 0x02), entries())).toEqual({ kind: "latest" });
  });

  it("names the revision an older header is behind", () => {
    expect(latestOf(header(0x906eb, 0x50, 0x02), entries())).toEqual({
      kind: "outdated",
      newestRevision: 0xf0,
    });
  });

  it("leaves overlapping platform sets undecided", () => {
    // The installed update serves platforms 1 and 3; the catalogue's newer r.F0
    // serves 1 and 5. If this board is platform 1 that update is newer for it,
    // and if it is platform 3 it is not — and which of the two the board is,
    // only `IA32_PLATFORM_ID` says.
    expect(latestOf(header(0x906eb, 0x50, 0x0a), entries())).toEqual({
      kind: "undecided",
      newestRevision: 0xf0,
    });
  });

  it("does not call an overlap that is not newer a doubt", () => {
    // Whether it serves this board changes nothing either way.
    expect(latestOf(header(0x906eb, 0x100, 0x0a), entries())).toEqual({ kind: "notRated" });
  });

  it("lets an all-platforms update serve every board", () => {
    // An all-zero mask is Intel's "every platform" (SDM §9.11, and the kernel's
    // `if (!pf2) return true`).
    const everywhere = entryAt(
      "Intel/cpu906EB_plat00_ver00000200_2019-01-01_PRD_5046D998.bin",
      0x100
    );
    if (everywhere === undefined) throw new Error("that name should read as microcode");

    expect(latestOf(header(0x906eb, 0x50, 0x02), [...entries(), everywhere])).toEqual({
      kind: "outdated",
      newestRevision: 0x200,
    });
  });

  it("does not rate a CPUID the catalogue does not list", () => {
    // The collection cannot speak to a processor it does not name.
    expect(latestOf(header(0x000a_0000, 0xf0, 0x02), entries())).toEqual({ kind: "notRated" });
  });

  it("does not rate a platform the catalogue does not list", () => {
    // The CPUID matches, but every update the catalogue holds for it is for
    // other boards. 0x55 is bits 0, 2, 4 and 6; the fixture's are bits 1 and 5.
    expect(latestOf(header(0x906eb, 0x7c, 0x55), entries())).toEqual({ kind: "notRated" });
  });
});
