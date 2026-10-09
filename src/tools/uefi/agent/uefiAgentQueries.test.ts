import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { AgentToolError } from "@/core/agent/agentTool";
import { type Json, member } from "@/core/agent/json";
import * as Test from "@/firmware/testing/testImage";
import { guid } from "@/firmware/uefi/efiGuid";
import {
  runUefiAgentQuery,
  type UefiAgentQueryName,
  uefiAt,
  uefiFind,
  uefiNode,
  uefiTree,
} from "@/tools/uefi/agent/uefiAgentQueries";
import { agentTreeOver } from "@/tools/uefi/agent/uefiAgentTree";

/**
 * What the UEFI Structure answers an agent from the bytes alone.
 *
 * @web-only upstream tests the queries through the app's tools (`AgentFirmwareToolsTests`); here the pure queries are tested alone
 */

const SETUP = guid("899407D7-99FE-43D8-9A21-79EC328CAC21");

/** An image: one volume holding a raw file with a name, and a driver with a UI section. */
function fixture() {
  const named = Test.sectionedFile({
    guid: SETUP,
    type: 7,
    sections: [Test.nameSection("Setup")],
  });
  const raw = Test.file({ body: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) });
  return Test.image({ before: 0x100, volume: Test.volume({ files: [raw, named] }), after: 0x40 });
}

const args = (values: { [key: string]: Json } = {}) => new AgentArguments(values);
const context = { contentVersion: 1 };
const ids = (list: Json | undefined) => (list as Json[]).map((one) => member(one, "id"));

describe("uefi_tree", () => {
  it("gives the image's summary and the top of the tree", () => {
    const tree = agentTreeOver(fixture());
    const answer = uefiTree(tree, args(), context);
    expect(typeof member(answer, "image")).toBe("string");
    const children = member(answer, "children") as Json[];
    expect(children.length).toBeGreaterThan(0);
    expect(member(answer, "total")).toBe(children.length);
    expect(member(answer, "next")).toBeNull();
    expect(typeof member(children[0], "type")).toBe("string");
  });

  it("opens a container when asked for it, and goes down with depth", () => {
    const tree = agentTreeOver(fixture());
    const top = uefiTree(tree, args(), context);
    const first = (member(top, "children") as Json[])[0];
    const id = member(first, "id") as string;
    const down = uefiTree(tree, args({ node: id, depth: 2 }), context);
    expect(member(member(down, "node"), "id")).toBe(id);
    const children = member(down, "children") as Json[];
    expect(children.length).toBeGreaterThan(0);
    expect(children.some((child) => member(child, "below") !== undefined)).toBe(true);
  });

  it("refuses an id that names nothing", () => {
    const tree = agentTreeOver(fixture());
    expect(() => uefiTree(tree, args({ node: "9.9" }), context)).toThrow(AgentToolError);
    expect(() => uefiTree(tree, args({ node: "x" }), context)).toThrow(/is not a node id/);
  });

  it("pages with a cursor that a changed content refuses", () => {
    const tree = agentTreeOver(fixture());
    const volumeId = ids(member(uefiTree(tree, args(), context), "children"))[0] as string;
    const page = uefiTree(tree, args({ node: volumeId, limit: 1 }), context);
    const next = member(page, "next") as string;
    expect(typeof next).toBe("string");
    expect((member(page, "children") as Json[]).length).toBe(1);
    const second = uefiTree(tree, args({ node: volumeId, limit: 1, after: next }), context);
    expect((member(second, "children") as Json[]).length).toBe(1);
    expect(() =>
      uefiTree(tree, args({ node: volumeId, limit: 1, after: next }), { contentVersion: 2 })
    ).toThrow(/changed since that page/);
  });
});

describe("uefi_node", () => {
  it("gives the node's fields, tables and the path of names down to it", () => {
    const tree = agentTreeOver(fixture());
    const found = uefiFind(tree, args({ type: "File" }), context);
    const file = (member(found, "matches") as Json[])[0];
    const answer = uefiNode(tree, args({ node: member(file, "id") as string }));
    expect(member(member(answer, "node"), "id")).toBe(member(file, "id"));
    expect((member(answer, "fields") as Json[]).length).toBeGreaterThan(0);
    expect((member(answer, "path") as Json[]).length).toBeGreaterThan(1);
    expect(typeof member(answer, "title")).toBe("string");
  });

  it("refuses the top and an unknown node", () => {
    const tree = agentTreeOver(fixture());
    expect(() => uefiNode(tree, args({ node: "root" }))).toThrow(/not a node/);
    expect(() => uefiNode(tree, args({ node: "7.7.7" }))).toThrow(/No node 7.7.7/);
  });
});

describe("uefi_find", () => {
  it("finds a file by the name its Name section gives it, whole or in part, any case", () => {
    const tree = agentTreeOver(fixture());
    const part = uefiFind(tree, args({ name: "SET" }), context);
    expect((member(part, "matches") as Json[]).some((one) => member(one, "name") === "Setup")).toBe(
      true
    );
    const exact = uefiFind(tree, args({ name: "setup", exact: true }), context);
    expect(member(exact, "total")).toBeGreaterThanOrEqual(1);
    expect(member(uefiFind(tree, args({ name: "Set", exact: true }), context), "total")).toBe(0);
  });

  it("finds by GUID and by type, and wants at least one of the three", () => {
    const tree = agentTreeOver(fixture());
    expect(
      member(
        uefiFind(tree, args({ guid: "899407d7-99fe-43d8-9a21-79ec328cac21" }), context),
        "total"
      )
    ).toBe(1);
    expect(member(uefiFind(tree, args({ type: "volume" }), context), "total")).toBe(1);
    expect(() => uefiFind(tree, args(), context)).toThrow(/Give at least one/);
  });
});

describe("uefi_at", () => {
  it("gives the chain of nodes holding a byte, outermost first", () => {
    const bytes = fixture();
    const tree = agentTreeOver(bytes);
    const answer = uefiAt(tree, args({ offset: 0x100 + 0x60 }));
    const chain = member(answer, "chain") as Json[];
    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain.map((one) => member(one, "type"))).toContain("Volume");
    expect(member(chain[0], "type")).toBe("Image");
    expect(member(answer, "offset")).toBe("0x160");
  });

  it("is refused past the end of the file, and ends at the padding for a byte in it", () => {
    const bytes = fixture();
    const tree = agentTreeOver(bytes);
    expect(() => uefiAt(tree, args({ offset: bytes.length }))).toThrow(/past the end/);
    const padded = member(uefiAt(tree, args({ offset: 0 })), "chain") as Json[];
    expect(padded.at(-1) === undefined ? "" : member(padded.at(-1), "type")).toBe("Padding");
  });
});

describe("the worker's entry", () => {
  it("runs a query by name", () => {
    const tree = agentTreeOver(fixture());
    const names: UefiAgentQueryName[] = ["uefi_tree", "uefi_find"];
    expect(
      names.map(
        (name) =>
          typeof runUefiAgentQuery(
            name,
            tree,
            args(name === "uefi_find" ? { type: "File" } : {}),
            context
          )
      )
    ).toEqual(["object", "object"]);
  });
});
