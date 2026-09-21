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

/**
 * A surface: the composite below the find bar — the split, the panes, the
 * minimap and its feed, the tool session — of which the workspace has one and
 * every open part another.
 *
 * Upstream lifted it out of the window into a `DocumentSurface` so a part could
 * have one of its own; here the composite is React already, so what a surface
 * *is* on this side is the key the stores of those things are kept under.
 *
 * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface
 */
export type SurfaceId = "panes" | PartId;

/**
 * The workspace's own surface: its two file slots and what they share.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.surface
 */
export const WORKSPACE_SURFACE = "panes";

/**
 * The surface a pane belongs to. The two file slots share one, because they
 * are a comparison — one minimap pair, one tool panel, one split. A part is a
 * surface of its own, which is the whole of what a panel is.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.surface
 */
export const surfaceOf = (pane: PaneId): SurfaceId => (isSlot(pane) ? WORKSPACE_SURFACE : pane);

/** The pane a panel's part is read as: one spelling of the panel's own id. */
export const partPane = (id: PanelId): PartId => `part:${id}`;

/** The panel a part's pane belongs to. */
export const panelOf = (pane: PartId): PanelId => Number(pane.slice("part:".length)) as PanelId;
