import { describe, expect, it } from "vitest";
import { encodeUtf8 } from "@/core/text/utf";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { AGENT_INSTRUCTIONS, AgentService } from "@/state/agent/agentService";

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
