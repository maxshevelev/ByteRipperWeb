import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  isSlot,
  openPart,
  type PaneId,
  paneState,
  partPane,
  workspaceStore,
} from "@/state/workspaceStore";
import { publishZones } from "@/state/zoneStore";
import type { Zone } from "@/tools/zone";
import { isMenuAction, type MenuEntry } from "@/ui/shell/menuModel";
import { dumpMenu, type PaneMenuActions } from "@/ui/shell/paneMenus";

/**
 * Open Zone: the one route a zone takes out of the dump.
 *
 * Upstream drives this through `MainViewController` and reads the tab that
 * opened; here the menu is a value and the panel is a part in the workspace, so
 * the item is picked and the part it left behind is read.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openZone
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.addZoneMenuItems
 */

afterEach(() => {
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

/** Sixteen bytes, each its own offset, so a part's bytes say where they are from. */
const source = Uint8Array.from({ length: 16 }, (_, index) => index);

const zone = (id: string, name: string, start: number, end: number): Zone => ({
  id,
  name,
  start,
  end,
  kind: "plain",
});

/** Nothing here calls the shell back: Open Zone is the store's own act. */
const actions = {
  onNew: () => {},
  onOpen: () => {},
  onSave: () => {},
  onSaveAs: () => {},
  onRename: () => {},
  onRevert: () => {},
  onDuplicate: () => {},
  onClose: () => {},
  onFill: () => {},
  onDeleteBytes: () => {},
  onSelectBlockFrom: () => {},
  onSplitHere: () => {},
  onSelectZone: () => {},
  onSegments: () => {},
  onJoin: () => {},
  onProblem: () => {},
  onMessage: () => {},
} satisfies PaneMenuActions;

const labels = (entries: readonly (MenuEntry | undefined)[]): string[] =>
  entries
    .filter((entry) => entry !== undefined)
    .flatMap((entry) => {
      return isMenuAction(entry) ? [entry.label] : [];
    });

const pick = (entries: readonly (MenuEntry | undefined)[], label: string): void => {
  const found = entries.find(
    (entry) => entry !== undefined && isMenuAction(entry) && entry.label === label
  );
  if (found === undefined || !isMenuAction(found)) throw new Error(`no item named ${label}`);
  found.onSelect();
};

/** The parts the dock holds, newest last. */
const parts = (): PaneId[] => workspaceStore.getSnapshot().dock.panels.map((id) => partPane(id));

/**
 * The part the last Open Zone left behind. Waited for rather than read at once:
 * the bytes are read out of the document, and a read is a promise however
 * small the range.
 */
async function opened(): Promise<PaneId> {
  for (let tries = 0; tries < 100 && parts().length < 2; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const last = parts().at(-1);
  if (last === undefined || parts().length < 2) throw new Error("no part was opened");
  return last;
}

/** A pane holding `source`, and a menu over one of its bytes. */
function dumpWithZones(zones: readonly Zone[], offset: number) {
  const pane = openPart(source, "1.bin");
  publishZones(pane, { zones, focus: undefined });
  const slot = paneState(pane);
  if (slot === undefined) throw new Error("the pane should be open");
  return { pane, menu: dumpMenu(workspaceStore.getSnapshot(), pane, offset, actions) };
}

describe("the zone block", () => {
  /**
   * One item per zone, innermost first — the same order and the same wording
   * the Select and Save items use, so the three read as one block.
   */
  it("offers every zone under the pointer by name", () => {
    const { menu } = dumpWithZones([zone("t", "FIT table", 0, 16), zone("r", "#2 Row", 4, 8)], 5);

    expect(labels(menu)).toEqual(
      expect.arrayContaining([`Open Zone “#2 Row”`, `Open Zone “FIT table”`])
    );
    const open = labels(menu).filter((label) => label.startsWith("Open Zone"));
    expect(open).toEqual([`Open Zone “#2 Row”`, `Open Zone “FIT table”`]);
  });

  it("offers nothing where the tool published no zone over the byte", () => {
    const { menu } = dumpWithZones([zone("r", "#2 Row", 4, 8)], 12);

    expect(labels(menu).filter((label) => label.startsWith("Open Zone"))).toEqual([]);
  });
});

describe("opening a zone", () => {
  it("takes the zone's own bytes out as a part of their own", async () => {
    const { menu } = dumpWithZones([zone("r", "#2 Row", 4, 8)], 5);

    pick(menu, `Open Zone “#2 Row”`);

    const pane = await opened();
    const part = paneState(pane);
    expect(isSlot(pane)).toBe(false);
    expect(await part?.document.size).toBe(4);
    expect(Array.from((await part?.document.read(0, 4)) ?? [])).toEqual([4, 5, 6, 7]);
  });

  /**
   * The name is the export's: the file's stem and the zone's own name, so a
   * part and the file the same zone would have been saved to are called the
   * same thing.
   */
  it("names the part after the file it came out of and the zone", async () => {
    const { menu } = dumpWithZones([zone("r", "#2 Row", 4, 8)], 5);

    pick(menu, `Open Zone “#2 Row”`);

    expect(paneState(await opened())?.name).toBe("1_#2 Row.bin");
  });

  /** A nameless zone falls back to its range, as the saved file does. */
  it("names a nameless zone by where it is", async () => {
    const { menu } = dumpWithZones([zone("r", "", 4, 8)], 5);

    pick(menu, `Open Zone “”`);

    expect(paneState(await opened())?.name).toBe("1_00000004-00000008.bin");
  });

  /** The dump it came out of is untouched, and stays where it was. */
  it("leaves the pane it was opened from alone", async () => {
    const { pane, menu } = dumpWithZones([zone("r", "#2 Row", 4, 8)], 5);

    pick(menu, `Open Zone “#2 Row”`);
    await opened();

    expect(await paneState(pane)?.document.size).toBe(16);
    expect(parts()).toHaveLength(2);
  });
});
