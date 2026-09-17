import { useCallback } from "react";
import type { PaneLayout } from "@/state/workspaceStore";
import { usePointerDrag } from "@/ui/shell/pointerDrag";

/**
 * The handle between the two panes.
 *
 * AppKit's split view does not port — the module map says so — and CSS grid
 * with a handle is the web's answer. What has to survive the change is the
 * behaviour: drag to resize, double-click to go back to even, and a keyboard
 * route, because a divider only reachable with a pointer is a layout some
 * people simply cannot change.
 */

/** Neither pane may be squeezed below this share of the workspace. */
const MIN_FRACTION = 0.15;

const clamp = (value: number) => Math.min(1 - MIN_FRACTION, Math.max(MIN_FRACTION, value));

export interface PaneDividerProps {
  readonly layout: PaneLayout;
  /** The first item's share of the space, 0–1. */
  readonly fraction: number;
  readonly onChange: (fraction: number) => void;
  /** Where a double-click, Home or Enter puts it back — even, unless told. */
  readonly initial?: number;
  readonly label?: string;
}

/**
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.splitView
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.dividerThicknessValue
 */
export function PaneDivider({
  layout,
  fraction,
  onChange,
  initial = 0.5,
  label = "Resize the panes",
}: PaneDividerProps) {
  // The gesture itself is `usePointerDrag`'s — the same one the panel edges and
  // the table columns use, and the same one that must not run without a button
  // held. It used to be a ref set here, captured "if possible" and cleared on a
  // release that a refused capture never delivered: a drag that never ended,
  // and a divider that followed the pointer the next time it crossed.
  const drag = usePointerDrag<HTMLDivElement>((_start, event) => {
    const parent = event.currentTarget.parentElement;
    if (parent === null) return;
    const bounds = parent.getBoundingClientRect();
    const next =
      layout === "sideBySide"
        ? (event.clientX - bounds.left) / bounds.width
        : (event.clientY - bounds.top) / bounds.height;
    onChange(clamp(next));
  });

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      const back = layout === "sideBySide" ? "ArrowLeft" : "ArrowUp";
      const forward = layout === "sideBySide" ? "ArrowRight" : "ArrowDown";

      if (event.key === back) onChange(clamp(fraction - step));
      else if (event.key === forward) onChange(clamp(fraction + step));
      else if (event.key === "Home" || event.key === "Enter") onChange(initial);
      else return;
      event.preventDefault();
    },
    [fraction, layout, onChange, initial]
  );

  return (
    // A focusable `separator` with aria-valuenow is the ARIA pattern for a
    // splitter, and an <hr> — which is what the linter would rather see — is
    // not something anyone can drag.
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged
    <div
      className="pane-divider"
      data-layout={layout}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={layout === "sideBySide" ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={Math.round(MIN_FRACTION * 100)}
      aria-valuemax={Math.round((1 - MIN_FRACTION) * 100)}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      onLostPointerCapture={drag.onLostPointerCapture}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={onKeyDown}
    />
  );
}
