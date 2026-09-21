import type { PanelId } from "@/state/fragmentDock";

/**
 * Which pane, and how to tell the two kinds apart.
 *
 * A module of its own, below every store, because the *identity* of a pane is
 * what the stores are keyed by: the marks, the segments, the zones, the search
 * results and the workspace itself all take one, and a store that needs to ask
 * "is this one of the workspace's own panes, or a part opened over one?" must
 * not have to reach up into the workspace to find out.
 *
 * `src/state/workspaceStore.ts` re-exports all of it, which is where the rest
 * of the application reads it from.
 */

/** Which slot. File B is optional; with only A the app is in single-file mode. */
export type SlotId = "a" | "b";

export const PANE_IDS: readonly SlotId[] = ["a", "b"];

/** A part opened over the file it came out of, as a pane of its own. */
export type PartId = `part:${number}`;

/** Which pane: one of the workspace's two file slots, or a part in the dock. */
export type PaneId = SlotId | PartId;

/**
 * Whether a pane is one of the workspace's two file slots, as against a part
 * opened over one.
 */
export const isSlot = (pane: PaneId): pane is SlotId => pane === "a" || pane === "b";

/** The pane a panel's part is read as: one spelling of the panel's own id. */
export const partPane = (id: PanelId): PartId => `part:${id}`;

/** The panel a part's pane belongs to. */
export const panelOf = (pane: PartId): PanelId => Number(pane.slice("part:".length)) as PanelId;
