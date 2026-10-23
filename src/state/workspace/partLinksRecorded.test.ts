import { afterEach, describe, expect, it } from "vitest";
import { CopyPartCodec } from "@/core/parts/partCodec";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { openLinkedPart } from "@/state/openLinkedPart";
import { releaseSession } from "@/state/sessions/pageSessions";
import { bringPane } from "@/state/workspace/paneTransfer";
import {
  type LinkAnswer,
  nameThisWorkspace,
  paneElsewhere,
  paneNamed,
  startParentLinks,
} from "@/state/workspace/parentLinks";
import { partCodecState } from "@/state/workspace/partCodecState";
import { snapshotWorkspace } from "@/state/workspace/workspaceRecorder";
import { noteRestoredForTesting } from "@/state/workspace/workspaceRestorer";
import {
  closePart,
  openEmptyInPane,
  type PartId,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * A part linked to its parent, written down and asked for again: a part let go on a pane is written
 * as where it came from, as a panel's is, and a parent in another window is named as that window
 * writes it — which that window, restoring, takes the part out of again.
 *
 * @upstream ByteRipperTests/WorkspaceRestoreTests.swift#WorkspaceRestoreTests.testATornOffPartComesBackLinkedToItsParentInAnotherWindow
 */

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

async function fileInA(): Promise<void> {
  openEmptyInPane("a", "bios.bin");
  await paneState("a")?.document.insert(
    0,
    Uint8Array.from({ length: 0x40 }, (_, index) => index)
  );
}

async function partOfA(): Promise<PartId> {
  const part = await openLinkedPart({
    parent: "a",
    name: "zone",
    source: [0x10, 0x20],
    codec: new CopyPartCodec(),
  });
  if (part === undefined) throw new Error("the part should open");
  return part;
}

/** Another window on the line, as a raw channel: what it hears, and a way to speak. */
function otherWindow(name: string) {
  const ours = new BroadcastChannel(name);
  stops.push(startParentLinks(ours));
  const theirs = new BroadcastChannel(name);
  stops.push(() => theirs.close());
  return theirs;
}

describe("a part's parent, as the workspace writes it", () => {
  it("names a pane of another window by that window and its id there", () => {
    expect(paneElsewhere("w-1", "part:3")).toBe("w-1#part:3");
    expect(paneNamed("w-1#part:3")).toEqual({ workspace: "w-1", pane: "part:3" });
    expect(paneNamed("a")).toEqual({ pane: "a" });
  });

  it("writes a part let go on a pane as where it came from", async () => {
    await fileInA();
    await bringPane(undefined, await partOfA(), "b", false);

    const { workspace } = await snapshotWorkspace();

    const written = workspace.tab.panes[1]?.document;
    expect(written?.kind).toBe("part");
    if (written?.kind !== "part") return;
    expect(written.part.parent).toBe("a");
    expect([written.part.sourceStart, written.part.sourceEnd]).toEqual([0x10, 0x20]);
    expect(written.part.name).toBe("zone");
    expect(written.part.edits).toBeUndefined();
  });

  it("names a parent another window shows as that window writes it", async () => {
    await fileInA();
    await bringPane(undefined, await partOfA(), "b", false);
    // The parent goes on in another window, which says what it writes it down as.
    const parent = paneState("a")?.document;
    if (parent === undefined) throw new Error("pane A should be open");
    releaseSession(parent);
    workspaceStore.update((state) => ({ ...state, panes: { ...state.panes, a: undefined } }));
    const other = otherWindow("parents-whose");
    other.onmessage = (event) => {
      const message = event.data as { kind: string; ask: string; session: string };
      if (message.kind === "whose" && message.session === parent.id) {
        other.postMessage({ kind: "held", ask: message.ask, id: paneElsewhere("w-1", "a") });
      }
    };

    const { workspace } = await snapshotWorkspace();

    const written = workspace.tab.panes[1]?.document;
    expect(written?.kind === "part" ? written.part.parent : undefined).toBe("w-1#a");
  });
});

describe("a window asked for a part of one of its panes", () => {
  it("takes it out of the pane once that is back, and names the pane's session", async () => {
    await fileInA();
    nameThisWorkspace(() => "w-here");
    const other = otherWindow("parents-open");
    const answered = new Promise<LinkAnswer | undefined>((resolve) => {
      other.onmessage = (event) => {
        const message = event.data as { kind: string; answer?: LinkAnswer };
        if (message.kind === "linkOpened") resolve(message.answer);
      };
    });

    other.postMessage({
      kind: "openLink",
      ask: "one",
      workspace: "w-here",
      pane: "a",
      request: {
        source: [0x10, 0x14],
        codec: JSON.stringify(partCodecState(new CopyPartCodec())),
        name: "zone",
      },
    });
    noteRestoredForTesting("a", "a");

    const answer = await answered;
    expect(answer?.session).toBe(paneState("a")?.document.id);
    expect(answer?.parentName).toBe("bios.bin");
    expect(Array.from(answer?.bytes ?? [])).toEqual([0x10, 0x11, 0x12, 0x13]);
  });

  it("is not asked by a window that writes another workspace", async () => {
    nameThisWorkspace(() => "w-here");
    const other = otherWindow("parents-other");
    const heard: string[] = [];
    other.onmessage = (event) => heard.push((event.data as { kind: string }).kind);
    other.postMessage({
      kind: "openLink",
      ask: "two",
      workspace: "w-elsewhere",
      pane: "a",
      request: { source: [0, 1], codec: "{}", name: "zone" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heard).toEqual([]);
  });
});
