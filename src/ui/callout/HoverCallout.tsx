import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type CalloutMark, hoverCalloutStore } from "@/state/hoverCalloutStore";
import { useStore } from "@/state/useStore";
import { calloutFrame } from "@/ui/callout/calloutFrame";
import { isDarkTheme, saturatedHighlight, zoneHoverHighlight } from "@/ui/theme/hexColors";

/**
 * A small floating capsule — a glyph and a few words on a tooltip's grey, with a shadow — that
 * names the thing under the pointer the moment the pointer reaches it and goes the moment it
 * leaves: a callout, not the browser's tooltip.
 *
 * The browser's tooltip is the wrong instrument for marks the pointer sweeps across: it waits
 * before it appears, the delay cannot be changed, and on a map where a dozen marks sit within a
 * few hundred pixels "point at each in turn" is exactly the gesture (§19.4.3, §20.3).
 *
 * The glyph says what kind of thing is being named, in the shape and colour that thing is drawn
 * in, so the callout is a legend. Over the page rather than inside the view it names, so no pane
 * cuts it off; it opens toward the middle of the view and never leaves the window.
 *
 * The owner shows and hides it (`hoverCalloutStore`); the callout knows nothing about what it
 * names. Deliberately not interactive: a click under the capsule reaches the view it is drawn
 * over, and a screen reader is not told twice what the view already says.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.layOut
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.isShowing
 * @upstream-differs an element over the page, sized by the browser's own text layout, where
 * upstream measures the words and draws them on a material view
 */
export function HoverCallout() {
  const state = useStore(hoverCalloutStore);
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ readonly left: number; readonly top: number } | undefined>(
    undefined
  );

  // Placed once its size is known: beside the anchor, on the side facing the middle of its view,
  // kept inside the window.
  useLayoutEffect(() => {
    const element = ref.current;
    if (state === undefined || element === null) {
      setPlace(undefined);
      return;
    }
    const frame = calloutFrame(
      { width: element.offsetWidth, height: element.offsetHeight },
      state.anchor,
      state.opensRight,
      { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    );
    setPlace({ left: Math.round(frame.x), top: Math.round(frame.y) });
  }, [state]);

  if (state === undefined) return null;
  return createPortal(
    <div
      ref={ref}
      className="hover-callout"
      aria-hidden="true"
      data-placed={place === undefined ? undefined : ""}
      style={place === undefined ? undefined : { left: place.left, top: place.top }}
    >
      {state.mark === undefined ? null : <CalloutGlyph mark={state.mark} />}
      <span className="hover-callout-text">{state.text}</span>
    </div>,
    document.body
  );
}

/**
 * The glyph for `mark`, level with the first line. The tints are washes made to sit under bytes;
 * on the grey they need the louder shade the minimap's strip hovers with (§19.4.4).
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#CalloutContentView.drawGlyph
 * @upstream ByteRipperApp/Window/HoverCallout.swift#CalloutContentView.loud
 */
function CalloutGlyph({ mark }: { readonly mark: CalloutMark }) {
  const dark = isDarkTheme();
  const loud = (color: string) => saturatedHighlight(color, dark);
  let drawn: React.ReactNode;
  switch (mark.kind) {
    case "bookmark":
      // The Offset column's mark in small: a body with a blunt point.
      drawn = (
        <path
          d="M2.5 2h6.5l3.6 4.5L9 11H2.5Z"
          style={{ fill: "var(--bookmark)", stroke: "var(--bookmark)" }}
          strokeWidth="1"
          strokeLinejoin="round"
        />
      );
      break;
    case "segment":
      drawn = (
        <rect
          x="2"
          y="2"
          width="9"
          height="9"
          rx="1.5"
          fill={loud(mark.color)}
          style={{ stroke: "var(--border-strong)" }}
          strokeWidth="0.5"
        />
      );
      break;
    case "cut":
      // The piece before the cut above the line, the one after it below.
      drawn = (
        <>
          <rect x="2" y="1.5" width="9" height="4" rx="1" fill={loud(mark.above)} />
          <rect x="2" y="7.5" width="9" height="4" rx="1" fill={loud(mark.below)} />
          <rect x="1" y="5.75" width="11" height="1.5" style={{ fill: "currentColor" }} />
        </>
      );
      break;
    case "zone":
      drawn = (
        <path
          d="M9 1.5H4.5v10H9"
          fill="none"
          stroke={zoneHoverHighlight(mark.color, dark)}
          strokeWidth="1.6"
        />
      );
      break;
    case "annotation":
      // The note's own look in the dump: a light wash in a dashed frame.
      drawn = (
        <rect
          x="1.5"
          y="2.5"
          width="10"
          height="8"
          rx="2"
          style={{ fill: mark.color, stroke: mark.color }}
          fillOpacity="0.25"
          strokeWidth="1.2"
          strokeDasharray="2 1.5"
        />
      );
      break;
  }
  return (
    <svg
      className="hover-callout-glyph"
      viewBox="0 0 13 13"
      width="13"
      height="13"
      aria-hidden="true"
    >
      {drawn}
    </svg>
  );
}
