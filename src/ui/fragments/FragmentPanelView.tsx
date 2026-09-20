import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { panelHeight } from "@/ui/fragments/fragmentPanelLayout";

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
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost.draggingEntered
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost.draggingUpdated
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost.prepareForDragOperation
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost.performDragOperation
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.layoutPanels
 */
export function FragmentPanelHost({ children }: { readonly children: ReactNode }) {
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
 * It carries no header of its own. The header with the part's name is the
 * pane's own — the requirement that the panel look like an ordinary hex panel
 * is met by it being one.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelView
 */
export function FragmentPanel({ children }: { readonly children: ReactNode }) {
  return <div className="fragment-panel">{children}</div>;
}
