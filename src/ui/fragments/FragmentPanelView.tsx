import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { panelHeight } from "@/ui/fragments/fragmentPanelLayout";
import { DRAG_THRESHOLD } from "@/ui/fragments/pullDown";
import { beginPull, type PulledFold } from "@/ui/fragments/pullGesture";
import { PaneHeaderHostContext } from "@/ui/pane/paneHeaderHost";
import { type Box, playCardMotion } from "@/ui/toolPanel/cardMotion";

/**
 * The area a fragment panel sits in over the panes, and the panel itself
 * (`Design/GAPS.md` G48).
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift
 */

/**
 * The area a fragment panel lies over: exactly the part of the window the panes
 * occupy, so the panel never covers the toolbar above it nor the dock below.
 *
 * **And while it holds a panel it is a wall.** Nothing the mouse does over the
 * area a panel covers may reach the panes behind it — the panes look reachable,
 * because a strip of the file behind shows above the panel on purpose. In a
 * browser the wall is the box itself: an element laid over another takes the
 * pointer, and its events climb its own ancestors rather than the covered
 * pane's. What upstream has to say in fifteen overrides, the web says by the
 * host being there at all — so the host is rendered only while a panel is up,
 * which is the whole of upstream's `hitTest` rule.
 *
 * **A drag is the one thing being in the way does not stop.** Upstream had to
 * register the wall as a drop destination that refuses everything, because a
 * drag does not travel the responder chain and a file let go on a panel landed
 * in the drop zones of the panes underneath. A browser is the same story with
 * different words: the shell listens for the drop at the window, which is above
 * this box and hears it whatever it lands on. So the host answers the drag
 * itself and says no — the gesture stops here rather than opening a file into a
 * pane nobody can see.
 *
 * The panel's height is set here rather than in the stylesheet because the rule
 * is arithmetic with a minimum in it, and because that arithmetic is the thing
 * the tests pin.
 *
 * **While its panel folds away it is no wall.** The panel is going back into its
 * pill and the panes are the reader's again: a click in those 240 ms lands on
 * them, not on an empty box still standing over them.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost.draggingEntered
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost.draggingUpdated
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost.prepareForDragOperation
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost.performDragOperation
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.layoutPanels
 */
export function FragmentPanelHost({
  children,
  folding = false,
}: {
  readonly children: ReactNode;
  /** The panel in it is folding back into its pill. */
  readonly folding?: boolean | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  // Measured before the frame is painted, and again on every resize: a panel
  // that took its height a frame late would open at nothing and jump.
  useLayoutEffect(() => {
    const area = host.current;
    if (area === null) return;
    setHeight(panelHeight(area.getBoundingClientRect().height));
    const observer = new ResizeObserver((entries) => {
      const area = entries[0];
      if (area !== undefined) setHeight(panelHeight(area.contentRect.height));
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  /**
   * Nothing is on offer here: the drag is answered, refused, and kept from the
   * window's own handler behind it.
   */
  const refuseDrag = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "none";
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: refusing a drop is not interactivity of its own.
    <div
      ref={host}
      className="fragment-panel-host"
      data-folding={folding ? "" : undefined}
      style={{ "--fragment-panel-height": `${height}px` } as React.CSSProperties}
      onDragEnter={refuseDrag}
      onDragOver={refuseDrag}
      onDrop={refuseDrag}
    >
      {children}
    </div>
  );
}

/**
 * One fragment panel: the chrome around the part's pane.
 *
 * One header runs across the whole panel, above the tool, the dump and the map: the
 * pane's own title bar — the part's name, the link back to the parent, the ⌄ and the
 * ✕ — taken out of the pane and laid edge to edge. A part is the only file its panel
 * holds, so there is no second name for the tool's header or the map's to say, and
 * nothing for the dump's header to be shared with. The strip is empty until the pane
 * inside has put its bar in it (`PaneHeaderHostContext`).
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelView
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelView.headerHeight
 */
export function FragmentPanel({
  children,
  pill,
  opensOutOfPill = false,
  folding = false,
  onFolded,
  onCollapse,
}: {
  readonly children: ReactNode;
  /** The id of the panel's pill in the dock, which it opens out of and folds back into. */
  readonly pill?: number | undefined;
  /** Brought up from the dock rather than switched to: it grows out of its pill. */
  readonly opensOutOfPill?: boolean | undefined;
  /** Folding back into its pill, to be taken away when that is done. */
  readonly folding?: boolean | undefined;
  readonly onFolded?: (() => void) | undefined;
  /**
   * The pull carried on: fold the panel into its pill. Answers whether it is folding — a panel
   * no longer up when the hand lets go has nothing to fold, and springs back.
   */
  readonly onCollapse?: (() => boolean) | undefined;
}) {
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  const host = useMemo(() => ({ element: strip }), [strip]);
  const panel = useRef<HTMLDivElement | null>(null);
  const foldedRef = useRef(onFolded);
  foldedRef.current = onFolded;

  // Grows out of the pill when it has been brought up, once; a panel switched to from another
  // arrives where the other was, as upstream's does.
  // @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.fly
  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null || !opensOutOfPill) return;
    void playCardMotion(element, pillBox(pill), true);
  }, [opensOutOfPill, pill]);
  // The pull in the hand, if one is: the means to let it go.
  // @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.pulling
  const pulling = useRef<(() => void) | undefined>(undefined);
  // What a pull that carried on into the pill handed on to the fold, once.
  const pulledFold = useRef<PulledFold | undefined>(undefined);
  // A pull is of one panel: another switched in under the hand, or this one gone, ends it where
  // it stands. Upstream's `pullPanel` and `endPull` ask the same before they move anything.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pill` is the reason to let go, not something the body reads — another panel switched in under the hand is what ends the pull
  useLayoutEffect(() => {
    const element = panel.current;
    return () => {
      if (pulling.current === undefined) return;
      pulling.current();
      pulling.current = undefined;
      if (element !== null) element.style.transform = "";
    };
  }, [pill]);
  // And folds back into it, staying folded until it is taken away — from where the hand left
  // it, when it was a pull that began the fold, or when the panel was folded by the keyboard
  // with the pull still under way.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!folding || element === null) return;
    pulling.current?.();
    pulling.current = undefined;
    let cancelled = false;
    const carried = pulledFold.current;
    pulledFold.current = undefined;
    void playCardMotion(element, pillBox(pill), false, carried).then(() => {
      if (!cancelled) foldedRef.current?.();
    });
    return () => {
      cancelled = true;
      // Raised again before it was gone: the fold it was held in is let go, and the panel
      // comes back to where it stands.
      for (const animation of element.getAnimations()) animation.cancel();
      element.style.transform = "";
    };
  }, [folding, pill]);

  // The panel is pulled down by its header — the pane's own, or the tool's — and a pull is told
  // from carrying the pane off by its direction: down, and more down than sideways.
  // @upstream ByteRipperApp/Pane/PaneHeaderView.swift#PaneHeaderView.mouseDragged
  // @upstream ByteRipperApp/Pane/PaneHeaderView.swift#PaneHeaderView.onDownwardDragThresholdPassed
  // @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onHeaderPulledDown
  // @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.onHeaderPulledDown
  // @upstream ByteRipperApp/Fragments/PullDownHandleView.swift#PullDownHandleView.mouseDragged
  // @upstream-differs one handler on the panel hears a press on either header, where upstream hands a hook down to each header that can be pulled
  // Where the press went down, and where the pointer was last seen since.
  const press = useRef<
    { id: number; x: number; y: number; lastX: number; lastY: number } | undefined
  >(undefined);
  const onCollapseRef = useRef(onCollapse);
  onCollapseRef.current = onCollapse;
  // @upstream ByteRipperApp/Fragments/PullDownHandleView.swift#PullDownHandleView.onPulledDown
  const startPull = (id: number, y: number, time: number) => {
    const element = panel.current;
    press.current = undefined;
    if (element === null) return;
    pulling.current = beginPull(element, id, y, time, (fold) => {
      pulling.current = undefined;
      pulledFold.current = fold;
      const folds = onCollapseRef.current?.() ?? false;
      if (!folds) pulledFold.current = undefined;
      return folds;
    });
  };
  const isDownward = (dx: number, dy: number) => dy > 0 && dy > Math.abs(dx);
  // Followed on the window: the press may leave the header before it is a pull. Every handler
  // here reads the press through its ref, so they are put on once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: startPull reads only refs
  useLayoutEffect(() => {
    const onMove = (event: PointerEvent) => {
      const down = press.current;
      if (down === undefined || event.pointerId !== down.id) return;
      down.lastX = event.clientX;
      down.lastY = event.clientY;
      const dx = event.clientX - down.x;
      const dy = event.clientY - down.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (isDownward(dx, dy)) startPull(down.id, event.clientY, event.timeStamp);
      // One gesture per press: anything else is the carrying of the pane, which is the
      // browser's own drag.
      else press.current = undefined;
    };
    // @upstream ByteRipperApp/Fragments/PullDownHandleView.swift#PullDownHandleView.mouseUp
    const onUp = () => {
      press.current = undefined;
      // The pull, if there was one, is decided by its own handler right after this one.
      pulling.current = undefined;
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pull is a gesture on the panel's headers; the keyboard folds it with its own ⌄ and Esc
    <div
      ref={panel}
      className="fragment-panel"
      data-folding={folding ? "" : undefined}
      // @upstream ByteRipperApp/Fragments/PullDownHandleView.swift#PullDownHandleView.mouseDown
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (
          folding ||
          event.button !== 0 ||
          !(target instanceof Element) ||
          target.closest(".fragment-panel-head, .tool-panel-head") === null ||
          target.closest("button, input, select, textarea, a, [contenteditable], [role=menu]") !==
            null
        ) {
          return;
        }
        press.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
        };
      }}
      // The pane's header is draggable, and the browser's drag would take the press from a
      // pull that has not been noticed yet: a drag that begins downward is the pull.
      onDragStartCapture={(event) => {
        // A pull already under way owns the press: no second gesture is begun beside it.
        if (document.body.hasAttribute("data-pulling-panel")) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const down = press.current;
        if (down === undefined) return;
        // Measured to where the pointer was last seen, not to the drag's own event: Blink and
        // WebKit give that the press's coordinates. The browser has already decided the press
        // moved — its threshold can be under ours — so the direction is all that is asked.
        if (isDownward(down.lastX - down.x, down.lastY - down.y)) {
          event.preventDefault();
          event.stopPropagation();
          startPull(down.id, down.lastY, event.timeStamp);
        } else {
          press.current = undefined;
        }
      }}
    >
      <div ref={setStrip} className="fragment-panel-head" data-active="" />
      <PaneHeaderHostContext.Provider value={host}>{children}</PaneHeaderHostContext.Provider>
    </div>
  );
}

/**
 * Where a panel's pill is in the window, which the panel's motion starts and ends at. Nothing
 * when the dock has no pill for it, or one not laid out yet: there is nothing to fold into.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.pillRect
 * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.pillFrame
 */
function pillBox(pill: number | undefined): Box | undefined {
  if (pill === undefined) return undefined;
  const element = document.querySelector(`[data-pill="${pill}"]`);
  if (element === null) return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return undefined;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}
