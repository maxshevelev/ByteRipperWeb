import { useCallback, useRef } from "react";
import type { PaneLayout } from "@/state/workspaceStore";

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
  const draggingRef = useRef(false);

  const fractionAt = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const parent = event.currentTarget.parentElement;
      if (parent === null) return undefined;
      const bounds = parent.getBoundingClientRect();
      return layout === "sideBySide"
        ? (event.clientX - bounds.left) / bounds.width
        : (event.clientY - bounds.top) / bounds.height;
    },
    [layout]
  );

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    // Capture keeps the drag steering after the pointer leaves the handle.
    // Failing to get it is not a reason to refuse the drag — it just stops at
    // the handle's edge.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No active pointer with that id; carry on without capture.
    }
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const next = fractionAt(event);
      if (next !== undefined) onChange(clamp(next));
    },
    [fractionAt, onChange]
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
  }, []);

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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={onKeyDown}
    />
  );
}
