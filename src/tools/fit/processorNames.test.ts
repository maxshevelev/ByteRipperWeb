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

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testTheShippedTableHasTheExtraEntries
  it("has the CPUIDs the article has no row for", () => {
    // Grand Ridge, with ARK's codes and no stepping, which no page ties to it.
    const [family] = processorFamilies([0xb0664]);
    expect(family?.codeNames).toEqual(["Grand Ridge"]);
    expect(family?.steppings).toEqual([]);
    const model = family?.processors.find((one) => one.name === "Intel Atom P6922-3");
    expect(model?.sSpec).toEqual(["SRPFF", "SA4RS", "SA4RT", "SA4RW"]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testACodeNameWithNoModelsSaysSo
  it("says so of a code name with no models sold on it", () => {
    // B0660, Grand Ridge by the kernel, where Intel lists models only for B0664.
    const [group] = processorGroups([0xb0660]);
    expect(group?.codeNames).toEqual(["Grand Ridge"]);
    expect(group?.lines).toEqual([
      { kind: "unknown", text: "No processor models known for this CPUID", detail: "" },
    ]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testRaptorLakesA0HasItsSteppingAndNoModels
  it("has Raptor Lake's A0, with its stepping and no models", () => {
    const [family] = processorFamilies([0xb0670]);
    expect(family?.codeNames).toEqual(["Raptor Lake"]);
    expect(family?.steppings).toEqual(["A0"]);
    expect(family?.processors).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testRaptorLakesH0HasItsModels
  it("has Raptor Lake's H0 and its models", () => {
    const [family] = processorFamilies([0xb06f5]);
    expect(family?.codeNames).toEqual(["Raptor Lake"]);
    expect(family?.steppings).toEqual(["H0"]);
    const model = family?.processors.find((one) => one.name === "Intel Core i3-13100");
    expect(model?.sSpec).toEqual(["SRMBU"]);
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
        notes: [
          "Coffee Lake H, Coffee Lake S\n8th Generation Intel Core Processor Family\nStepping U0 · Mobile · Desktop",
        ],
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
  it("says what it knows of a group in a note, and names each of several groups over its models", () => {
    // Its names, its product families, the cores — a hybrid's two kinds as one
    // part — the stepping and the segments: a note for the popover's head, not
    // a line of its list.
    const [first] = catalogue;
    if (first === undefined) throw new Error("the fixture has a first family");
    const hybrid: ProcessorFamily = {
      ...first,
      cores: ["Golden Cove", "Gracemont"],
      productFamilies: [],
    };
    const groups = processorGroups([0x906ea], [hybrid]);
    expect(groups[0]?.notes).toEqual([
      "Coffee Lake H, Coffee Lake S\nGolden Cove + Gracemont · Stepping U0 · Mobile · Desktop",
    ]);
    expect(
      groups[0]?.lines.map((line) => line.kind),
      "no line naming the one group"
    ).toEqual(["model", "model"]);

    const shipped = processorGroups([0x90672]);
    expect(shipped[0]?.codeNames).toEqual(["Alder Lake-HX", "Alder Lake S"]);
    expect(shipped[0]?.notes[0]?.includes("\nGolden Cove + Gracemont")).toBe(true);

    const twoGroups = processorGroups([0x806d1]);
    expect(twoGroups[0]?.notes.length).toBe(2);
    expect(twoGroups[0]?.notes.every((note) => note.startsWith("Tiger Lake H\n"))).toBe(true);
    const headings = twoGroups[0]?.lines.filter((line) => line.kind === "family") ?? [];
    expect(headings.map((line) => line.text)).toEqual(["Tiger Lake H", "Tiger Lake H"]);
    expect(
      headings.map((line) => line.detail),
      "each group's note over its own models"
    ).toEqual(twoGroups[0]?.notes.map((note) => note.replace("Tiger Lake H\n", "")));
    expect(twoGroups[0]?.lines[0]?.kind, "the first group named over its models").toBe("family");
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorNamesTests.swift#ProcessorNamesTests.testASeriesIsSaidToBeOne
  it("says a series is one", () => {
    const groups = processorGroups([0x606a6], catalogue);
    expect(groups[0]?.lines.at(-1)?.detail).toBe("series, models not listed");
  });
});
