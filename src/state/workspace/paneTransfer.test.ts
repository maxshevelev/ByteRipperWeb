import { describe, expect, it, vi } from "vitest";
import type { Bookmark } from "@/core/bookmarks/bookmarkStore";
import type { PaneState } from "@/core/workspace/workspace";
import type { OpenedFile } from "@/platform/files/openedFile";
import type { PaneId } from "@/state/paneId";
import {
  handoverHash,
  handoverOfHash,
  type PaneChannel,
  type PaneHolder,
  paneTransferPeer,
  type TakenPane,
} from "@/state/workspace/paneTransfer";

vi.mock("@/state/workspace/workspaceRestorer", () => ({
  adoptMovedSession: async () => undefined,
}));

// `Design/DESKTOP_WINDOWS.md`, D5: a pane carried between the desktop shell's windows, over a
// channel the windows share.

/** Channels joined into one bus, as `BroadcastChannel`s of one name are: a post reaches the rest. */
function bus(): () => PaneChannel {
  const members = new Set<{ listeners: Set<(event: { data: unknown }) => void> }>();
  return () => {
    const me = { listeners: new Set<(event: { data: unknown }) => void>() };
    members.add(me);
    return {
      postMessage(data) {
        for (const other of members) {
          if (other === me) continue;
          for (const listener of [...other.listeners]) queueMicrotask(() => listener({ data }));
        }
      },
      addEventListener: (_type, listener) => me.listeners.add(listener),
      removeEventListener: (_type, listener) => me.listeners.delete(listener),
      close: () => members.delete(me),
    };
  };
}

const marks: Bookmark[] = [{ row: 0x40, name: "Boot block" }];

/** A window whose panes answer as `answers` says, recording what it was asked. */
function holder(answers: Partial<Record<PaneId, TakenPane>> = {}) {
  const asked: [PaneId, boolean][] = [];
  const own: PaneHolder = {
    async take(slot, copy) {
      asked.push([slot, copy]);
      return answers[slot] ?? { kind: "refused", reason: "gone" };
    },
    marks: () => marks,
  };
  return { own, asked };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a pane carried between windows", () => {
  it("is announced to the other windows while it is dragged, and forgotten when it is put down", async () => {
    const join = bus();
    const source = paneTransferPeer(join(), holder().own);
    const other = paneTransferPeer(join(), holder().own);
    const heard: unknown[] = [];
    other.onRemoteChange(() => heard.push(other.remote()));
    source.announce({ slot: "b", name: "bios.bin", size: 16 });
    await settle();
    expect(other.remote()).toEqual({ from: source.me, slot: "b", name: "bios.bin", size: 16 });
    source.announceEnd();
    await settle();
    expect(other.remote()).toBeUndefined();
    expect(heard).toHaveLength(2);
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testDroppingOnAnotherWindowsPaneMovesIntoThatSlot
  it("is handed over by the window it is in when another takes it", async () => {
    const join = bus();
    const pane = { id: "a" } as unknown as PaneState;
    const file = { name: "bios.bin" } as unknown as OpenedFile;
    const handed = {
      kind: "pane",
      session: "s-1",
      pane,
      name: "bios.bin",
      file,
      untitled: false,
      writable: true,
      saved: true,
      sources: { next: 0, records: [] },
      marks,
    } as const;
    const source = holder({ a: handed });
    const sourcePeer = paneTransferPeer(join(), source.own);
    const target = paneTransferPeer(join(), holder().own);
    const taken = await target.take(sourcePeer.me, "a", false);
    expect(source.asked).toEqual([["a", false]]);
    expect(taken).toEqual(handed);
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testOptionDroppingOnTheStripCopiesIntoTheNewTab
  it("is copied rather than taken when Option asks for a copy", async () => {
    const join = bus();
    const content = new Blob([new Uint8Array([1, 2, 3])]);
    const source = holder({ b: { kind: "copy", content, name: "ec.bin", marks } });
    const sourcePeer = paneTransferPeer(join(), source.own);
    const target = paneTransferPeer(join(), holder().own);
    const taken = await target.take(sourcePeer.me, "b", true);
    expect(source.asked).toEqual([["b", true]]);
    expect(taken.kind).toBe("copy");
  });

  it("is asked of the window that has it, and no other", async () => {
    const join = bus();
    const first = holder({ a: { kind: "copy", content: new Blob([]), name: "x", marks } });
    const second = holder();
    const firstPeer = paneTransferPeer(join(), first.own);
    paneTransferPeer(join(), second.own);
    const asker = paneTransferPeer(join(), holder().own);
    await asker.take(firstPeer.me, "a", true);
    expect(first.asked).toHaveLength(1);
    expect(second.asked).toHaveLength(0);
  });

  it("stays where it is when its window keeps it", async () => {
    const join = bus();
    const source = holder({ a: { kind: "refused", reason: "gone" } });
    const sourcePeer = paneTransferPeer(join(), source.own);
    const target = paneTransferPeer(join(), holder().own);
    expect(await target.take(sourcePeer.me, "a", false)).toEqual({
      kind: "refused",
      reason: "gone",
    });
  });

  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testAFileDroppedOnTheStripOpensInANewTab
  // @upstream ByteRipperTests/PaneDragTests.swift#PaneDragTests.testTheTornOffTabTakesTheSourceWindowsMarks
  it("brings files dropped on the strip, and the marks of the window they were dropped in", async () => {
    const join = bus();
    const source = paneTransferPeer(join(), holder().own);
    const files = [{ name: "bios.bin" }, { name: "ec.bin" }] as unknown as OpenedFile[];
    const ask = source.offerFiles(files);
    const opened = paneTransferPeer(join(), holder().own);
    const collected = await opened.collect(source.me, ask);
    expect(collected.files).toEqual(files);
    expect(collected.marks).toEqual(marks);
    // Collected once: a second ask finds nothing left.
    expect((await opened.collect(source.me, ask)).files).toEqual([]);
  });
});

// A pane sent on to a new browser tab: the tab is opened with the handover in its address, and
// takes the pane up from the tab that opened it (Open in New Tab).
describe("the handover a new tab is opened with", () => {
  it("comes back from the address as it went in", () => {
    const handover = { kind: "pane", from: "w-1", slot: "part:3", copy: false } as const;
    expect(handoverOfHash(handoverHash(handover))).toEqual(handover);
  });

  it("is nothing for an address that does not carry one, or carries something else", () => {
    expect(handoverOfHash("")).toBeUndefined();
    expect(handoverOfHash("#help/workspace")).toBeUndefined();
    expect(handoverOfHash("#handover=%7Bbroken")).toBeUndefined();
    expect(
      handoverOfHash(`#handover=${encodeURIComponent('{"kind":"files","from":"w"}')}`)
    ).toBeUndefined();
  });
});
