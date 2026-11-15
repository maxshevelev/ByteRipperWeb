import { describe, expect, it } from "vitest";
import {
  CPUID_SEARCH_HISTORY_LIMIT,
  CpuidLookup,
  cpuidHighlights,
  rememberingCpuidSearch,
} from "@/firmware/intelCpuid/cpuidLookup";
import { familyMatches } from "@/firmware/intelCpuid/processorFamily";
import { TEST_TABLES } from "@/firmware/testing/testTables";

/**
 * The lookup's search finds what the repository's lookup page finds — upstream's IntelCPUID
 * `CPUIDLookupTests`, over the same fixture tables.
 */

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.lookup */
const lookup = new CpuidLookup(TEST_TABLES);

/** The highlighted stretches of `text`, as written. */
const lit = (text: string, query: string): string[] =>
  cpuidHighlights(text, query).map(({ start, end }) => text.slice(start, end));

// @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests
describe("the CPUID lookup", () => {
  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.testAModelIsFoundAsTypedAnyWay
  it("finds a model however it is typed, every word having to match", () => {
    const rows = lookup.rowsMatching("i5 8300h");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.name.includes("i5-8300H"))).toBe(true);
    expect(lookup.rowsMatching("I5-8300H").map((row) => row.name)).toEqual(
      rows.map((row) => row.name)
    );
    expect(lookup.rowsMatching("i5-8300H nosuchword")).toEqual([]);
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.testAnSSpecFindsItsModel
  it("finds an S-SPEC's model, under its CPUID", () => {
    const row = lookup.rowsMatching("SR3Z0")[0];
    expect(row?.cpuids).toEqual(["906EA"]);
    expect(row?.sSpecs).toContain("SR3Z0");
    // The word every name starts with is left off.
    expect(row?.name.startsWith("Intel ")).toBe(false);
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.testACPUIDPatternIsFoundByAnyOfItsCPUIDs
  it("finds a CPUID written with an X by any CPUID it stands for", () => {
    expect(lookup.rowsMatching("606A6").some((row) => row.cpuids.join() === "606AX")).toBe(true);
    expect(lookup.rowsMatching("606AG").some((row) => row.cpuids.join() === "606AX")).toBe(false);
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.testACPUIDQueryIsHeadedByItsEntry
  it("heads a query that is one CPUID with its entry and the updates it shares", () => {
    const heading = lookup.headings(" b06f5 ")[0];
    expect(heading?.family?.codeNames).toEqual(["Raptor Lake"]);
    expect(
      heading?.shared.some((one) => one.update.revision === "3E" && one.others.includes("90672"))
    ).toBe(true);
    // Part of a CPUID is a search, not a heading.
    expect(lookup.headings("B06F")).toEqual([]);
    expect(lookup.headings("B06F5 i3")).toEqual([]);

    const named = new Set(lookup.tables.families.flatMap((family) => family.cpuids));
    const lone = [...lookup.tables.microcode.cpuids]
      .sort()
      .find(
        (cpuid) =>
          !named.has(cpuid) &&
          !lookup.tables.families.some((family) => familyMatches(family, cpuid))
      );
    if (lone !== undefined) {
      const only = lookup.headings(lone)[0];
      expect(only?.family).toBeUndefined();
      expect(only?.cpuids).toEqual([lone]);
    }
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.testCompletionsAreRanked
  it("ranks completions: beginnings first, CPUIDs before S-SPECs before models", () => {
    const hints = lookup.hintsFor("906E");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.slice(0, 3).every((hint) => hint.kind === "cpuid")).toBe(true);
    expect(hints.length).toBeLessThanOrEqual(8);
    expect(lookup.hintsFor("906EA").some((hint) => hint.text === "906EA")).toBe(false);
    expect(lookup.hintsFor("  ")).toEqual([]);
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.testTheHighlightSpansIgnoredCharacters
  it("lights the text as written, across what the search ignores", () => {
    expect(lit("Core i7-2600K", "i72600")).toEqual(["i7-2600"]);
    expect(lit("Core i7-2600K", "core k")).toEqual(["Core", "K"]);
    expect(cpuidHighlights("Core i7-2600K", "")).toEqual([]);
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.testTheCountsLeaveSeriesOut
  it("counts the models without the series lines", () => {
    expect(lookup.modelCount).toBe(lookup.rows.filter((row) => !row.series).length);
    // The fixture has series lines.
    expect(lookup.modelCount).toBeLessThan(lookup.rows.length);
    expect(lookup.rowsMatching("").length).toBe(lookup.rows.length);
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/CPUIDLookupTests.swift#CPUIDLookupTests.testHistoryKeepsTheQueryNotItsBeginnings
  it("keeps a search in place of what was typed on the way to it, ten at most", () => {
    let history = rememberingCpuidSearch("SR0", []);
    history = rememberingCpuidSearch("i7  2600", history);
    history = rememberingCpuidSearch("SR00C", history);
    expect(history).toEqual(["SR00C", "i7 2600"]);
    expect(rememberingCpuidSearch("   ", history)).toEqual(history);
    let full: string[] = [];
    for (let n = 0; n < 12; n += 1) full = rememberingCpuidSearch(`Q${n}X`, full);
    expect(full.length).toBe(CPUID_SEARCH_HISTORY_LIMIT);
    expect(full[0]).toBe("Q11X");
  });
});
