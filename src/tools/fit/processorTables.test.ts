import { afterEach, describe, expect, it } from "vitest";
import {
  decodeProcessorTables,
  EMPTY_PROCESSOR_TABLES,
  installProcessorTables,
} from "@/firmware/intelCpuid/processorTables";
import { installTestTables } from "@/firmware/testing/testTables";
import { sharingSignature } from "@/tools/fit/microcodeSignatures";
import { currentProcessors, processorGroups } from "@/tools/fit/processorNames";

/**
 * The processor tables are read at run time (`src/firmware/intelCpuid`); what
 * this module adds is what the panel says of a CPUID with them — upstream's
 * FITTool `ProcessorTablesTests`.
 */

/** @upstream Modules/FITTool/Tests/FITToolTests/ProcessorTablesTests.swift#ProcessorTablesTests.json */
const json = (value: unknown): string => JSON.stringify(value);

/** @upstream Modules/FITTool/Tests/FITToolTests/ProcessorTablesTests.swift#ProcessorTablesTests.names */
const names = {
  formatVersion: 1,
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

/** @upstream Modules/FITTool/Tests/FITToolTests/ProcessorTablesTests.swift#ProcessorTablesTests.signatures */
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

// @upstream Modules/FITTool/Tests/FITToolTests/ProcessorTablesTests.swift#ProcessorTablesTests
describe("the processor tables the panel reads", () => {
  afterEach(installTestTables);

  // @upstream Modules/FITTool/Tests/FITToolTests/ProcessorTablesTests.swift#ProcessorTablesTests.testTheTablesAreWhatWasInstalled
  it("are what was installed, and nothing installed is nothing known", () => {
    installProcessorTables(EMPTY_PROCESSOR_TABLES);
    expect(currentProcessors()).toEqual([]);
    expect(processorGroups([0x806ea])[0]?.codeNames).toEqual([]);
    installProcessorTables(decodeProcessorTables(json(names), json(signatures)));
    expect(currentProcessors()[0]?.codeNames).toEqual(["Kaby Lake Refresh U"]);
    expect(sharingSignature(0x90672)).toEqual(["B06F2"]);
  });
});
