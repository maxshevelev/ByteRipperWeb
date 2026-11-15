import { beforeEach, describe, expect, it } from "vitest";
import { MicrocodeSignatures } from "@/firmware/intelCpuid/microcodeSignatures";
import { installTestTables } from "@/firmware/testing/testTables";
import {
  entryAt,
  filterCatalogue,
  type MicrocodeCatalogueEntry,
} from "@/tools/fit/microcodeCatalogue";
import {
  currentMicrocodeSignatures,
  extendedCpuids,
  sharingSignature,
} from "@/tools/fit/microcodeSignatures";
import { processorGroups } from "@/tools/fit/processorNames";

/**
 * Which microcode updates serve several CPUIDs, from their extended signature
 * tables: what the form's Extended CPUIDs column shows and searches, and what
 * the processors popover says a CPUID shares its microcode with — upstream's
 * `MicrocodeSignaturesTests`.
 */

/** @upstream Modules/FITTool/Tests/FITToolTests/MicrocodeSignaturesTests.swift#MicrocodeSignaturesTests.signatures */
const signatures = new MicrocodeSignatures([
  {
    revision: "3E",
    date: "2025-10-12",
    signatures: [
      { cpuid: "90672", platforms: "07" },
      { cpuid: "B06F2", platforms: "07" },
      { cpuid: "B06F6", platforms: "07" },
    ],
    files: [
      "Intel/cpuB06F2_plat07_ver0000003E_2025-10-12_PRD_5582AF20.bin",
      "Intel/cpu90672_plat07_ver0000003E_2025-10-12_PRD_00000000.bin",
    ],
  },
  {
    revision: "3A",
    date: "2024-01-01",
    signatures: [
      { cpuid: "90672", platforms: "07" },
      { cpuid: "90675", platforms: "07" },
    ],
    files: ["Intel/cpu90672_plat07_ver0000003A_2024-01-01_PRD_11111111.bin"],
  },
]);

/** @upstream Modules/FITTool/Tests/FITToolTests/MicrocodeSignaturesTests.swift#MicrocodeSignaturesTests.entry */
function entry(name: string, size = 0x35c00): MicrocodeCatalogueEntry {
  const found = entryAt(`Intel/${name}`, size);
  if (found === undefined) throw new Error(`not a catalogue file: ${name}`);
  return found;
}

// @upstream Modules/FITTool/Tests/FITToolTests/MicrocodeSignaturesTests.swift#MicrocodeSignaturesTests
describe("the updates that serve several CPUIDs", () => {
  beforeEach(installTestTables);

  // @upstream Modules/FITTool/Tests/FITToolTests/MicrocodeSignaturesTests.swift#MicrocodeSignaturesTests.testAFilesExtendedCPUIDsAreItsUpdatesOthers
  it("gives a file its update's other CPUIDs, without the one it is named after", () => {
    const file = entry("cpuB06F2_plat07_ver0000003E_2025-10-12_PRD_5582AF20.bin");
    expect(extendedCpuids(file, signatures)).toEqual(["90672", "B06F6"]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/MicrocodeSignaturesTests.swift#MicrocodeSignaturesTests.testAnUnseenCopyIsMatchedByItsUpdateAndAnUnknownUpdateHasNone
  it("matches a copy it has not seen by its update, and says none for an update it does not know", () => {
    const copy = entry("cpuB06F6_plat07_ver0000003E_2025-10-12_PRD_5582AF1C.bin");
    expect(extendedCpuids(copy, signatures)).toEqual(["90672", "B06F2"]);
    const other = entry("cpuB06F6_plat07_ver0000003F_2026-01-01_PRD_12345678.bin");
    expect(extendedCpuids(other, signatures)).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/MicrocodeSignaturesTests.swift#MicrocodeSignaturesTests.testACPUIDSharesTheNewestUpdatesOthers
  it("shares a CPUID's microcode with the CPUIDs of the newest update that serves it", () => {
    expect(sharingSignature(0x90672, signatures)).toEqual(["B06F2", "B06F6"]);
    expect(sharingSignature(0x806ea, signatures)).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/MicrocodeSignaturesTests.swift#MicrocodeSignaturesTests.testTheSearchFindsAFileByAnExtendedCPUID
  it("finds a file by any CPUID its update serves", () => {
    const file = entry("cpuB06F2_plat07_ver0000003E_2025-10-12_PRD_5582AF20.bin");
    expect(
      filterCatalogue([file], { vendor: "Intel", search: "b06f6", processors: [], signatures })
    ).toEqual([file]);
    expect(
      filterCatalogue([file], { vendor: "Intel", search: "B06F7", processors: [], signatures })
    ).toEqual([]);
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/MicrocodeSignaturesTests.swift#MicrocodeSignaturesTests.testTheRepositorysTableIsRead
  it("reads the repository's table: the Alder Lake / Raptor Lake S update 0x3E serves six CPUIDs", () => {
    expect(new Set(currentMicrocodeSignatures().sharing("B06F5"))).toEqual(
      new Set(["90672", "90675", "B06F2", "B06F6", "B06F7"])
    );
    const [group] = processorGroups([0xb06f5]);
    expect(new Set(group?.sharesMicrocodeWith)).toEqual(
      new Set(["90672", "90675", "B06F2", "B06F6", "B06F7"])
    );
  });
});
