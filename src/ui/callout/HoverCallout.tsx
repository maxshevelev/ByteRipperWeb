import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CALLOUT_GLYPH_WIDTH,
  type CalloutRect,
  capsuleFrame,
  type HoverMark,
  opensRight,
} from "@/ui/callout/hoverCalloutGeometry";
import { isDarkTheme, saturatedHighlight, zoneHoverHighlight } from "@/ui/theme/hexColors";

/**
 * What a view tells its callout. The owner shows and hides it; the callout
 * knows nothing about what it names.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout
 */
export interface HoverCalloutHandle {
  /**
   * Shows `text`, with the glyph for `mark`, beside `anchor` — a rect in the
   * window's coordinates — on the side of it facing the middle of `view`. A
   * capsule that does not fit on that side opens on the other one, and either
   * way it is kept inside the window. An empty text hides it.
   *
   * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.show
   */
  show(text: string, mark: HoverMark | undefined, anchor: CalloutRect, view: CalloutRect): void;
  /**
   * Takes the capsule off screen. Cheap when it is not showing, so an owner can
   * call it on every event after which a callout would be lying.
   *
   * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.hide
   */
  hide(): void;
}

interface Showing {
  /** What the capsule says. @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.text */
  readonly text: string;
  /** The glyph it wears. @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.mark */
  readonly mark: HoverMark | undefined;
  readonly anchor: CalloutRect;
  readonly view: CalloutRect;
}

const sameRect = (a: CalloutRect, b: CalloutRect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const sameMark = (a: HoverMark | undefined, b: HoverMark | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

/** A DOM rect as the callout's own. */
export function calloutRect(rect: {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}): CalloutRect {
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * A small capsule — a glyph and a few words on the tooltip's grey, with a
 * shadow — that names the thing under the pointer the moment the pointer
 * reaches it and goes the moment it leaves.
 *
 * The glyph says what kind of thing is being named, in the shape and colour
 * that thing is drawn in, so the callout is a legend: what the eye sees on the
 * map is what the callout shows beside the words.
 *
 * Drawn over the window's content rather than inside the view that owns it:
 * the minimap is a narrow panel, and a note's words would be cut off by the
 * dump's edge. A transient overlay, not a panel of the dock — it has no pill,
 * takes no focus and no clicks (`pointer-events: none`), so a click under the
 * capsule reaches the view it is drawn over.
 *
 * The one rule it keeps by itself is that a window which loses the focus takes
 * its callout away: the pointer's events stop arriving then, so nothing else
 * would ever say that the callout is now out of date. A resize of the window is
 * the other: every view under it moves.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.init
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.observeKey
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.hitTest
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.isAccessibilityElement
 * @upstream-differs a fixed element in a portal over the page, laid out by CSS; upstream's material, wash and rim are the stylesheet's `.hover-callout`
 */
export function HoverCallout({ ref }: { ref: Ref<HoverCalloutHandle> }) {
  const [showing, setShowing] = useState<Showing | undefined>(undefined);

  useImperativeHandle(
    ref,
    () => ({
      show(text, mark, anchor, view) {
        if (text.length === 0) {
          setShowing(undefined);
          return;
        }
        setShowing((before) =>
          before !== undefined &&
          before.text === text &&
          sameMark(before.mark, mark) &&
          sameRect(before.anchor, anchor) &&
          sameRect(before.view, view)
            ? before
            : { text, mark, anchor, view }
        );
      },
      hide() {
        setShowing(undefined);
      },
    }),
    []
  );

  // The window losing the focus, or changing its size, makes any callout a lie.
  useEffect(() => {
    if (showing === undefined) return;
    const hide = () => setShowing(undefined);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [showing]);

  const element = useRef<HTMLDivElement>(null);
  // Placed once its size is known — before the frame is painted, so it never
  // shows where it was measured.
  useLayoutEffect(() => {
    const capsule = element.current;
    if (capsule === null || showing === undefined) return;
    const size = capsule.getBoundingClientRect();
    const frame = capsuleFrame(
      { width: size.width, height: size.height },
      showing.anchor,
      opensRight(showing.anchor, showing.view),
      { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
    );
    capsule.style.left = `${Math.round(frame.x)}px`;
    capsule.style.top = `${Math.round(frame.y)}px`;
    capsule.style.visibility = "visible";
  }, [showing]);

  if (showing === undefined) return null;
  return createPortal(
    <div
      ref={element}
      className="hover-callout"
      // The words are what the pointer is over, and say nothing a reader does
      // not already get from the view it is drawn over.
      aria-hidden="true"
      data-mark={showing.mark?.kind}
      style={{ left: 0, top: 0, visibility: "hidden" }}
    >
      {showing.mark === undefined ? null : <CalloutGlyph mark={showing.mark} />}
      <span className="hover-callout-text">{showing.text}</span>
    </div>,
    document.body
  );
}

/**
 * The glyph before the words, level with the first line: the thing's own shape
 * in its own colour. The tints are washes made to sit under bytes; on the grey
 * they need the louder shade the minimap's strip hovers with (§19.4.4).
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#CalloutContentView
 */
function CalloutGlyph({ mark }: { mark: HoverMark }) {
  const dark = isDarkTheme();
  const loud = (tint: string) => saturatedHighlight(tint, dark);
  // The box upstream draws in: the glyph's column, a line high, its middle on
  // whole pixels.
  const mid = 7;
  let shape: React.ReactNode;
  switch (mark.kind) {
    case "bookmark":
      // The Offset column's mark in small: a body with a blunt point.
      shape = (
        <path
          d={`M${mid - 6} ${mid - 4.5}H${mid + 2}L${mid + 6} ${mid}L${mid + 2} ${mid + 4.5}H${mid - 6}Z`}
          fill="var(--bookmark)"
        />
      );
      break;
    case "segment":
      shape = (
        <rect
          x={mid - 4.5}
          y={mid - 4.5}
          width={9}
          height={9}
          rx={1.5}
          fill={loud(mark.tint)}
          stroke="var(--border-strong)"
          strokeWidth={0.5}
        />
      );
      break;
    case "cut":
      // The piece before the cut above the line, the one after it below.
      shape = (
        <>
          <rect x={mid - 4.5} y={mid - 5} width={9} height={4} rx={1} fill={loud(mark.above)} />
          <rect x={mid - 4.5} y={mid + 1} width={9} height={4} rx={1} fill={loud(mark.below)} />
          <rect x={mid - 5.5} y={mid - 0.75} width={11} height={1.5} fill="var(--text)" />
        </>
      );
      break;
    case "zone":
      shape = (
        <path
          d={`M${mid + 2.5} ${mid - 5}H${mid - 2}V${mid + 5}H${mid + 2.5}`}
          fill="none"
          stroke={zoneHoverHighlight(mark.color, dark)}
          strokeWidth={1.6}
        />
      );
      break;
    case "annotation":
      // The note's own look in the dump: a light wash in a dashed frame.
      shape = (
        <rect
          x={mid - 5}
          y={mid - 4}
          width={10}
          height={8}
          rx={2}
          fill={mark.color}
          fillOpacity={0.25}
          stroke={mark.color}
          strokeWidth={1.2}
          strokeDasharray="2 1.5"
        />
      );
      break;
  }
  return (
    <svg
      className="hover-callout-glyph"
      width={CALLOUT_GLYPH_WIDTH}
      height={14}
      viewBox={`0 0 ${CALLOUT_GLYPH_WIDTH} 14`}
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}
