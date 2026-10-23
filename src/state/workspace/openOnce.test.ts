import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneState } from "@/core/workspace/workspace";
import type { OpenedFile } from "@/platform/files/openedFile";
import type { SlotId } from "@/state/paneId";
import {
  type ChannelLike,
  type FileRef,
  installOpenOnceForTesting,
  type MovedPane,
  type OpenOnceWindow,
  openOnce,
  openOnceBroker,
  openOnceHooks,
} from "@/state/workspace/openOnce";

const adopted = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/state/workspace/paneTransfer", () => ({
  adoptTaken: async (...args: unknown[]) => {
    adopted.push(args);
  },
  thisWindow: {},
}));

/** A pane as a window lets it go: its session's name and its record. */
const takenPane = (slot: string, pane?: PaneState) =>
  ({
    kind: "pane",
    session: `s-${slot}`,
    pane: pane ?? ({ id: slot } as unknown as PaneState),
    name: "bios.bin",
    file: { name: "bios.bin" } as unknown as OpenedFile,
    untitled: false,
    writable: true,
    saved: true,
    sources: { next: 0, records: [] },
    marks: [],
  }) as const;

// `Design/DESKTOP_WINDOWS.md`, D4: a file open in another window of the desktop shell is shown
// there or brought here, never opened twice. The windows ask one another over a channel.

/** Channels joined into one bus, as `BroadcastChannel`s of one name are: a post reaches the rest. */
function bus(): () => ChannelLike {
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

/** A window holding `paths` in its panes, by path or by a handle that is the same entry. */
function windowHolding(files: Record<string, FileRef>, release?: MovedPane) {
  const seen = { revealed: [] as SlotId[], released: [] as SlotId[] };
  const own: OpenOnceWindow = {
    async holding(file) {
      for (const [slot, held] of Object.entries(files)) {
        if (file.path !== undefined && file.path === held.path) return slot as SlotId;
        if (file.handle !== undefined && file.handle === held.handle) return slot as SlotId;
      }
      return undefined;
    },
    reveal: (slot) => seen.revealed.push(slot),
    async release(slot) {
      seen.released.push(slot);
      return release ?? { taken: takenPane(slot) };
    },
  };
  return { own, seen };
}

const file = (ref: FileRef) => ({ name: "bios.bin", ...ref }) as unknown as OpenedFile;

describe("a file open in another window", () => {
  let join: () => ChannelLike;
  beforeEach(() => {
    adopted.length = 0;
    join = bus();
  });
  afterEach(() => {
    installOpenOnceForTesting();
    openOnceHooks.ask = undefined;
  });

  // @upstream ByteRipperTests/MultiWindowTests.swift#MultiWindowTests.testTheRegistryFindsAFileOpenInAnotherWindow
  it("is found by the window that holds it, by path or by handle", async () => {
    const handle = {} as FileSystemFileHandle;
    const holder = openOnceBroker(
      join(),
      windowHolding({ a: { path: "/d/bios.bin" }, b: { handle } }).own
    );
    const asker = openOnceBroker(join(), windowHolding({}).own);
    expect(await asker.where({ path: "/d/bios.bin" })).toBeDefined();
    expect(await asker.where({ handle })).toBeDefined();
    expect(await asker.where({ path: "/d/ec.bin" })).toBeUndefined();
    holder.close();
    asker.close();
  });

  it("opens here at once when no other window has it", async () => {
    const other = openOnceBroker(join(), windowHolding({}).own);
    installOpenOnceForTesting(openOnceBroker(join(), windowHolding({}).own));
    openOnceHooks.ask = async () => {
      throw new Error("not asked");
    };
    expect(await openOnce("a", file({ path: "/d/bios.bin" }))).toBe(true);
    other.close();
  });

  it("opens here at once in a browser, which has no other windows", async () => {
    installOpenOnceForTesting();
    expect(await openOnce("a", file({ path: "/d/bios.bin" }))).toBe(true);
  });

  // @upstream ByteRipperTests/MultiWindowTests.swift#MultiWindowTests.testOpeningAFileOpenInAnotherWindowGoesToThatWindow
  it("is shown where it is, and not opened here", async () => {
    const holding = windowHolding({ b: { path: "/d/bios.bin" } });
    const other = openOnceBroker(join(), holding.own);
    installOpenOnceForTesting(openOnceBroker(join(), windowHolding({}).own));
    openOnceHooks.ask = async () => "show";
    expect(await openOnce("a", file({ path: "/d/bios.bin" }))).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(holding.seen.revealed).toEqual(["b"]);
    other.close();
  });

  // @upstream ByteRipperTests/MultiWindowTests.swift#MultiWindowTests.testCancellingLeavesEverythingWhereItWas
  it("is left where it is when the question is cancelled", async () => {
    const holding = windowHolding({ a: { path: "/d/bios.bin" } });
    const other = openOnceBroker(join(), holding.own);
    installOpenOnceForTesting(openOnceBroker(join(), windowHolding({}).own));
    openOnceHooks.ask = async () => "cancel";
    expect(await openOnce("a", file({ path: "/d/bios.bin" }))).toBe(false);
    expect(holding.seen).toEqual({ revealed: [], released: [] });
    other.close();
  });

  // @upstream ByteRipperTests/MultiWindowTests.swift#MultiWindowTests.testMovingBringsThePaneItselfAcrossWindows
  // @upstream ByteRipperTests/MultiWindowTests.swift#MultiWindowTests.testMovingCarriesUnsavedEdits
  it("is brought here as its session — its unsaved changes and history in it — with its place", async () => {
    const pane = { id: "a", selectionStart: 7 } as unknown as PaneState;
    const taken = takenPane("a", pane);
    const holding = windowHolding({ a: { path: "/d/bios.bin" } }, { taken });
    const other = openOnceBroker(join(), holding.own);
    installOpenOnceForTesting(openOnceBroker(join(), windowHolding({}).own));
    openOnceHooks.ask = async () => "move";
    const opened = file({ path: "/d/bios.bin" });
    expect(await openOnce("b", opened)).toBe(false);
    expect(holding.seen.released).toEqual(["a"]);
    expect(adopted).toEqual([["b", taken]]);
    other.close();
  });

  it("stays where it is when its window does not answer", async () => {
    const other = openOnceBroker(
      join(),
      windowHolding({ a: { path: "/d/bios.bin" } }, { refused: "unanswered" }).own
    );
    installOpenOnceForTesting(openOnceBroker(join(), windowHolding({}).own));
    openOnceHooks.ask = async () => "move";
    expect(await openOnce("a", file({ path: "/d/bios.bin" }))).toBe(false);
    expect(adopted).toHaveLength(0);
    other.close();
  });

  it("opens here after all when it was closed there meanwhile", async () => {
    const other = openOnceBroker(
      join(),
      windowHolding({ a: { path: "/d/bios.bin" } }, { gone: true }).own
    );
    installOpenOnceForTesting(openOnceBroker(join(), windowHolding({}).own));
    openOnceHooks.ask = async () => "move";
    expect(await openOnce("a", file({ path: "/d/bios.bin" }))).toBe(true);
    other.close();
  });
});
