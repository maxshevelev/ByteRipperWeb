import { describe, expect, it, vi } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { answerText } from "@/core/agent/agentTool";
import { guidFromText, guidKey } from "@/firmware/uefi/efiGuid";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import type { ToolReadHost } from "@/tools/toolAgent";
import {
  agentGuids,
  uefiAgentActions,
  uefiAgentComparisons,
  uefiAgentQueries,
} from "@/tools/uefi/agent/uefiAgentModule";

const asked: unknown[] = [];
const DRIVER = "8964FEDC-6FE7-4E1E-A55E-FF821D71FFCF";

vi.mock("@/state/firmwareReady", () => ({ readyFirmware: async () => undefined }));

vi.mock("@/state/firmwareStore", () => ({
  askUefiAgent: async (_pane: string, request: { query: string }) => {
    asked.push(request);
    return request.query === "variable_rows"
      ? { kind: "agentUefi", id: 1, rows: [] }
      : request.query === "uefi_node"
        ? {
            kind: "agentUefi",
            id: 1,
            answer: {
              node: { id: "0.0", type: "File", name: "Driver", guid: DRIVER },
              title: "Driver",
              fields: [
                { label: "Type", value: "Driver" },
                { label: "GUID", value: DRIVER },
              ],
            },
          }
        : request.query === "uefi_at"
          ? { kind: "agentUefi", id: 1, error: "Offset 0x10 is past the end." }
          : { kind: "agentUefi", id: 1, answer: { asked: request.query } };
  },
}));

const guidKeyOf = (text: string): string =>
  guidKey(guidFromText(text) as NonNullable<ReturnType<typeof guidFromText>>);

const host: ToolReadHost = {
  pane: "a",
  fileName: "x.bin",
  contentSize: 16,
  read: async () => new Uint8Array(),
  contentVersion: 3,
};

describe("the UEFI module's agent surface", () => {
  it("names the queries, the comparison and the actions", () => {
    expect(uefiAgentQueries.map((one) => one.name)).toEqual([
      "uefi_tree",
      "uefi_node",
      "uefi_find",
      "uefi_at",
      "uefi_checksums",
      "region_scan",
      "uefi_node_data",
      "variables",
    ]);
    expect(uefiAgentComparisons.map((one) => one.name)).toEqual(["variables_compare"]);
    expect(uefiAgentActions.map((one) => one.name)).toEqual(["uefi_select", "uefi_selection"]);
  });

  it("asks the worker that holds the tree, with the content's version", async () => {
    const tree = uefiAgentQueries[0];
    const answer = await tree?.run(host, new AgentArguments({}));
    expect(answer === undefined ? "" : answerText(answer)).toContain("uefi_tree");
    expect(asked.at(-1)).toMatchObject({ query: "uefi_tree", contentVersion: 3 });
  });

  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testTheNodeIsNamedByTheGUIDCatalogueAsInThePanel
  it("names a file by the GUID catalogue, after its GUID, as the panel's detail does", async () => {
    const node = uefiAgentQueries.find((one) => one.name === "uefi_node");
    const held = agentGuids.source;
    try {
      agentGuids.source = {
        load: async () => new GuidsCatalogue(new Map([[guidKeyOf(DRIVER), "CatalogueDriver"]])),
        changes: () => () => undefined,
        freshness: () => undefined,
        markStale: () => undefined,
      };
      const answer = await node?.run(host, new AgentArguments({ node: "0.0" }));
      const fields = JSON.parse(answer === undefined ? "{}" : answerText(answer)).fields;
      expect(fields.map((one: { label: string }) => one.label)).toEqual([
        "Type",
        "GUID",
        "Name in the catalogue",
      ]);
      expect(fields[2].value).toBe("CatalogueDriver");
    } finally {
      agentGuids.source = held;
    }
  });

  it("gives the worker's refusal as the tool's", async () => {
    const at = uefiAgentQueries.find((one) => one.name === "uefi_at");
    await expect(at?.run(host, new AgentArguments({ offset: 16 }))).rejects.toThrow(/past the end/);
  });

  it("reads variables as rows the page filters", async () => {
    const variables = uefiAgentQueries.find((one) => one.name === "variables");
    const answer = await variables?.run(host, new AgentArguments({}));
    expect(answer === undefined ? "" : answerText(answer)).toContain("total");
  });

  it("refuses a node id that is not an index path", async () => {
    const select = uefiAgentActions[0];
    await expect(
      select?.run({ select: async () => ({}) }, new AgentArguments({ node: "volume" }))
    ).rejects.toThrow(/not a node id/);
  });
});
