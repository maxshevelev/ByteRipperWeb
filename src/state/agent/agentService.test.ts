import { afterEach, describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { argumentsText, detailFields } from "@/core/agent/agentLogText";
import { agentStatusText } from "@/core/agent/agentStatus";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { AGENT_INSTRUCTIONS, AgentService } from "@/state/agent/agentService";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { closeLargeDetail, largeDetailStore, showLargeDetail } from "@/state/largeDetailStore";
import { agentPanelIsUp, closePart, openInPane, workspaceStore } from "@/state/workspaceStore";

/**
 * The service's connections: counted once their client has spoken.
 *
 * @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests
 */

/** A bridge whose connections the test opens, feeds and closes itself. */
function fakeBridge() {
  const listeners = {
    connection: [] as ((id: number) => void)[],
    data: [] as ((id: number, bytes: Uint8Array) => void)[],
    close: [] as ((id: number) => void)[],
  };
  const bridge: AgentBridge = {
    setEnabled: async () => ({ ok: true, endpoint: "pipe" }),
    info: async () => undefined,
    onConnection: (callback) => {
      listeners.connection.push(callback);
      return () => undefined;
    },
    onData: (callback) => {
      listeners.data.push(callback);
      return () => undefined;
    },
    onClose: (callback) => {
      listeners.close.push(callback);
      return () => undefined;
    },
    send: () => undefined,
    end: () => undefined,
    file: (async () => {
      throw new Error("no files");
    }) as AgentBridge["file"],
  };
  return {
    bridge,
    connect: (id: number) => {
      for (const callback of listeners.connection) callback(id);
    },
    say: (id: number, text: string) => {
      for (const callback of listeners.data) callback(id, encodeUtf8(`${text}\n`));
    },
    hangUp: (id: number) => {
      for (const callback of listeners.close) callback(id);
    },
  };
}

const HELLO =
  '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"socket-test","version":"1"}}}';

describe("the connection count", () => {
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testASilentConnectionIsNotCountedAsAnAgent
  it("counts a connection once its client has spoken, not a silent one", async () => {
    const shell = fakeBridge();
    const service = new AgentService(shell.bridge, () => []);
    service.setEnabled(true);
    await service.apply();
    expect(service.store.getSnapshot().running).toBe(true);

    shell.connect(1);
    shell.connect(2);
    expect(service.store.getSnapshot().connections).toBe(0);
    shell.say(2, HELLO);
    expect(service.store.getSnapshot().connections).toBe(1);
    shell.say(2, HELLO);
    expect(service.store.getSnapshot().connections).toBe(1);

    // The silent one going away is no change; the agent going away is.
    shell.hangUp(1);
    expect(service.store.getSnapshot().connections).toBe(1);
    shell.hangUp(2);
    expect(service.store.getSnapshot().connections).toBe(0);
    service.stop();
  });
});

describe("what the service tells a client", () => {
  // Claude Code shows a model the server's instructions only up to about 2,040 characters and
  // drops the rest without a word: what is past that is never read.
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testTheInstructionsFitWhatAClientShows
  it("keeps the instructions within what a client shows", () => {
    expect(AGENT_INSTRUCTIONS.length).toBeLessThanOrEqual(1950);
    expect(AGENT_INSTRUCTIONS.endsWith("never `open_part`.")).toBe(true);
  });

  it("logs a call while it runs and replaces that row when it ends", async () => {
    const service = new AgentService(undefined, () => []);
    const lines: string[] = [];
    const connection = service.connect((line) => lines.push(new TextDecoder().decode(line)));
    connection.receive(
      encodeUtf8(
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"documents","arguments":{}}}\n'
      )
    );
    expect(service.store.getSnapshot().log.map((one) => one.outcome.kind)).toEqual(["running"]);
    expect(service.store.getSnapshot().toolStats.documents).toBeUndefined();
    await connection.waitUntilIdle();
    const log = service.store.getSnapshot().log;
    expect(log.map((one) => one.outcome.kind)).toEqual(["answered"]);
    expect(Object.keys(service.store.getSnapshot().toolStats)).toEqual(["documents"]);
  });
});

/** What the Settings tab and the Agent window say of `service`. */
const statusOf = (service: AgentService): string => {
  const state = service.store.getSnapshot();
  return agentStatusText({
    available: service.isAvailable,
    failure: state.failure,
    running: state.running,
    connections: state.connections,
  });
};

describe("the log", () => {
  afterEach(() => {
    workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
  });

  // Every call is logged — an answer as answered, a refusal as one.
  // @upstream ByteRipperTests/AgentServiceTests.swift#AgentServiceTests.testTheLogHearsEveryCall
  it("hears every call", async () => {
    const service = new AgentService(undefined, () => []);
    openInPane("a", {
      name: "x.bin",
      size: 4,
      lastModified: 0,
      source: new Blob([new Uint8Array(4)]),
    });
    const connection = service.connect(() => undefined);
    connection.receive(
      encodeUtf8(
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"focus","arguments":{}}}\n' +
          '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read","arguments":{"offset":"0x99999"}}}\n'
      )
    );
    await connection.waitUntilIdle();
    const log = service.store.getSnapshot().log;
    expect(log.map((one) => one.tool)).toEqual(["focus", "read"]);
    expect(log[0]?.outcome.kind).toBe("answered");
    expect(log[1]?.outcome.kind).toBe("toolError");
  });
});

describe("the details of a call", () => {
  // The selected call is shown whole: the result's sentence, and the arguments as the JSON the
  // agent sent, one member to a line — and Space or the corner button opens them over the window.
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheDetailsShowTheSelectedCallWhole
  // @upstream-differs what the window draws is the details' rows (`detailFields`, `argumentsText`),
  // with no window to select a row in; the large view is the store's (`largeDetailStore`), and the
  // JSON reads `"key": value` where Foundation writes `"key" : value`
  it("show the selected call whole", async () => {
    const service = new AgentService(undefined, () => []);
    const connection = service.connect(() => undefined);
    connection.receive(
      encodeUtf8(
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"mark","arguments":' +
          '{"offset":"0x10","length":64,"label":"Model","related_to":["m1","m2"]}}}\n'
      )
    );
    await connection.waitUntilIdle();
    const record = service.store.getSnapshot().log[0];
    if (record === undefined) throw new Error("the call is not logged");

    const shown = new Map(detailFields(record).map((one) => [one.label, one.value]));
    expect(shown.get("Result")).toBe("No file is open in ByteRipper.");
    expect(argumentsText(record)).toBe(
      [
        "{",
        '  "label": "Model",',
        '  "length": 64,',
        '  "offset": "0x10",',
        '  "related_to": [',
        '    "m1",',
        '    "m2"',
        "  ]",
        "}",
      ].join("\n")
    );

    expect(showLargeDetail(true)).toBe(true);
    expect(largeDetailStore.getSnapshot().open).toBe(true);
    closeLargeDetail();
    expect(largeDetailStore.getSnapshot().open).toBe(false);
  });
});

describe("the window", () => {
  afterEach(() => {
    workspaceStore.update((state) => ({ ...state, dock: EMPTY_DOCK, agentPanel: undefined }));
  });

  // Window ▸ Agent is aimed at the app — the one Agent panel, raised or folded — not at whatever
  // the focus is on.
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheWindowMenuLeadsToTheAgentWindow
  // @upstream-differs the menu entry is built in the toolbar's component; what it calls,
  // `toggleWindow`, is what is checked
  it("is what Window ▸ Agent brings up and puts away", () => {
    const { bridge } = fakeBridge();
    const service = new AgentService(bridge, () => []);
    expect(agentPanelIsUp(workspaceStore.getSnapshot())).toBe(false);
    service.toggleWindow();
    expect(agentPanelIsUp(workspaceStore.getSnapshot())).toBe(true);
    service.toggleWindow();
    expect(agentPanelIsUp(workspaceStore.getSnapshot())).toBe(false);
  });
});

describe("the switch", () => {
  // Off until switched on; on, it waits for a connection; off again, the endpoint is closed.
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheTabSwitchesTheServiceOnAndOffAndSaysSo
  it("switches the service on and off, and says so", async () => {
    const enabled: boolean[] = [];
    const { bridge } = fakeBridge();
    const service = new AgentService(
      {
        ...bridge,
        setEnabled: async (on) => {
          enabled.push(on);
          return { ok: true, endpoint: "pipe" };
        },
      },
      () => []
    );
    expect(service.store.getSnapshot().running).toBe(false);
    expect(statusOf(service)).toBe("Switched off.");

    await service.setEnabled(true);
    expect(service.store.getSnapshot().running).toBe(true);
    expect(statusOf(service)).toBe("Waiting for a connection.");

    await service.setEnabled(false);
    expect(service.store.getSnapshot().running).toBe(false);
    // The endpoint is the shell's: closing it is asking the shell to.
    expect(enabled).toEqual([true, false]);
  });

  // An endpoint another copy of the app holds is reported, not taken: the service stays off and
  // says why. The shell's half — that the socket is not taken — is `desktop/test/agent.test.cjs`.
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testASocketAnotherCopyHoldsIsReportedNotTaken
  it("reports an endpoint another copy holds, and does not take it", async () => {
    const { bridge } = fakeBridge();
    const service = new AgentService(
      {
        ...bridge,
        setEnabled: async () => ({
          ok: false,
          error: "Another copy of ByteRipper holds the agent endpoint.",
        }),
      },
      () => []
    );
    await service.setEnabled(true);
    expect(service.store.getSnapshot().running).toBe(false);
    expect(statusOf(service).startsWith("Could not start: "), statusOf(service)).toBe(true);
  });
});

describe("the focus note", () => {
  afterEach(() => {
    for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
    workspaceStore.update((state) => ({
      ...state,
      panes: { a: undefined, b: undefined },
      parts: {},
      dock: EMPTY_DOCK,
    }));
  });

  /** The answer to one `tools/call`: whether it is a refusal, and its text. */
  async function call(service: AgentService, name: string, args: { [key: string]: Json }) {
    const written: Json[] = [];
    const connection = service.connect((line) => written.push(parseJson(decodeUtf8(line))));
    connection.receive(
      encodeUtf8(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })}\n`
      )
    );
    await connection.waitUntilIdle();
    const result = member(written[0], "result");
    return {
      isError: member(result, "isError") === true,
      text: member((member(result, "content") as Json[])[0], "text") as string,
    };
  }

  // Upstream reads the note's `document` with `try?`: one that is no string says nothing, and the
  // tool's own refusal is the answer.
  it("says nothing of a `document` that is no string, and leaves the refusal to the tool", async () => {
    openInPane("a", {
      name: "front.bin",
      size: 0x100,
      lastModified: 0,
      source: new Blob([new Uint8Array(0x100)]),
    });
    const service = new AgentService(undefined, () => []);
    // The focus moves to the part.
    expect((await call(service, "open_part", { offset: "0x10", length: "0x10" })).isError).toBe(
      false
    );
    expect(service.focusNote(new AgentArguments({ document: "d1" }))).toContain("a part of d1");
    expect(service.focusNote(new AgentArguments({ document: 7 }))).toBeUndefined();

    const refused = await call(service, "read", { document: 7, offset: 0, length: 4 });
    expect(refused.isError).toBe(true);
    expect(refused.text).not.toContain("The focus is on");
    let own = "";
    try {
      new AgentArguments({ document: 7 }).optionalString("document");
    } catch (error) {
      own = error instanceof Error ? error.message : String(error);
    }
    expect(refused.text).toBe(own);
  });
});
