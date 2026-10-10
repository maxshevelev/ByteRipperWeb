import { afterEach, beforeEach } from "vitest";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { AgentService } from "@/state/agent/agentService";
import { closeFirmware, firmwareStore, noteFirmwareOperations } from "@/state/firmwareStore";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  closePart,
  editingHooks,
  openInPane,
  type PaneId,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * The agent's tools over the real parser, compressor and rebuild, for a test file that imports
 * this and calls `setUpFirmwareAgent()`.
 *
 * Vitest has no Web Workers, and the firmware paths all go through the pane's firmware worker: the
 * tree, the decompressed buffers, the rebuild that compresses a body again. So the worker module
 * itself runs here, in this thread — one instance of it per worker the store makes, each with a
 * `self` of its own to answer through, and a `FileReaderSync` that reads the blobs this side hands
 * over. Nothing about the worker is faked but the thread it runs on.
 *
 * What cannot run here is the React half: a tool panel's live session, which `uefi_select` acts
 * on, is a mounted component's.
 *
 * Importing this replaces `Worker` and `FileReaderSync` for the whole test file, which vitest
 * runs in a module scope of its own.
 */

// MARK: - The worker, in this thread

/** A `Blob` whose bytes are at hand, so a `FileReaderSync` can be stood in for. */
class HeldBlob extends Blob {
  readonly held: Uint8Array<ArrayBuffer>;
  constructor(held: Uint8Array<ArrayBuffer>) {
    super([held]);
    this.held = held;
  }
  override slice(start?: number, end?: number): Blob {
    return new HeldBlob(this.held.slice(start, end));
  }
}

(globalThis as { FileReaderSync?: unknown }).FileReaderSync = class {
  readAsArrayBuffer(blob: Blob): ArrayBuffer {
    if (!(blob instanceof HeldBlob)) throw new Error("only a held blob reads synchronously here");
    return blob.held.slice().buffer;
  }
};

/** A request's answer in the worker's place, or nothing to let the worker answer it. */
export type AnswerInstead = (request: { [key: string]: unknown }) => unknown;

/**
 * What a case answers in the worker's place: a request it returns an answer for never reaches the
 * worker. For a failure the bytes of a test image cannot be made to give.
 */
let answeredInstead: AnswerInstead | undefined;

let workerCount = 0;
/** Module instances are made one at a time: each reads `self` as it is evaluated. */
let made: Promise<unknown> = Promise.resolve();

/**
 * `firmware.worker.ts` behind the `Worker` interface the store uses: a module instance of its own
 * (the query makes it one), its messages delivered in the order they were sent and its answers a
 * turn later, as a worker's are. A blob crosses as one whose bytes are held, which is all the
 * worker's `FileReaderSync` needs.
 */
class InProcessWorker {
  private readonly listeners: ((event: { data: unknown }) => void)[] = [];
  private delivered: Promise<(data: unknown) => void>;
  private terminated = false;

  constructor() {
    workerCount += 1;
    const instance = workerCount;
    const scope = {
      onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
      postMessage: (data: unknown) => this.answer(data),
    };
    const making = made.then(async () => {
      (globalThis as { self?: unknown }).self = scope;
      await import(/* @vite-ignore */ `../../workers/firmware.worker.ts?instance=${instance}`);
      return (data: unknown) => scope.onmessage?.({ data });
    });
    made = making;
    this.delivered = making;
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === "message") this.listeners.push(listener);
  }
  removeEventListener(): void {}
  terminate(): void {
    this.terminated = true;
  }

  private answer(data: unknown): void {
    setTimeout(() => {
      if (this.terminated) return;
      for (const listener of this.listeners) listener({ data });
    }, 0);
  }

  postMessage(request: { [key: string]: unknown }): void {
    if (this.terminated) return;
    const instead = answeredInstead?.(request);
    if (instead !== undefined) {
      this.answer(instead);
      return;
    }
    this.delivered = this.delivered.then(async (deliver) => {
      const message = { ...request };
      for (const [key, value] of Object.entries(message)) {
        if (value instanceof Blob && !(value instanceof HeldBlob)) {
          message[key] = new HeldBlob(new Uint8Array(await value.arrayBuffer()));
        }
      }
      deliver(message);
      return deliver;
    });
  }
}

(globalThis as { Worker?: unknown }).Worker = InProcessWorker;

// MARK: - The service

const bridge = (): AgentBridge => ({
  setEnabled: async () => ({ ok: true }),
  info: async () => undefined,
  onConnection: () => () => undefined,
  onData: () => () => undefined,
  onClose: () => () => undefined,
  send: () => undefined,
  end: () => undefined,
  file: (async () => {
    throw new Error("ENOENT");
  }) as AgentBridge["file"],
});

/** A tool's answer: whether it refused, its text, and the text read as JSON when it answered. */
export interface ToolAnswer {
  readonly isError: boolean;
  readonly text: string;
  readonly json: Json | undefined;
}

/** What a test file drives the agent's tools with. */
export interface FirmwareAgent {
  /** The service of the case running: a new one for every case. */
  readonly service: AgentService;
  /** Calls `name` as a client would, over an in-memory connection. */
  call(name: string, args?: { [key: string]: Json }): Promise<ToolAnswer>;
  /** Opens `bytes` in `pane` as a file called `name`. */
  open(bytes: Uint8Array, pane?: "a" | "b", name?: string): void;
  /** Answers the requests `instead` answers in the worker's place, for the rest of the case. */
  answerInstead(instead: AnswerInstead): void;
}

/**
 * The agent's tools over the real worker, a fresh service for every case and nothing left open
 * between them.
 */
export function setUpFirmwareAgent(): FirmwareAgent {
  let service: AgentService | undefined;

  beforeEach(() => {
    service = new AgentService(bridge());
    // As the shell wires it: an edit is news to the tree the worker holds.
    editingHooks.onContentChange = noteFirmwareOperations;
  });

  afterEach(() => {
    answeredInstead = undefined;
    editingHooks.onContentChange = undefined;
    // Each case's file is a file of its own: the trees read of the last one go with it.
    for (const pane of Object.keys(firmwareStore.getSnapshot().panes)) {
      closeFirmware(pane as PaneId);
    }
    service?.desk.background.closeAll();
    for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
    workspaceStore.update((state) => ({
      ...state,
      panes: { a: undefined, b: undefined },
      parts: {},
      dock: EMPTY_DOCK,
      alert: undefined,
    }));
  });

  const current = (): AgentService => {
    if (service === undefined) throw new Error("the service is made for a case, in beforeEach");
    return service;
  };

  return {
    get service() {
      return current();
    },
    async call(name, args = {}) {
      const written: Json[] = [];
      const connection = current().connect((line) => written.push(parseJson(decodeUtf8(line))));
      connection.receive(
        encodeUtf8(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })}\n`
        )
      );
      await connection.waitUntilIdle();
      const result = member(written[0], "result");
      const text = member((member(result, "content") as Json[])[0], "text") as string;
      const isError = member(result, "isError") === true;
      return { isError, text, json: isError ? undefined : (parseJson(text) as Json) };
    },
    open(bytes, pane = "a", name = "front.bin") {
      openInPane(pane, {
        name,
        size: bytes.length,
        lastModified: 0,
        source: new Blob([Uint8Array.from(bytes)]),
      });
    },
    answerInstead(instead) {
      answeredInstead = instead;
    },
  };
}
