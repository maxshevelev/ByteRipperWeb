/**
 * The pane's own reading of its ME region, and who pays for it.
 *
 * Analysing the region is the most expensive read the application makes, and
 * two panels present it — the ME Analyzer and the UEFI Structure's grafted
 * sub-tree (G57). Upstream keeps one analysis on the pane so the second panel
 * costs nothing (`PaneUEFIState.meAnalysis`); here it is kept in the firmware
 * store, keyed by what it was read against.
 *
 * The worker is faked, and answers only what a case tells it to.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { FirmwareWorkerRequest } from "@/workers/protocol";

let posted: FirmwareWorkerRequest[] = [];
/** Never cleared: the store keeps one worker per pane for the module's life. */
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

const { analyzePaneMe, closeFirmware, noteFirmwareContentChange, openFirmware } = await import(
  "@/state/firmwareStore"
);
const { openInPane, workspaceStore } = await import("@/state/workspaceStore");

const reply = (response: unknown) => {
  for (const listener of listeners) listener({ data: response });
};

const sent = (kind: string) => posted.filter((request) => request.kind === kind);

/** Answers the ME ask that is outstanding, as the worker would. */
function answerAnalysis(): void {
  const ask = sent("meAnalyze").at(-1);
  if (ask === undefined) throw new Error("an analysis should have been asked for");
  reply({
    kind: "meAnalyze",
    id: ask.id,
    regionOffset: 0x1000,
    analysis: undefined,
    problem: "no ME region",
  });
}

/** The pane, with a tree the worker has answered for: asks go out only then. */
function readyPane(): void {
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

beforeEach(() => {
  posted = [];
  // The pane goes and its reading with it, so each case starts with an empty
  // cache — as a reader who set the tool to None and came back would.
  closeFirmware("a");
  workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
  readyPane();
});

describe("the pane's ME analysis", () => {
  it("is read once for the same bytes and the same database", async () => {
    const first = analyzePaneMe("a", "MEA.dat", undefined, undefined);
    answerAnalysis();
    await expect(first).resolves.toMatchObject({ regionOffset: 0x1000 });
    expect(sent("meAnalyze")).toHaveLength(1);

    // The second panel asks the same question and is answered from the pane.
    await expect(analyzePaneMe("a", "MEA.dat", undefined, undefined)).resolves.toMatchObject({
      regionOffset: 0x1000,
    });
    expect(sent("meAnalyze")).toHaveLength(1);
  });

  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testTwoAsksForOneRegionReadItOnce
  it("answers two panels asking at once with one reading", async () => {
    const one = analyzePaneMe("a", "MEA.dat", undefined, undefined);
    const two = analyzePaneMe("a", "MEA.dat", undefined, undefined);
    expect(sent("meAnalyze")).toHaveLength(1);

    answerAnalysis();

    await expect(one).resolves.toMatchObject({ regionOffset: 0x1000 });
    await expect(two).resolves.toMatchObject({ regionOffset: 0x1000 });
  });

  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testAnEditInsideTheRegionDropsTheReadingInFlight
  it("is read again once the bytes have moved", async () => {
    const first = analyzePaneMe("a", "MEA.dat", undefined, undefined);
    answerAnalysis();
    await first;

    const document = workspaceStore.getSnapshot().panes.a?.document;
    if (document === undefined) throw new Error("pane A should be open");
    await document.overwrite(0, new Uint8Array([1]));

    void analyzePaneMe("a", "MEA.dat", undefined, undefined);
    expect(sent("meAnalyze")).toHaveLength(2);
  });

  // The key counts a document's changes, and a document that has just been
  // replaced counts from zero again — so the cache has to go with the content
  // rather than wait for a key that will never stop matching.
  it("is read again when the pane's content is replaced outright", async () => {
    const first = analyzePaneMe("a", "MEA.dat", undefined, undefined);
    answerAnalysis();
    await first;

    noteFirmwareContentChange("a", { kind: "reloaded" });

    void analyzePaneMe("a", "MEA.dat", undefined, undefined);
    expect(sent("meAnalyze")).toHaveLength(2);
  });

  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testANewDatabaseDropsTheCachedAnalysis
  // @upstream ByteRipperTests/UEFIToolFlowTests.swift#UEFIToolFlowTests.testANewDatabaseMakesTheUEFIPanelReadTheRegionAgain
  it("is read again against a newer database", async () => {
    const first = analyzePaneMe("a", "MEA.dat", undefined, undefined);
    answerAnalysis();
    await first;

    void analyzePaneMe("a", "MEA.dat — newer", undefined, undefined);
    expect(sent("meAnalyze")).toHaveLength(2);
  });
});
