/**
 * A part that goes back through the rebuild planner: a zone that is a structure
 * of the image, or a decompressed body (`Design/UEFI/UPDATE_IN_PARENT.md` §6).
 *
 * The planner's own answers are `uefiRebuild.test.ts`'s. What this is about is
 * the wiring: that the link records where the bytes go back to, that Update in
 * Parent sends them there rather than refusing a length change, that what comes
 * back is written as one undo step with the link moved on, and that the (×)
 * abandons the result without writing a byte.
 *
 * The worker is faked — and answers by running the real planner, since the
 * point is what crosses and what is done with it.
 *
 * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import * as Test from "@/firmware/testing/testImage";
import { FFS } from "@/firmware/uefi/fileParser";
import { Section } from "@/firmware/uefi/sectionParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { planRebuild } from "@/firmware/uefi/uefiRebuild";
import type { FirmwareRebuildRequest, FirmwareWorkerRequest } from "@/workers/protocol";

/** What the fake worker was asked, in order. */
let posted: FirmwareWorkerRequest[] = [];
/** Held open while a test wants to see the update in flight. */
let answer:
  | ((request: FirmwareRebuildRequest, reply: (response: unknown) => void) => void)
  | undefined;

class FakeWorker {
  private readonly listeners: ((event: { data: unknown }) => void)[] = [];

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === "message") this.listeners.push(listener);
  }
  removeEventListener(): void {}
  terminate(): void {}

  postMessage(request: FirmwareWorkerRequest): void {
    posted.push(request);
    if (request.kind !== "firmwareRebuild") return;
    const reply = (response: unknown) => {
      for (const listener of this.listeners) listener({ data: response });
    };
    if (answer !== undefined) {
      answer(request, reply);
      return;
    }
    void plan(request).then(reply);
  }
}

/** The planner, run where the worker would run it. */
async function plan(request: FirmwareRebuildRequest): Promise<unknown> {
  const file = new Uint8Array(await request.content.arrayBuffer());
  const result = planRebuild(
    request.bytes,
    {
      space: request.target.space,
      ...(request.target.range === undefined
        ? {}
        : { range: { start: request.target.range[0], end: request.target.range[1] } }),
    },
    file
  );
  if (!result.ok) {
    return {
      kind: "firmwareRebuild",
      id: request.id,
      plan: undefined,
      refusal: result.refusal.message,
    };
  }
  const rebuilt = file;
  rebuilt.set(result.plan.bytes, result.plan.offset);
  const { start, end } = result.plan.source;
  return {
    kind: "firmwareRebuild",
    id: request.id,
    plan: {
      offset: result.plan.offset,
      bytes: result.plan.bytes,
      warnings: result.plan.warnings,
      source: [start, end],
      sourceBytes: rebuilt.slice(start, end),
    },
    refusal: undefined,
  };
}

(globalThis as { Worker?: unknown }).Worker = FakeWorker;

const { openLinkedPart } = await import("@/state/openLinkedPart");
const { updateInParent } = await import("@/state/partUpdate");
const { EMPTY_DOCK } = await import("@/state/fragmentDock");
const { closePart, openEmptyInPane, paneState, workspaceStore } = await import(
  "@/state/workspaceStore"
);
type PartId = Awaited<ReturnType<typeof openLinkedPart>>;

beforeEach(() => {
  posted = [];
  answer = undefined;
});

afterEach(() => {
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
    alert: undefined,
  }));
});

/** A volume with one sectioned file in it, and where that file is. */
function image(): { bytes: Uint8Array; file: { start: number; end: number } } {
  const bytes = Test.volume({
    length: 0x400,
    files: [
      Test.sectionedFile({
        sections: [
          Test.nameSection("MyDriver"),
          Test.section({ type: Section.raw, body: new Uint8Array(8).fill(0x11) }),
        ],
      }),
      Test.file({ guid: Test.DRIVER_GUID, type: FFS.rawType, body: new Uint8Array(40).fill(0x42) }),
    ],
  });
  const node = parseUefiImage(sourceOver(bytes)).roots[0]?.children[0] as UEFINode;
  return { bytes, file: nodeRange(node) };
}

/** That image in pane A, with its file taken out as a part linked back to it. */
async function partOfTheFile(): Promise<{
  part: PartId;
  file: { start: number; end: number };
  bytes: Uint8Array;
}> {
  const { bytes, file } = image();
  openEmptyInPane("a", "bios.bin");
  const slot = paneState("a");
  if (slot === undefined) throw new Error("pane A should be open");
  await slot.document.insert(0, bytes);
  const part = await openLinkedPart({
    parent: "a",
    bytes: await slot.document.read(file.start, file.end - file.start),
    name: "bios_MyDriver.bin",
    source: [file.start, file.end],
    partName: "MyDriver",
    rebuildTarget: { space: [], range: file },
  });
  return { part, file, bytes };
}

const parentBytes = async (): Promise<Uint8Array> => {
  const slot = paneState("a");
  if (slot === undefined) throw new Error("pane A should be open");
  return slot.document.read(0, slot.document.size);
};

/** Waits out the turns of the loop something takes to appear. */
async function until<T>(read: () => T | undefined): Promise<T> {
  for (let turn = 0; turn < 100; turn++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resume) => setTimeout(resume, 1));
  }
  throw new Error("it never appeared");
}

const checksumComplaints = (bytes: Uint8Array): string[] =>
  parseUefiImage(sourceOver(bytes))
    .diagnostics.map((one) => one.detail.kind)
    .filter((kind) => kind === "checksumMismatch");

describe("a part the image is laid out again around", () => {
  /**
   * A zone that is a file of the image goes back through the planner, which
   * puts the file's checksums right around the edit.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testAZoneThatIsAFileGoesBackWithItsChecksumsRight
   */
  it("goes back with its checksums right", async () => {
    const { part, file } = await partOfTheFile();
    // The last byte of the raw section's payload, flipped.
    const document = paneState(part)?.document;
    if (document === undefined) throw new Error("the part should be open");
    const last = document.size - 1;
    await document.overwrite(last, Uint8Array.from([0x00]));

    const outcome = await updateInParent(part);

    expect(outcome).toEqual({ kind: "updated", parent: "a" });
    const bytes = await parentBytes();
    expect(bytes[file.start + last]).toBe(0x00);
    expect(checksumComplaints(bytes)).toEqual([]);
    expect(workspaceStore.getSnapshot().alert?.title).toBe("Updated “bios.bin”");
    const origin = paneState(part)?.origin;
    expect(await origin?.state()).toBe("intact");
    expect(
      await origin?.hasChanges(paneState(part)?.document as Parameters<typeof origin.hasChanges>[0])
    ).toBe(false);
  });

  /**
   * The length rule is the answer for a part with nowhere to be laid out again;
   * a part that has one goes back longer, and what follows it moves.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/UEFIRebuildTests.swift#UEFIRebuildTests.testAGrownFileMovesTheFileAfterItIntoTheFreeSpace
   */
  it("goes back at another length", async () => {
    const { part, file } = await partOfTheFile();
    const document = paneState(part)?.document;
    if (document === undefined) throw new Error("the part should be open");
    // One more section on the end of the file's body: the planner puts the
    // file's own size and checksums right around it.
    await document.insert(
      document.size,
      Test.section({ type: Section.raw, body: new Uint8Array(40).fill(0x99) })
    );

    const outcome = await updateInParent(part);

    expect(outcome.kind).toBe("updated");
    const origin = paneState(part)?.origin;
    // The link followed the file to its new length.
    expect(origin?.sourceRange[0]).toBe(file.start);
    expect((origin?.sourceRange[1] ?? 0) - (origin?.sourceRange[0] ?? 0)).toBe(document.size);
    expect(checksumComplaints(await parentBytes())).toEqual([]);
  });

  /**
   * A decompressed body whose section is not in the parent any more is refused
   * with the planner's own sentence, and nothing is written.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testADecompressedBodyWhoseSectionIsGoneIsRefused
   */
  it("is refused where the section it came out of is gone", async () => {
    openEmptyInPane("a", "bios.bin");
    const slot = paneState("a");
    if (slot === undefined) throw new Error("pane A should be open");
    await slot.document.insert(0, new Uint8Array(0x100).fill(0xff));
    const part = await openLinkedPart({
      parent: "a",
      bytes: new Uint8Array(0x60),
      name: "bios_body.bin",
      source: [0x20, 0x80],
      partName: "body",
      kind: "decompressed",
      rebuildTarget: { space: [0x20] },
    });
    await paneState(part)?.document.overwrite(0, Uint8Array.from([0x01]));

    const outcome = await updateInParent(part);

    expect(outcome.kind).toBe("refused");
    expect(workspaceStore.getSnapshot().alert?.title).toBe("“body” cannot be put back");
    expect((await parentBytes())[0x20]).toBe(0xff);
  });

  /**
   * The (×) abandons the update: the plan cannot be stopped halfway, but
   * nothing is written until it is done, so nothing is.
   *
   * @upstream ByteRipperTests/LinkedPartTests.swift#LinkedPartTests.testCancellingTheUpdateSheetWritesNothing
   */
  it("writes nothing when the update is abandoned", async () => {
    const { part } = await partOfTheFile();
    const document = paneState(part)?.document;
    if (document === undefined) throw new Error("the part should be open");
    await document.overwrite(document.size - 1, Uint8Array.from([0x00]));
    const before = await parentBytes();
    let finish: (() => void) | undefined;
    answer = (request, reply) => {
      finish = () => void plan(request).then(reply);
    };

    const running = updateInParent(part);
    const { operationStore } = await import("@/state/operationStore");
    // The update reaches the worker a few turns in — the link hashes both
    // sides before it plans anything.
    const shown = await until(() => operationStore.getSnapshot().a);
    expect(shown.name).toContain("MyDriver");
    shown.operation.cancel();
    finish?.();

    expect((await running).kind).toBe("cancelled");
    expect(await parentBytes()).toEqual(before);
    expect(workspaceStore.getSnapshot().alert).toBeUndefined();
  });
});
