import { describe, expect, it } from "vitest";
import {
  type ProcessorFamily,
  processorFamilies,
  processorGroups,
  SHIPPED_PROCESSORS,
} from "@/tools/fit/processorNames";

/** Which processors a CPUID is — upstream's `ProcessorNamesTests`. */

const catalogue: readonly ProcessorFamily[] = [
  {
    cpuids: ["906EA"],
    codeNames: ["Coffee Lake H", "Coffee Lake S"],
    productFamilies: ["8th Generation Intel Core Processor Family"],
    steppings: ["U0"],
    segments: ["Mobile", "Desktop"],
    processors: [
      { name: "Intel Core i7-8750H", sSpec: ["SR3YY"] },
      { name: "Intel Core i7-8700", sSpec: [] },
    ],
  },
  {
    cpuids: ["606AX"],
    codeNames: ["Ice Lake Xeon-SP"],
    productFamilies: [],
    steppings: [],
    segments: ["Server"],
    processors: [{ name: "Intel Xeon Gold 6300", sSpec: [], series: true }],
  },
];

describe("the table of brand names", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testTheShippedTableIsRead
  it("ships with the app", () => {
    expect(SHIPPED_PROCESSORS.length).toBeGreaterThan(50);
    expect(processorFamilies([0x906ea])).not.toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testAnXInTheTableMatchesAnyDigit
  it("reads an X in a CPUID as any digit", () => {
    expect(processorFamilies([0x606a6], catalogue).map((one) => one.codeNames)).toEqual([
      ["Ice Lake Xeon-SP"],
    ]);
    expect(processorFamilies([0x606b6], catalogue)).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testAGroupIsFollowedByItsModelsWithoutTheWordIntel
  it("follows a group with its models, without the word Intel", () => {
    expect(processorGroups([0x906ea], catalogue)).toEqual([
      {
        cpuid: "906EA",
        codeNames: ["Coffee Lake H", "Coffee Lake S"],
        notes: ["U0 · Mobile · Desktop"],
        lines: [
          { kind: "model", text: "Core i7-8750H", detail: "SR3YY" },
          { kind: "model", text: "Core i7-8700", detail: "" },
        ],
      },
    ]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testEveryCPUIDOfTheUpdateIsAGroup
  it("makes every CPUID of an update a group, and says so of one it does not know", () => {
    const groups = processorGroups([0x906ea, 0x906eb], catalogue);
    expect(groups.map((one) => one.cpuid)).toEqual(["906EA", "906EB"]);
    expect(groups[1]?.codeNames).toEqual([]);
    expect(groups[1]?.lines).toEqual([
      { kind: "unknown", text: "No processor names known for CPUID 906EB", detail: "" },
    ]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testWhatIsSaidAboutAGroupIsANote
  it("says what it knows of a group besides its name in a note", () => {
    // The cores — a hybrid's two kinds as one part — then the stepping and the
    // segments; and a CPUID with two groups says whose each note is.
    const [first] = catalogue;
    if (first === undefined) throw new Error("the fixture has a first family");
    const hybrid: ProcessorFamily = { ...first, cores: ["Golden Cove", "Gracemont"] };
    const groups = processorGroups([0x906ea], [hybrid]);
    expect(groups[0]?.notes).toEqual(["Golden Cove + Gracemont · U0 · Mobile · Desktop"]);
    expect(groups[0]?.lines.some((line) => line.text.startsWith("Coffee Lake"))).toBe(false);

    const shipped = processorGroups([0x90672]);
    expect(shipped[0]?.codeNames).toEqual(["Alder Lake-HX", "Alder Lake S"]);
    expect(shipped[0]?.notes[0]?.startsWith("Golden Cove + Gracemont")).toBe(true);

    const twoGroups = processorGroups([0x806d1]);
    expect(twoGroups[0]?.notes.length).toBe(2);
    expect(twoGroups[0]?.notes.every((note) => note.startsWith("Tiger Lake H: "))).toBe(true);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testASeriesIsSaidToBeOne
  it("says a series is one", () => {
    const groups = processorGroups([0x606a6], catalogue);
    expect(groups[0]?.lines.at(-1)?.detail).toBe("series, models not listed");
  });
});
