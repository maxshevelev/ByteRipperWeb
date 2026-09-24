/**
 * The one-at-a-time asks the firmware store makes of a pane's worker — a
 * buffer's bytes, what a part of the image is, a rebuild plan — and what
 * becomes of the promise when the answer cannot come.
 *
 * Each is a promise held in a slot of its own, one per pane, and two things can
 * take the answer away: a second ask, which supersedes the first, and the tree
 * moving under it, where the reply is dropped on arrival because it carries a
 * job the store has left behind. Neither may leave a caller waiting for ever —
 * an update whose parent was read again would hold its modal open with nothing
 * coming.
 *
 * The worker is faked, and answers only what a case tells it to.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FirmwareWorkerRequest } from "@/workers/protocol";

/** Every request the store has sent, in order. */
let posted: FirmwareWorkerRequest[] = [];
/**
 * The listeners the store put on its worker, to answer through. Not cleared
 * between cases: the store keeps one worker per pane for the life of the
 * module, and with it the listener it registered once.
 */
const listeners: ((event: { data: unknown }) => void)[] = [];

class FakeWorker {
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === "message") listeners.push(listener);
  }
  removeEventListener(): void {}
  terminate(): void {}
  postMessage(request: FirmwareWorkerRequest): void {
    posted.push(request);
  }
}

(globalThis as { Worker?: unknown }).Worker = FakeWorker;

const { analyzePaneMe, askFirmwarePart, openFirmware, readSpaceBytes } = await import(
  "@/state/firmwareStore"
);
const { openInPane, workspaceStore } = await import("@/state/workspaceStore");

const reply = (response: unknown) => {
  for (const listener of listeners) listener({ data: response });
};

const sent = (kind: string) => posted.filter((request) => request.kind === kind);

/** The pane, with a tree the worker has answered for: asks go out only then. */
async function readyPane(): Promise<void> {
  openInPane("a", {
    name: "dump.bin",
    size: 0x100,
    lastModified: 0,
    source: new Blob([new Uint8Array(0x100)]),
  });
  openFirmware("a", new Blob([new Uint8Array(0x100)]));
  const open = sent("openFirmware").at(-1);
  if (open === undefined) throw new Error("the parse should have been sent");
  reply({ kind: "firmwareRoots", id: open.id, size: 0x100, roots: [], diagnostics: [] });
  posted = [];
}

beforeEach(async () => {
  posted = [];
  vi.useRealTimers();
  workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
  await readyPane();
});

describe("an ask whose answer cannot come", () => {
  it("is settled when the tree moves under it", async () => {
    const asked = askFirmwarePart("a", { range: [0, 8] });
    expect(sent("firmwareLayout")).toHaveLength(1);

    // A re-parse: the reply to the question above would carry a job the store
    // has left behind, and be dropped on arrival.
    openFirmware("a", new Blob([new Uint8Array(0x80)]));

    await expect(asked).resolves.toEqual({ layout: { kind: "image" }, rebuild: undefined });
  });

  it("is settled when a second ask supersedes it", async () => {
    const first = readSpaceBytes("a", [0x10]);
    const second = readSpaceBytes("a", [0x20]);

    await expect(first).resolves.toBeUndefined();

    // And the one that replaced it is the one the answer belongs to: the
    // replies carry their own jobs, so the first ask's cannot settle it.
    const asks = sent("firmwareSpaceBytes");
    expect(asks).toHaveLength(2);
    expect(asks[0]?.id).not.toBe(asks[1]?.id);
    reply({ kind: "firmwareSpaceBytes", id: asks[0]?.id, bytes: new Uint8Array([1]) });
    reply({ kind: "firmwareSpaceBytes", id: asks[1]?.id, bytes: new Uint8Array([2]) });
    await expect(second).resolves.toEqual(new Uint8Array([2]));
  });

  /**
   * An ask of one kind does not supersede an ask of another. The pane's job
   * counter is shared by every kind, and gating each reply on it threw away the
   * answer to a question nothing had replaced: the ME panel's analysis was
   * still running when the panel asked the same image for its file names, so
   * the analysis's reply was dropped, its waiter was never settled, and
   * "Reading ME…" stayed on screen for ever. Measured on a CSME 16 dump, whose
   * FTBL volume is what makes the panel ask for names at all.
   */
  it("is not superseded by an ask of another kind", async () => {
    const analysis = analyzePaneMe("a", "db", undefined, undefined);
    const ask = sent("meAnalyze").at(-1);
    if (ask === undefined) throw new Error("the analysis should have been sent");

    // The panel asks the same image something else while the analysis runs.
    readSpaceBytes("a", [0x10]);

    // The analysis's own reply still belongs to it.
    reply({
      kind: "meAnalyze",
      id: ask.id,
      regionOffset: 0,
      analysis: undefined,
      problem: "nothing here",
    });
    await expect(analysis).resolves.toMatchObject({ problem: "nothing here" });
  });
});
