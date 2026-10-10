import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, member } from "@/core/agent/json";
import * as Test from "@/firmware/testing/testImage";
import { isSecretName, judge, regionScan } from "@/tools/uefi/agent/uefiAgentRegions";
import { agentTreeOver } from "@/tools/uefi/agent/uefiAgentTree";

/**
 * How `region_scan` judges a nameless area by its bytes, and which areas it keeps quiet about.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAgentRegionsTests.swift#UEFIAgentRegionsTests
 */

const utf16 = (text: string): number[] => [...text].flatMap((one) => [one.charCodeAt(0), 0]);

describe("region_scan", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAgentRegionsTests.swift#UEFIAgentRegionsTests.testAnAreaOfFillIsEmptyAndSaysWhereItsOtherBytesAre
  it("calls an area of fill empty and says where its other bytes are", () => {
    const bytes = new Uint8Array(0x1000).fill(0xff);
    bytes.set(
      Array.from("$DMI", (one) => one.charCodeAt(0)),
      0
    );
    const judged = judge(bytes, 0x6cf000);
    expect(judged.kind).toBe("empty");
    expect(judged.firstNonFill).toBe(0x6cf000);
    expect(judged.lastNonFill).toBe(0x6cf003);
    expect(judged.strings.map((one) => one.text)).toEqual(["$DMI"]);
    expect(judge(new Uint8Array(64), 0).firstNonFill).toBeUndefined();
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAgentRegionsTests.swift#UEFIAgentRegionsTests.testStringsAmongZerosAreText
  it("calls strings among zeros text", () => {
    const bytes = new Uint8Array(0x200);
    bytes.set(
      Array.from("Board Name", (one) => one.charCodeAt(0)),
      0x10
    );
    bytes.set(utf16("Model 1234").slice(0, 16), 0x40);
    bytes[0x80] = 0x12;
    const judged = judge(bytes, 0x1000);
    expect(judged.kind).toBe("text");
    expect(judged.strings.map((one) => one.text)).toEqual(["Board Name", "Model 12"]);
    expect(judged.strings.map((one) => one.utf16)).toEqual([false, true]);
    expect(judged.strings[0]?.offset).toBe(0x1010);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAgentRegionsTests.swift#UEFIAgentRegionsTests.testCompiledX86IsCodeAndNoiseIsData
  it("calls compiled x86 code and noise data", () => {
    // Moves, a stack adjustment and calls, as a compiler lays them out.
    const block = [
      0x48, 0x89, 0x5c, 0x24, 0x08, 0x48, 0x83, 0xec, 0x20, 0x48, 0x8b, 0xd9, 0xe8, 0x10, 0x20,
      0x00, 0x00, 0x48, 0x8b, 0xc3, 0x48, 0x83, 0xc4, 0x20, 0x5b, 0xc3,
    ];
    const code = Uint8Array.from(Array.from({ length: 64 }, () => block).flat());
    expect(judge(code, 0).kind).toBe("code");
    const pe = new Uint8Array(0x202).fill(0x11);
    pe.set([0x4d, 0x5a], 0);
    expect(judge(pe, 0).kind).toBe("code");
    let seed = 12345;
    const noise = Uint8Array.from({ length: 0x2000 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return 1 + (seed % 0xfe);
    });
    expect(judge(noise, 0).kind).toBe("data");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAgentRegionsTests.swift#UEFIAgentRegionsTests.testAreasNamedForASecretAreKnownByAWordOfTheirName
  it("knows an area named for a secret by a word of its name", () => {
    for (const name of ["MSDM Table", "Password", "OEM Key", "keys"]) {
      expect(isSecretName(name), name).toBe(true);
    }
    for (const name of ["Keyboard Layout", "Unused", "SMBIOS Update", "Passwordless"]) {
      expect(isSecretName(name), name).toBe(false);
    }
  });

  it("lists the padding of an image with its judgement and never its bytes", () => {
    const image = Test.image({
      before: 0x400,
      volume: Test.volume({ files: [Test.file({ body: new Uint8Array(24).fill(0xa5) })] }),
      after: 0x200,
    });
    image.set(
      Array.from("SERIAL-1234", (one) => one.charCodeAt(0)),
      0x10
    );
    const answer = regionScan(
      agentTreeOver(image),
      new AgentArguments({ kinds: ["Padding"], min_size: 0x100 }),
      { contentVersion: 1 }
    );
    const nodes = member(answer, "nodes") as Json[];
    expect(nodes.length).toBeGreaterThan(0);
    const first = nodes[0];
    expect(member(first, "start")).toBe("0x0");
    expect(member(first, "class")).toBe("text");
    expect((member(first, "strings") as Json[]).map((one) => member(one, "text"))).toEqual([
      "SERIAL-1234",
    ]);
    expect(member(first, "node")).toBeDefined();
    expect(member(first, "id")).toBeUndefined();
    expect(member(answer, "total")).toBe(nodes.length);
  });
});
