import { useEffect, useState } from "react";
import type { OriginState } from "@/state/documentOrigin";
import { updateInParentItem } from "@/state/partUpdate";
import { useSettledEdits } from "@/state/useSettledEdits";
import { type PaneId, type PartId, paneState } from "@/state/workspaceStore";

/**
 * What a part's header says about where it came from, and what Update in
 * Parent would be called and whether it could do anything.
 *
 * Both answers read bytes — the source in the parent, the part's own — so both
 * are worked out off the render and kept here. They are asked again once the
 * bytes have settled, which is what the link's verdicts are about; the link
 * itself caches against each side's content generation, so an ask that changes
 * nothing costs a comparison of two numbers.
 *
 * @upstream ByteRipperApp/Pane/PaneHeaderView.swift#PaneHeaderView.originLink
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.validateUpdateInParent
 */
export interface PartLink {
  /** What the part is called in the parent. */
  readonly partName: string;
  /** The sentence the pointer gets. */
  readonly explanation: string;
  readonly state: OriginState;
  /** What the Update in Parent item is called, and whether it can act. */
  readonly update: { readonly title: string; readonly enabled: boolean };
}

export function usePartLink(pane: PaneId): PartLink | undefined {
  const version = useSettledEdits();
  const [link, setLink] = useState<PartLink | undefined>(undefined);
  const origin = paneState(pane)?.origin;

  // `version` is in the list on purpose, and Biome is told so: the verdicts
  // are about bytes, and nothing else here changes when those do.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tick is the input
  useEffect(() => {
    let cancelled = false;
    const slot = paneState(pane);
    if (origin === undefined || slot === undefined) {
      setLink(undefined);
      return;
    }
    void (async () => {
      const state = await origin.state();
      const update = await updateInParentItem(pane);
      if (cancelled) return;
      setLink({
        partName: origin.partName,
        explanation: origin.explanationFor(state),
        state,
        update,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [origin, pane, version]);

  return link;
}

/**
 * The parts holding bytes their parent has not got back — the dot on a pill.
 *
 * A part with no link falls back to its own unsaved work, which is upstream's
 * own fallback and the only honest answer for a document nothing is waiting
 * for.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.fragmentHasSomethingToLose
 */
export function usePartsWithChanges(parts: readonly PartId[]): ReadonlySet<PartId> {
  const version = useSettledEdits();
  const [held, setHeld] = useState<ReadonlySet<PartId>>(new Set());
  const key = parts.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: the tick and the list are the inputs
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = new Set<PartId>();
      for (const pane of parts) {
        const slot = paneState(pane);
        if (slot === undefined) continue;
        const changed =
          slot.origin === undefined
            ? slot.document.isDirty
            : await slot.origin.hasChanges(slot.document);
        if (changed) found.add(pane);
      }
      if (!cancelled) setHeld(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  return held;
}
