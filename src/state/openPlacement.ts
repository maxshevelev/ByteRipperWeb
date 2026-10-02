import type { SlotId } from "@/state/paneId";

/**
 * Where an open puts its first file — the pure half of the placement, with no
 * store and no page, so it is unit-testable.
 *
 * Dropping onto a pane names its own target (`dragDrop.ts`) and does not come
 * here.
 *
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPanePlacement
 * @upstream-differs a string union over the slots, where upstream has an enum over pane indices
 */
export type OpenPanePlacement =
  /**
   * A file dropped on the window: an empty pane first, otherwise the active one.
   *
   * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPanePlacement.fillFree
   */
  | "fillFree"
  /**
   * Open…, Open Recent: the active pane.
   *
   * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPanePlacement.activePane
   */
  | "activePane"
  /**
   * Compare with…: the pane the active one is compared with.
   *
   * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPanePlacement.otherPane
   */
  | "otherPane";

/**
 * Which slots the files go into.
 *
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.Result
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.Result.firstFilePane
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.Result.openSecond
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.Result.ignoredCount
 * @upstream-differs the slots themselves, in the order the files take them, where upstream
 * reports the first pane and whether a second file opens; `openSecond` is `slots.length > 1`
 */
export interface OpenPlan {
  readonly slots: readonly SlotId[];
  /** How many of the files chosen are left unopened, and have to be said. */
  readonly ignoredCount: number;
}

const other = (slot: SlotId): SlotId => (slot === "a" ? "b" : "a");

/**
 * Both slots empty: picking two files is how a comparison is started from
 * nothing, so the first two fill them; anything beyond is ignored.
 */
function fillingBoth(fileCount: number): OpenPlan {
  const opened = Math.min(fileCount, 2);
  return {
    slots: (["a", "b"] as const).slice(0, opened),
    ignoredCount: Math.max(0, fileCount - 2),
  };
}

function one(slot: SlotId, fileCount: number): OpenPlan {
  return { slots: fileCount >= 1 ? [slot] : [], ignoredCount: Math.max(0, fileCount - 1) };
}

/**
 * A file dropped on the window, or handed over by the system:
 * - no slot occupied → the first two files into the two slots, extras ignored;
 * - one occupied → the first file into the other, all others ignored;
 * - both occupied → the first file replaces the active one, all others ignored.
 *
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.plan
 */
export function planFill(
  active: SlotId,
  aOpen: boolean,
  bOpen: boolean,
  fileCount: number
): OpenPlan {
  if (!aOpen && !bOpen) return fillingBoth(fileCount);
  if (!aOpen) return one("a", fileCount);
  if (!bOpen) return one("b", fileCount);
  return one(active, fileCount);
}

/**
 * Open… and Open Recent: the file goes into the **active** slot, replacing what
 * it holds, and never starts a second pane by itself. Only with both slots empty
 * do the first two files still fill them.
 *
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.planOpen
 */
export function planOpen(
  active: SlotId,
  aOpen: boolean,
  bOpen: boolean,
  fileCount: number
): OpenPlan {
  if (!aOpen && !bOpen) return planFill(active, false, false, fileCount);
  return one(active, fileCount);
}

/**
 * Compare with…: the file goes into the slot the active one is compared with —
 * the free slot if there is one, otherwise the one that is not active. With
 * nothing open there is nothing to compare with, so it is a plain open.
 *
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.planCompare
 */
export function planCompare(
  active: SlotId,
  aOpen: boolean,
  bOpen: boolean,
  fileCount: number
): OpenPlan {
  if (!aOpen && !bOpen) return planFill(active, false, false, fileCount);
  if (!aOpen) return one("a", fileCount);
  if (!bOpen) return one("b", fileCount);
  return one(other(active), fileCount);
}

/** The plan for a placement. */
export function planFor(
  placement: OpenPanePlacement,
  active: SlotId,
  aOpen: boolean,
  bOpen: boolean,
  fileCount: number
): OpenPlan {
  switch (placement) {
    case "fillFree":
      return planFill(active, aOpen, bOpen, fileCount);
    case "activePane":
      return planOpen(active, aOpen, bOpen, fileCount);
    case "otherPane":
      return planCompare(active, aOpen, bOpen, fileCount);
  }
}
