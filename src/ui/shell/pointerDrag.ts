import { useCallback, useRef } from "react";

/**
 * The pointer gesture behind every handle in this app: the divider between the
 * panes, the edges of the side panels, and a table's column boundaries.
 *
 * One module, because those three had three copies of the same few lines and
 * the same bug in them. A drag remembered in a ref is only ever cleared by an
 * event that arrives — and the one event that may not arrive is the one that
 * ends it. A button released outside the window, a capture the browser refused
 * (which `PaneDivider` deliberately carries on without), a context menu taken
 * mid-drag, a second finger on a touch screen: any of those and the ref stays
 * set. Then the next time the pointer merely *crosses* the handle, the layout
 * follows it with no button held at all — rare, and it reads as the handle
 * moving on its own.
 *
 * So what the ref remembers is checked against the pointer events themselves
 * rather than trusted. A drag may only be started by a press of the primary
 * button, and once started it only continues while that button is still down: a
 * move with nothing held is a hover, whatever the ref says, and it ends the
 * drag where it stands rather than refusing to.
 *
 * The two decisions are exported as functions, so what they say can be checked
 * without a browser — as the row marks' are.
 */

/** Whether this pointer event may begin a drag: the primary button, and nothing else. */
export function startsDrag(event: {
  readonly button: number;
  readonly isPrimary: boolean;
}): boolean {
  return event.button === 0 && event.isPrimary;
}

/**
 * Whether a pointer move still belongs to the drag: the button is still held.
 *
 * `buttons` is a bitfield and bit 0 is the primary button. It is 0 for a
 * pointer that is only hovering, and for a pen that is only near the screen.
 */
export function continuesDrag(event: { readonly buttons: number }): boolean {
  return (event.buttons & 1) !== 0;
}

/** Where the drag began, in viewport coordinates. */
export interface DragStart {
  readonly clientX: number;
  readonly clientY: number;
}

export interface PointerDragHandlers<E extends HTMLElement> {
  readonly onPointerDown: (event: React.PointerEvent<E>) => void;
  readonly onPointerMove: (event: React.PointerEvent<E>) => void;
  readonly onPointerUp: (event: React.PointerEvent<E>) => void;
  readonly onPointerCancel: (event: React.PointerEvent<E>) => void;
  readonly onLostPointerCapture: (event: React.PointerEvent<E>) => void;
}

/**
 * Calls `moved` while the primary button is held, from the press to the
 * release — and never otherwise, however the last drag ended.
 *
 * The pointer is captured on the way down so the drag keeps steering after the
 * pointer leaves the handle. A capture the browser refuses is a drag that is
 * not started: without it the release goes to whatever is under the pointer
 * instead of here, and this would be the very case the module exists to stop.
 *
 * `onBegin` runs once the drag is really on, for a handle that has something to
 * note at the press — the width a boundary started at, say. What it writes is a
 * payload the move reads, never a second opinion about whether the drag is
 * running, so it cannot go stale in the way this module exists to fix.
 */
export function usePointerDrag<E extends HTMLElement>(
  moved: (start: DragStart, event: React.PointerEvent<E>) => void,
  onBegin?: (event: React.PointerEvent<E>) => void
): PointerDragHandlers<E> {
  const start = useRef<DragStart | undefined>(undefined);

  const finish = useCallback((event: React.PointerEvent<E>) => {
    start.current = undefined;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release: the capture went away on its own, which is one of
      // the ways this drag may have ended.
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<E>) => {
      if (!startsDrag(event)) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      start.current = { clientX: event.clientX, clientY: event.clientY };
      onBegin?.(event);
      event.preventDefault();
    },
    [onBegin]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<E>) => {
      const began = start.current;
      if (began === undefined) return;
      if (!continuesDrag(event)) {
        // A hover. The button was let go somewhere the release never reached.
        finish(event);
        return;
      }
      moved(began, event);
    },
    [moved, finish]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };
}
