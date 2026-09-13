import { useCallback, useRef } from "react";

/**
 * The handle on a side panel's edge that sets the panel's width.
 *
 * One component for both side panels, because the tool panel on the left and
 * the minimap on the right are the same gesture mirrored: each is anchored to a
 * window edge, so its width is the distance from the pointer to that edge, and
 * which arrow key means "wider" follows from which edge the handle is on.
 * Keyboard-reachable for the reason the pane divider is: a layout only a pointer
 * can change is a layout some people cannot change.
 */

export interface EdgeSplitterProps {
  /** The panel edge the handle sits on: the minimap's left, the tool panel's right. */
  readonly edge: "left" | "right";
  readonly label: string;
  /** The panel's width in CSS pixels. */
  readonly width: number;
  readonly min: number;
  readonly max: number;
  /** Where a double-click, Home or Enter puts the width back to. */
  readonly initial: number;
  /** Receives the width asked for; clamping and remembering it is the store's job. */
  readonly onChange: (width: number) => void;
}

export function EdgeSplitter({
  edge,
  label,
  width,
  min,
  max,
  initial,
  onChange,
}: EdgeSplitterProps) {
  const dragging = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const panel = event.currentTarget.parentElement;
      if (panel === null) return;
      const bounds = panel.getBoundingClientRect();
      onChange(edge === "left" ? bounds.right - event.clientX : event.clientX - bounds.left);
    },
    [edge, onChange]
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 24 : 8;
      const wider = edge === "left" ? "ArrowLeft" : "ArrowRight";
      const narrower = edge === "left" ? "ArrowRight" : "ArrowLeft";
      if (event.key === wider) onChange(width + step);
      else if (event.key === narrower) onChange(width - step);
      else if (event.key === "Home" || event.key === "Enter") onChange(initial);
      else return;
      event.preventDefault();
    },
    [edge, width, initial, onChange]
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged
    <div
      className="edge-splitter"
      data-edge={edge}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={onKeyDown}
    />
  );
}
