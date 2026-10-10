import { describe, expect, it } from "vitest";
import { kindTitle, sectionsOf } from "@/core/agent/agentToolCatalogue";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import { AgentService } from "@/state/agent/agentService";
import { toolDetailFields, toolText } from "@/ui/agent/AgentToolsPage";

/**
 * The Tools page of the Agent window: every tool listed, in a section to each group, classed, with
 * what it has been used for; the details give the tool as the agent reads it.
 *
 * @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheToolsPageListsEveryToolWithItsUseAndWhatTheAgentReads
 */

async function call(service: AgentService, name: string): Promise<void> {
  const written: Json[] = [];
  const connection = service.connect((line) => written.push(parseJson(decodeUtf8(line))));
  connection.receive(
    encodeUtf8(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } })}\n`
    )
  );
  await connection.waitUntilIdle();
  expect(member(written[0], "result")).toBeDefined();
}

describe("the Tools page", () => {
  it("lists every tool the agent is offered, a section to each group, once", () => {
    const service = new AgentService(undefined);
    const entries = service.catalogue();
    expect(entries.map((one) => one.tool.name)).toEqual(
      service.server.tools.map((one) => one.name)
    );
    const sections = sectionsOf(entries);
    expect(sections[0]?.title).toBe("Files and View");
    const titles = sections.map((one) => one.title);
    expect(titles).toContain("UEFI Structure");
    expect(new Set(titles).size).toBe(titles.length);
    expect(sections.reduce((sum, one) => sum + one.entries.length, 0)).toBe(entries.length);
  });

  it("classes a tool by what it does", () => {
    const entries = new Map(
      new AgentService(undefined).catalogue().map((one) => [one.tool.name, one])
    );
    expect(entries.get("read")?.kind).toBe("read");
    expect(entries.get("reveal")?.kind).toBe("screen");
    expect(entries.get("write")?.kind).toBe("edit");
    expect(entries.get("copy_to_other_pane")?.kind).toBe("edit");
    expect(entries.get("refs")?.group.title()).toBe("Search");
    const fix = entries.get("uefi_fix_checksum");
    expect(fix?.group.title()).toBe("UEFI Structure");
    expect(fix?.kind).toBe("edit");
    expect(kindTitle("edit")).toBe("Edits a File");
  });

  it("counts the calls since the app started, apart from the log, and resets them", async () => {
    const service = new AgentService(undefined);
    await call(service, "documents");
    await call(service, "read"); // no file is open: refused
    await call(service, "read");
    const stats = service.store.getSnapshot().toolStats;
    expect(stats.read?.calls).toBe(2);
    expect(stats.read?.failures).toBe(2);
    expect(stats.documents?.failures).toBe(0);
    const read = service.catalogue().find((one) => one.tool.name === "read");
    if (read === undefined) throw new Error("no read");
    expect(toolText(read, "calls", stats.read)).toBe("2");
    expect(toolText(read, "failures", stats.read)).toBe("2");
    const write = service.catalogue().find((one) => one.tool.name === "write");
    if (write === undefined) throw new Error("no write");
    expect(toolText(write, "calls", stats.write)).toBe("");
    expect(toolDetailFields(write, undefined).at(-1)).toEqual({
      label: "Calls",
      value: "None yet",
      isProblem: false,
    });

    service.resetToolStats();
    expect(service.store.getSnapshot().toolStats).toEqual({});
  });
});
