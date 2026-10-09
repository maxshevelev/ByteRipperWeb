import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, member } from "@/core/agent/json";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import { type FITReport, readFitTable } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import { fitImage, fitMicrocode } from "@/firmware/testing/testFit";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { catalogueAnswer, chosenEntries, fitTableAnswer } from "@/tools/fit/agent/fitAgentAnswers";
import { entryAt, type MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";

/**
 * The FIT panel's answers to an agent.
 *
 * @upstream ByteRipperTests/AgentFirmwareToolsTests.swift#AgentFirmwareToolsTests
 */

const MICROCODE = 0x2000;

function report(options: { checksum?: number; revision?: number } = {}): FITReport {
  const bytes = fitImage({
    rows: [{ type: FIT.microcodeType, target: MICROCODE }],
    ...(options.checksum === undefined ? {} : { checksum: options.checksum }),
    addressDiff: 0xffff_0000,
    contents: new Map([
      [
        MICROCODE,
        fitMicrocode({
          signature: 0x0008_06ea,
          revision: options.revision ?? 0xf0,
          totalSize: 0x180,
          platformIDs: 1,
        }),
      ],
    ]),
  });
  const image = new UEFIImage({ size: 0x1_0000, roots: [], addressDiff: 0xffff_0000 });
  return readFitTable(new ImageReader(sourceOver(bytes)), image);
}

const catalogue = (...paths: string[]): MicrocodeCatalogueEntry[] =>
  paths.flatMap((path) => {
    const entry = entryAt(path, 0x180);
    return entry === undefined ? [] : [entry];
  });

describe("fit_table", () => {
  // @upstream ByteRipperTests/AgentFirmwareToolsTests.swift#AgentFirmwareToolsTests.testTheFITTableIsReadWithItsMicrocode
  it("reads the table with its rows and its microcode", () => {
    const answer = fitTableAnswer(report(), new AgentArguments({}));
    expect(member(answer, "summary")).toBe("FIT at 0x1000 · 2 entries · checksum 0x5C");
    expect(member(member(answer, "table"), "start")).toBe("0x1000");
    const rows = member(answer, "rows") as Json[];
    expect(rows).toHaveLength(2);
    expect(member(rows[1], "type")).toMatch(/icrocode/);
    expect(member(rows[1], "cpuids")).toEqual(["806EA"]);
    expect(member(answer, "problems")).toEqual([]);
  });

  // @upstream ByteRipperTests/AgentFirmwareToolsTests.swift#AgentFirmwareToolsTests.testAWrongChecksumIsAProblem
  it("says a wrong checksum is a problem, with what it should be", () => {
    const answer = fitTableAnswer(report({ checksum: 0xcc }), new AgentArguments({}));
    const problems = member(answer, "problems") as Json[];
    expect(problems.length).toBeGreaterThan(0);
    expect(member(problems[0], "severity")).toBe("error");
    expect(member(member(answer, "table"), "checksum")).toBe("0xCC");
    expect(member(member(answer, "table"), "checksum_should_be")).toBe("0x5C");
  });

  it("gives one row in full with `entry`, and refuses one past the end", () => {
    const answer = fitTableAnswer(report(), new AgentArguments({ entry: 1 }));
    const entry = member(answer, "entry");
    expect((member(entry, "fields") as Json[]).length).toBeGreaterThan(0);
    expect(() => fitTableAnswer(report(), new AgentArguments({ entry: 9 }))).toThrow(
      "The table has no row 9; its rows are 0 to 1."
    );
  });

  // @upstream ByteRipperTests/AgentFirmwareToolsTests.swift#AgentFirmwareToolsTests.testAFileWithNoFITSaysSo
  it("lists the places a signature was found when the pointer lost the table", () => {
    const bytes = fitImage({
      rows: [{ type: FIT.microcodeType, target: MICROCODE }],
      pointerAddress: 0xffff_5000,
      addressDiff: 0xffff_0000,
      contents: new Map([[MICROCODE, fitMicrocode({ totalSize: 0x180 })]]),
    });
    const lost = readFitTable(
      new ImageReader(sourceOver(bytes)),
      new UEFIImage({ size: 0x1_0000, roots: [], addressDiff: 0xffff_0000 })
    );
    const answer = fitTableAnswer(lost, new AgentArguments({}));
    expect(member(answer, "tables_found_elsewhere")).toEqual(["0x1000"]);
    expect(member(answer, "table")).toBeUndefined();
  });
});

describe("microcode_catalogue", () => {
  const files = catalogue(
    "Intel/cpu806EA_plat01_ver000000F8_2020-01-01_PRD_AAAA0000.bin",
    "Intel/cpu806EA_plat01_ver000000F0_2019-01-01_PRD_BBBB0000.bin",
    "Intel/cpu906E9_plat2A_ver000000A0_2018-01-01_PRE_CCCC0000.bin"
  );

  it("lists the Intel files, by CPUID then platform, newest first", () => {
    const answer = catalogueAnswer(files, undefined, 1, new AgentArguments({}));
    expect(member(answer, "total")).toBe(3);
    const listed = (member(answer, "files") as Json[]).map((one) => member(one, "revision"));
    expect(listed).toEqual(["0xF8", "0xF0", "0xA0"]);
  });

  it("narrows by CPUID prefix, production and the newest of each", () => {
    expect(
      chosenEntries(files, "806", undefined, false, false).map((one) => one.revisionText)
    ).toEqual(["F8", "F0"]);
    expect(chosenEntries(files, undefined, undefined, true, false)).toHaveLength(2);
    expect(chosenEntries(files, undefined, undefined, false, true)).toHaveLength(2);
  });

  it("says how the image stands against it, and which files serve which rows", () => {
    const answer = catalogueAnswer(files, report(), 1, new AgentArguments({ in_image: true }));
    const installed = member(answer, "installed") as Json[];
    expect(member(installed[0], "catalogue")).toBe("outdated");
    expect(member(installed[0], "newest_revision")).toBe("0xF8");
    expect(member(answer, "total")).toBe(2);
    const first = (member(answer, "files") as Json[])[0];
    expect(member(first, "serves_rows")).toEqual([1]);
    expect(member(first, "newer_than_installed")).toBe(true);
  });

  it("needs a table for `in_image`", () => {
    const empty = readFitTable(new ImageReader(sourceOver(new Uint8Array(0x100))));
    expect(() => catalogueAnswer(files, empty, 1, new AgentArguments({ in_image: true }))).toThrow(
      "There is no FIT table here; `fit_table` says what was found."
    );
  });
});
