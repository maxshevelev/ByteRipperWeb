import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jsonAnswer, textAnswer } from "@/core/agent/agentTool";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import { AgentService } from "@/state/agent/agentService";
import { registerAgentSession, resetAgentSessions } from "@/state/agent/agentSessions";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { forgetCaretOnScreen, navigationHistory } from "@/state/navigationStore";
import { activate, sessionOn, toolController } from "@/state/toolController";
import { openInPane, workspaceStore } from "@/state/workspaceStore";
import { fitTool } from "@/tools/fit/fitTool";
import type { ToolModule } from "@/tools/toolModule";
import { type LinkedScroller, scrollLink } from "@/ui/pane/scrollLink";

/**
 * The tools the modules contribute, as the app lists and runs them.
 *
 * @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests
 */

/** The FIT module — a real identifier, which `open_panel` activates — with agent tools of the test's own. */
const module: ToolModule = {
  ...fitTool,
  agentQueries: [
    {
      name: "fit_probe",
      title: "Probe",
      description: "Answers with the file's name and size.",
      properties: { depth: { type: "integer" } },
      run: async (host) => jsonAnswer({ name: host.fileName, size: host.contentSize }),
    },
    {
      name: "fit_words",
      title: "Words",
      description: "A sentence.",
      run: async () => textAnswer("plain"),
    },
  ],
  agentComparisons: [
    {
      name: "fit_pair",
      title: "Pair",
      description: "Two names.",
      run: async (host, against) => jsonAnswer({ a: host.fileName, b: against.fileName }),
    },
  ],
  agentActions: [
    {
      name: "fit_poke",
      title: "Poke",
      description: "Acts on the live panel.",
      changesView: true,
      run: async (session) => jsonAnswer({ poked: (session as { id: number }).id }),
    },
  ],
};

const leave: (() => void)[] = [];
const ROW = 16;

function open(pane: "a" | "b", size: number, name: string) {
  openInPane(pane, { name, size, lastModified: 0, source: new Blob([new Uint8Array(size)]) });
  const view: LinkedScroller = {
    rowHeight: () => ROW,
    position: () => ({ top: 0, left: 0 }),
    extent: () => ({ maxTop: 1000, maxLeft: 0, viewportHeight: 4 * ROW }),
    moveTo: () => undefined,
  };
  leave.push(scrollLink.register(pane, view));
}

async function call(service: AgentService, name: string, args: { [key: string]: Json } = {}) {
  const written: Json[] = [];
  const connection = service.connect((line) => written.push(parseJson(decodeUtf8(line))));
  connection.receive(
    encodeUtf8(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })}\n`
    )
  );
  await connection.waitUntilIdle();
  const result = member(written[0], "result");
  const text = member((member(result, "content") as Json[])[0], "text") as string;
  const isError = member(result, "isError") === true;
  let json: Json | undefined;
  try {
    json = isError ? undefined : (parseJson(text) as Json);
  } catch {
    json = undefined;
  }
  return { isError, text, json };
}

beforeEach(() => {
  navigationHistory.removeAll();
});

afterEach(() => {
  while (leave.length > 0) leave.pop()?.();
  activate(undefined, "panes");
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
  scrollLink.forget("a");
  scrollLink.forget("b");
  forgetCaretOnScreen("a");
  forgetCaretOnScreen("b");
  resetAgentSessions();
  agentShell.bringForward = undefined;
  agentShell.busy = undefined;
});

describe("the module tools", () => {
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testTheToolsAreListedInAFixedOrder
  it("are listed queries first, then comparisons, edits, actions and open_panel, whatever is open", () => {
    const service = new AgentService(undefined, () => [module]);
    const names = service.allTools().map((tool) => tool.name);
    expect(names).toEqual([
      "documents",
      "focus",
      "read",
      "reveal",
      "mark",
      "unmark",
      "marks",
      "open_dump",
      "close_dump",
      "show",
      "survey",
      "finding",
      "findings",
      "diff",
      "compare",
      "reveal_diff",
      "find_bytes",
      "open_part",
      "write",
      "fit_probe",
      "fit_words",
      "fit_pair",
      "fit_fix_checksum",
      "fit_add_microcode",
      "fit_replace_microcode",
      "fit_remove_microcode",
      "fit_poke",
      "open_panel",
    ]);
    open("a", 0x40, "one.bin");
    expect(service.allTools().map((tool) => tool.name)).toEqual(names);
  });

  it("add the document argument to a query's own, and its id to the answer", async () => {
    const service = new AgentService(undefined, () => [module]);
    open("a", 0x40, "one.bin");
    const tool = service.allTools().find((one) => one.name === "fit_probe");
    const properties = member(tool?.inputSchema, "properties") as { [key: string]: Json };
    expect(Object.keys(properties).sort()).toEqual(["depth", "document"]);
    const answer = await call(service, "fit_probe");
    expect(answer.json).toEqual({ name: "one.bin", size: 0x40, document: "d1" });
    expect((await call(service, "fit_words")).text).toBe("plain");
  });

  it("run a comparison over two documents, and refuse one document against itself", async () => {
    const service = new AgentService(undefined, () => [module]);
    open("a", 0x40, "one.bin");
    open("b", 0x20, "two.bin");
    const documents = ((await call(service, "documents")).json as { documents: Json[] }).documents;
    const [first, second] = documents.map((one) => member(one, "id") as string);
    const answer = await call(service, "fit_pair", {
      document: first as string,
      against: second as string,
    });
    expect(answer.json).toEqual({ a: "one.bin", b: "two.bin", document: first, against: second });
    expect(
      (await call(service, "fit_pair", { document: first as string, against: first as string }))
        .text
    ).toMatch(/are the same document/);
    expect((await call(service, "fit_pair")).text).toBe("Argument `against` is required.");
  });
});

describe("a panel action", () => {
  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testAnActionWithThePanelClosedNamesOpenPanel
  it("says the panel is not open and names open_panel when it is not", async () => {
    const service = new AgentService(undefined, () => [module]);
    open("a", 0x40, "one.bin");
    const refusal = await call(service, "fit_poke");
    expect(refusal.isError).toBe(true);
    expect(refusal.text).toMatch(/panel is not open on d1\. Call `open_panel` with module "fit"/);
  });

  it("runs on the live session of its module on that pane, and brings the pane forward", async () => {
    const service = new AgentService(undefined, () => [module]);
    open("a", 0x40, "one.bin");
    const forward: unknown[] = [];
    agentShell.bringForward = (pane) => forward.push(pane);
    activate(module.id, "panes");
    leave.push(registerAgentSession("a", module.id, { id: 7 }));
    expect((await call(service, "fit_poke")).json).toEqual({ poked: 7 });
    expect(forward).toEqual(["a"]);
  });
});

describe("open_panel", () => {
  // @upstream ByteRipperTests/AgentModuleToolsTests.swift#AgentModuleToolsTests.testOpenPanelThenSelectChoosesTheNodeAndBackReturns
  it("switches the tab's tool, as a step the reader's Back undoes", async () => {
    const service = new AgentService(undefined, () => [module]);
    open("a", 0x40, "one.bin");
    const first = await call(service, "open_panel", { module: "fit" });
    expect(first.json).toEqual({
      document: "d1",
      module: "fit",
      panel: "FIT Table",
      was_open: false,
    });
    expect(sessionOn(toolController.getSnapshot(), "panes").activeIdentifier).toBe(module.id);
    // The place the reader left is in the history; whether Back has anywhere to go is the open panel's
    // own registration, which a mounted panel makes and a test has none of.
    expect(navigationHistory.backStack.length).toBe(1);
    const again = await call(service, "open_panel", { module: "fit" });
    expect(member(again.json, "was_open")).toBe(true);
  });

  it("is refused while the person has a dialog up, and for a module it does not have", async () => {
    const service = new AgentService(undefined, () => [module]);
    open("a", 0x40, "one.bin");
    agentShell.busy = () => "A dialog is open.";
    expect((await call(service, "open_panel", { module: "fit" })).text).toBe(
      "A dialog is open. Ask the person to finish it first."
    );
    agentShell.busy = undefined;
    expect((await call(service, "open_panel", { module: "uefi" })).isError).toBe(true);
  });
});
