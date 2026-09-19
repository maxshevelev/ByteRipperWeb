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
 * The panel's height is set here rather than in the stylesheet because the rule
 * is arithmetic with a minimum in it, and because that arithmetic is the thing
 * the tests pin.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanelView.swift#FragmentPanelHost
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

  return (
    <div
      ref={host}
      className="fragment-panel-host"
      style={{ "--fragment-panel-height": `${height}px` } as React.CSSProperties}
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
