import { describe, expect, it } from "vitest";
import {
  entrySources,
  familyMatches,
  type ProcessorFamily,
} from "@/firmware/intelCpuid/processorFamily";
import {
  decodeProcessorTables,
  notesOn,
  ProcessorTablesDecodeError,
  processorTablesAreEmpty,
} from "@/firmware/intelCpuid/processorTables";

/**
 * The processor tables are read from `github.com/maxshevelev/IntelCPUID` at run
 * time; what this module decides is what a pair of files is worth — upstream's
 * IntelCPUID `ProcessorTablesTests`.
 */

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests.json */
const json = (value: unknown): string => JSON.stringify(value);

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests.names */
const names = {
  formatVersion: 1,
  source: { retrieved: "2026-11-14" },
  entries: [
    {
      cpuids: ["806EA"],
      codeNames: ["Kaby Lake Refresh U"],
      cores: [],
      productFamilies: [],
      steppings: ["Y0"],
      segments: ["Mobile"],
      processors: [{ name: "Intel Core i5-8250U", sSpec: ["SR3LA"] }],
    },
  ],
};

/** @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests.signatures */
const signatures = {
  formatVersion: 1,
  updates: [
    {
      revision: "3E",
      date: "2025-10-12",
      signatures: [
        { cpuid: "90672", platforms: "07" },
        { cpuid: "B06F2", platforms: "07" },
      ],
      files: ["Intel/cpuB06F2_plat07_ver0000003E_2025-10-12_PRD_5582AF20.bin"],
    },
  ],
};

/** The reason a decode was refused, or nothing when it was not. */
function refusal(run: () => unknown): ProcessorTablesDecodeError["reason"] | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof ProcessorTablesDecodeError) return error.reason;
    throw error;
  }
  return undefined;
}

// @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests
describe("the processor tables", () => {
  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests.testAPairOfTheKnownFormatIsRead
  it("reads a pair of the format this build reads whole", () => {
    const tables = decodeProcessorTables(json(names), json(signatures));
    expect(tables.families[0]?.processors[0]?.sSpec).toEqual(["SR3LA"]);
    expect(tables.microcode.sharing("90672")).toEqual(["B06F2"]);
    expect(tables.retrieved).toBe("2026-11-14");
    expect(
      tables.microcode.updateForFile(
        "Intel/cpuB06F2_plat07_ver0000003E_2025-10-12_PRD_5582AF20.bin"
      )?.revision
    ).toBe("3E");
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests.testANewerFormatIsRefused
  it("refuses a file of a newer format, and one that says no format at all", () => {
    expect(
      refusal(() => decodeProcessorTables(json({ ...names, formatVersion: 2 }), json(signatures)))
    ).toEqual({ kind: "unsupportedFormat", file: "IntelCPUIDBrandNames.json", version: 2 });
    const { formatVersion: _, ...unversioned } = signatures;
    expect(refusal(() => decodeProcessorTables(json(names), json(unversioned)))).not.toBe(
      undefined
    );
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests.testAMalformedFileIsRefused
  it("refuses a file that is not the JSON this build reads, by name", () => {
    expect(refusal(() => decodeProcessorTables("<html>", json(signatures)))).toEqual({
      kind: "malformed",
      file: "IntelCPUIDBrandNames.json",
    });
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests.testNotesAreReadEntryByEntryAndNeverBlockTheTables
  it("reads the notes entry by entry, and never lets them block the tables", () => {
    const notes = {
      entries: [
        {
          cpuids: ["806EA"],
          codeNames: ["Kaby Lake Refresh U"],
          note: "From the notes.",
          evidence: [
            { url: "https://example.com/a", quote: "806EA", gives: ["cpuids"] },
            { url: "https://example.com/b", quote: "i5-8250U", gives: ["processors"] },
          ],
        },
        { cpuids: "not a list" },
      ],
    };
    const tables = decodeProcessorTables(json(names), json(signatures), json(notes));
    const family = tables.families[0];
    if (family === undefined) throw new Error("the table has its entry");
    expect(notesOn(tables, family)?.note).toBe("From the notes.");
    const read = notesOn(tables, family);
    expect(
      read === undefined ? [] : entrySources(read).map((one) => one.url),
      "a page that only lists models is not a source of the entry"
    ).toEqual(["https://example.com/a"]);
    expect(tables.notes.size).toBe(1);

    const unread = decodeProcessorTables(json(names), json(signatures), "404: Not Found");
    expect(unread.notes.size).toBe(0);
    expect(processorTablesAreEmpty(unread)).toBe(false);
  });

  // @upstream Packages/IntelCPUID/Tests/IntelCPUIDTests/ProcessorTablesTests.swift#ProcessorTablesTests.testAPatternMatchesAnyDigitWhereItHasAnX
  it("matches any digit where a CPUID has an X, and nothing longer", () => {
    const family: ProcessorFamily = {
      cpuids: ["606AX"],
      codeNames: ["Ice Lake Xeon-SP"],
      productFamilies: [],
      steppings: [],
      segments: [],
      processors: [],
    };
    expect(familyMatches(family, "606A6")).toBe(true);
    expect(familyMatches(family, "606B6")).toBe(false);
    expect(familyMatches(family, "606A66")).toBe(false);
  });
});
