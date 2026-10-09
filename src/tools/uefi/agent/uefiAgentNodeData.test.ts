import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, member } from "@/core/agent/json";
import * as Test from "@/firmware/testing/testImage";
import { uefiNodeData } from "@/tools/uefi/agent/uefiAgentNodeData";
import { uefiFind } from "@/tools/uefi/agent/uefiAgentQueries";
import { agentTreeOver } from "@/tools/uefi/agent/uefiAgentTree";

/**
 * A node's own bytes for an agent.
 *
 * @web-only upstream tests node bytes through the app's tools (`AgentFirmwareToolsTests`); here the pure reading is tested alone
 */

const args = (values: { [key: string]: Json } = {}) => new AgentArguments(values);

const BODY = Uint8Array.from({ length: 24 }, (_, index) => 0xa0 + index);

function fixture() {
  const raw = Test.file({ body: BODY });
  return agentTreeOver(
    Test.image({ before: 0x20, volume: Test.volume({ files: [raw] }), after: 0x10 })
  );
}

const rawFileId = (tree: ReturnType<typeof fixture>) =>
  member(
    (member(uefiFind(tree, args({ type: "File" }), { contentVersion: 1 }), "matches") as Json[])[0],
    "id"
  ) as string;

describe("uefi_node_data", () => {
  it("reads a node's body at offsets inside it, and says where the body is in the file", () => {
    const tree = fixture();
    const node = rawFileId(tree);
    const answer = uefiNodeData(tree, args({ node, length: 8, format: "u8" }));
    expect(member(answer, "values")).toEqual([
      "0xA0",
      "0xA1",
      "0xA2",
      "0xA3",
      "0xA4",
      "0xA5",
      "0xA6",
      "0xA7",
    ]);
    expect(member(answer, "size")).toBe("0x18");
    expect(member(answer, "in_compressed")).toBe(false);
    expect(typeof member(answer, "file_start")).toBe("string");
    const later = uefiNodeData(tree, args({ node, offset: 0x10, length: 100, format: "u8" }));
    expect((member(later, "values") as Json[]).length).toBe(8);
    expect(member(later, "cut_at_end_of_part")).toBe(true);
  });

  it("reads the header and the whole node as parts, and refuses a part the node lacks", () => {
    const tree = fixture();
    const node = rawFileId(tree);
    expect(member(uefiNodeData(tree, args({ node, part: "header", length: 16 })), "part")).toBe(
      "header"
    );
    const all = uefiNodeData(tree, args({ node, part: "all", length: 4 }));
    expect(member(all, "size")).toBe("0x30");
    expect(() => uefiNodeData(tree, args({ node, part: "decompressed" }))).toThrow(
      /not a compressed section/
    );
  });

  it("refuses a node that is not there, an offset past the part, and a read that is too long", () => {
    const tree = fixture();
    const node = rawFileId(tree);
    expect(() => uefiNodeData(tree, args({ node: "5.5.5" }))).toThrow(/No node 5.5.5/);
    expect(() => uefiNodeData(tree, args({ node, offset: 0x100 }))).toThrow(
      /past the end of the body/
    );
    expect(() => uefiNodeData(tree, args({ node, length: 5000 }))).toThrow(/at most 4096/);
    expect(() => uefiNodeData(tree, args({ node: "root" }))).toThrow(/not a node/);
  });
});
