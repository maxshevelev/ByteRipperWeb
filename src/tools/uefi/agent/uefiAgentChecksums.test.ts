import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { AgentToolError } from "@/core/agent/agentTool";
import { type Json, member } from "@/core/agent/json";
import * as Test from "@/firmware/testing/testImage";
import { fixChecksumAnswer, uefiChecksums } from "@/tools/uefi/agent/uefiAgentChecksums";
import { agentTreeOver } from "@/tools/uefi/agent/uefiAgentTree";

/**
 * Every UEFI checksum checked at once, and every wrong one put right at once.
 *
 * @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests
 */

const args = (values: { [key: string]: Json } = {}) => new AgentArguments(values);
const context = { contentVersion: 1 };

function good(): Uint8Array {
  return Test.image({
    volume: Test.volume({ files: [Test.file({ body: new Uint8Array(24).fill(0x5a) })] }),
  });
}

/** The writes an answer asks for, laid over `bytes`. */
function applied(bytes: Uint8Array, answer: Json): Uint8Array {
  const result = Uint8Array.from(bytes);
  for (const write of member(answer, "writes") as Json[]) {
    const offset = member(write, "offset") as number;
    const values = (member(write, "bytes") as string)
      .split(" ")
      .map((one) => Number.parseInt(one, 16));
    result.set(values, offset);
  }
  return result;
}

describe("uefi_checksums", () => {
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testEveryWrongChecksumIsListedAndFixedAtOnce
  it("lists every wrong checksum with what is stored and what it should be", () => {
    const original = good();
    const corrupt = Uint8Array.from(original);
    corrupt[0x32] = (corrupt[0x32] ?? 0) ^ 0xff; // the volume's header checksum
    const tree = agentTreeOver(corrupt);
    const checked = uefiChecksums(tree, args(), context);
    expect(member(checked, "wrong")).toBe(1);
    expect(member(checked, "fixable")).toBe(1);
    const volume = ((member(checked, "nodes") as Json[])[0] as Json) ?? null;
    const first = (member(volume, "checksums") as Json[])[0] as Json;
    expect(member(first, "field")).toBe("volume");
    expect(member(first, "at")).toBe("0x32");
    const should = [original[0x32], original[0x33]]
      .map((one) => (one as number).toString(16).toUpperCase().padStart(2, "0"))
      .join(" ");
    expect(member(first, "should_be")).toBe(should);
  });

  it("is quiet about an image whose checksums check out", () => {
    const checked = uefiChecksums(agentTreeOver(good()), args(), context);
    expect(member(checked, "wrong")).toBe(0);
    expect(member(checked, "nodes")).toEqual([]);
    expect(member(checked, "checked")).toBeGreaterThan(0);
  });
});

describe("uefi_fix_checksum", () => {
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testEveryWrongChecksumIsListedAndFixedAtOnce
  it("with all puts every wrong checksum right in one answer, and only the checksums move", () => {
    const original = good();
    const corrupt = Uint8Array.from(original);
    corrupt[0x32] = (corrupt[0x32] ?? 0) ^ 0xff; // the volume's header checksum
    // The volume's header is 0x48 long and its first file starts right after it.
    const fileStart = 0x48;
    corrupt[fileStart + 0x10] = (corrupt[fileStart + 0x10] ?? 0) ^ 0x01; // the file's header checksum

    const answer = fixChecksumAnswer(agentTreeOver(corrupt), args({ all: true }));
    expect((member(answer, "fixed") as Json[]).length).toBe(2);
    expect(member(answer, "skipped_compressed")).toBe(0);
    const after = applied(corrupt, answer);
    const moved = [...after.keys()].filter((at) => after[at] !== corrupt[at]);
    expect(moved.every((at) => at === 0x32 || at === 0x33 || at === fileStart + 0x10)).toBe(true);
    expect([...after.slice(0x32, 0x34)]).toEqual([...original.slice(0x32, 0x34)]);

    const clean = uefiChecksums(agentTreeOver(after), args(), context);
    expect(member(clean, "wrong")).toBe(0);
    expect(() => fixChecksumAnswer(agentTreeOver(after), args({ all: true }))).toThrow(
      "Every checksum checks out; nothing to write."
    );
  });

  it("wants a node, or all", () => {
    expect(() => fixChecksumAnswer(agentTreeOver(good()), args())).toThrow(AgentToolError);
    expect(() => fixChecksumAnswer(agentTreeOver(good()), args({ node: "0" }))).toThrow(
      "The checksums of 0 already check out; nothing to write."
    );
  });
});
