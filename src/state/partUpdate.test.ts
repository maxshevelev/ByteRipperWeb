import { afterEach, describe, expect, it } from "vitest";
import { CopyPartCodec, type PartParent, type PartUpdate } from "@/core/parts/partCodec";
import { agentShell } from "@/state/agent/agentShell";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { aDialogIsOpen, updateInParentQuietly } from "@/state/partUpdate";
import { openGivenPart } from "@/state/testing/givenParts";
import {
  closePart,
  dismissAlert,
  openEmptyInPane,
  type PartId,
  paneState,
  reportAlert,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * Update in Parent asked by a caller that does not wait for one update before asking the next —
 * the agent — and the parent changing while an update is worked out.
 *
 * Upstream's update runs on the main actor, where nothing lands between its check that the parent
 * is as it was and its write; here both sides of that check are waits, and these cases are what
 * the queue and the second look in front of the write are for.
 *
 * @web-only upstream's main actor makes these cases impossible rather than handled
 */

afterEach(() => {
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
    alert: undefined,
  }));
  agentShell.busy = undefined;
});

/** A copy that goes back only once the test opens its gate: an encode that takes its time. */
class GatedCopy extends CopyPartCodec {
  private open: () => void = () => undefined;
  private readonly gate = new Promise<void>((resolve) => {
    this.open = resolve;
  });
  /** How many encodes have been asked for. */
  asked = 0;

  release(): void {
    this.open();
  }

  override async encode(part: Uint8Array, parent: PartParent): Promise<PartUpdate> {
    this.asked += 1;
    await this.gate;
    return super.encode(part, parent);
  }
}

/** A 0x40-byte file in A, each byte its offset, and `[0x10, 0x20)` of it a part going back through `codec`, edited. */
async function editedPart(codec: GatedCopy): Promise<PartId> {
  openEmptyInPane("a", "bios.bin");
  const parent = paneState("a")?.document;
  if (parent === undefined) throw new Error("pane A should be open");
  await parent.insert(
    0,
    Uint8Array.from({ length: 0x40 }, (_, index) => index)
  );
  const part = await openGivenPart({
    parent: "a",
    bytes: await parent.read(0x10, 0x10),
    name: "bios_zone.bin",
    source: [0x10, 0x20],
    partName: "zone",
    back: codec,
  });
  await paneState(part)?.document.overwrite(0, Uint8Array.of(0xaa, 0xbb));
  return part;
}

const parentBytes = async (start: number, end: number): Promise<number[]> => [
  ...((await paneState("a")?.document.read(start, end - start)) ?? []),
];

/** Lets every wait that can settle, settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("two updates of the same part asked at once", () => {
  it("write once: the second is worked out over what the first left, and has nothing to put back", async () => {
    const codec = new GatedCopy();
    const part = await editedPart(codec);
    const parent = paneState("a")?.document;
    const generation = parent?.contentGeneration;
    const stepBefore = parent?.undoHistory.undoLabel;

    const first = updateInParentQuietly(part, false);
    const second = updateInParentQuietly(part, false);
    await settle();
    // The second waits behind the first rather than encoding over the same bytes beside it.
    expect(codec.asked).toBe(1);
    codec.release();

    expect((await first).kind).toBe("updated");
    expect((await second).kind).toBe("unchanged");
    expect(codec.asked).toBe(1);
    expect(await parentBytes(0x10, 0x12)).toEqual([0xaa, 0xbb]);
    // One write, one undo step.
    expect(parent?.contentGeneration).toBe((generation ?? 0) + 1);
    expect(parent?.undoHistory.undoLabel).toBe("Update from bios_zone.bin");
    await parent?.undo();
    expect(await parentBytes(0x10, 0x12)).toEqual([0x10, 0x11]);
    expect(parent?.undoHistory.undoLabel).toBe(stepBefore);
  });
});

describe("a parent that changes while the update is worked out", () => {
  it("is not written over: the update says so, and nothing lands", async () => {
    const codec = new GatedCopy();
    const part = await editedPart(codec);
    const parent = paneState("a")?.document;

    const asked = updateInParentQuietly(part, false);
    await settle();
    expect(codec.asked).toBe(1);
    // The person types into the parent while the codec works.
    await parent?.overwrite(0x30, Uint8Array.of(0x99));
    codec.release();

    expect((await asked).kind).toBe("parentChanged");
    expect(await parentBytes(0x10, 0x12)).toEqual([0x10, 0x11]);
    expect(await parentBytes(0x30, 0x31)).toEqual([0x99]);
    // Asked again, it is worked out over the parent as it is now, and goes back.
    expect((await updateInParentQuietly(part, false)).kind).toBe("updated");
    expect(await parentBytes(0x10, 0x12)).toEqual([0xaa, 0xbb]);
  });
});

describe("a dialog in the way", () => {
  // Upstream's `update_in_parent` refuses while any sheet hangs on the window, alerts included.
  it("is an alert waiting for its button, or a modal the shell has up", () => {
    expect(aDialogIsOpen()).toBe(false);
    reportAlert("Updated", "Undo takes it back.", "success");
    expect(aDialogIsOpen()).toBe(true);
    dismissAlert();
    expect(aDialogIsOpen()).toBe(false);
    agentShell.busy = () => "A dialog is open.";
    expect(aDialogIsOpen()).toBe(true);
  });
});
