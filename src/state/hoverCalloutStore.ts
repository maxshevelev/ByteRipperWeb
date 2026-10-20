import { createStore } from "@/state/store";

/**
 * What the hover callout is naming, which decides its glyph. The colours are the ones the thing
 * itself is drawn with; the glyph makes them louder where they are washes, so they still read on
 * the grey.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.Mark
 */
export type CalloutMark =
  /** A bookmark (§20.4): the Offset column's purple pentagon. */
  | { readonly kind: "bookmark" }
  /** A piece of the segment partition (§21.3), in its tint. */
  | { readonly kind: "segment"; readonly color: string }
  /** A cut (§21.2): the piece before it above the line, the one after it below. */
  | { readonly kind: "cut"; readonly above: string; readonly below: string }
  /** A tool-module's zone (§19.4.5), in its bracket's colour. */
  | { readonly kind: "zone"; readonly color: string }
  /** A note on the bytes (`AgentAnnotation`), in its author's hue. */
  | { readonly kind: "annotation"; readonly color: string };

/** A rect on the page, in the viewport's coordinates. */
export interface CalloutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The callout up: what it says, the glyph it wears, the rect on the page it stands beside, and the
 * side it opens to. One at a time — the pointer is over one thing.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.text
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.mark
 */
export interface HoverCalloutState {
  readonly text: string;
  readonly mark: CalloutMark | undefined;
  readonly anchor: CalloutRect;
  readonly opensRight: boolean;
  /** Who put it up: the view whose events take it down again. */
  readonly owner: string;
}

export const hoverCalloutStore = createStore<HoverCalloutState | undefined>(undefined);

/**
 * Shows `text`, with the glyph for `mark`, beside `anchor` — on the side of it facing the middle
 * of `view`, so a mark in a left margin opens its callout to the right and one in a right margin
 * to the left. An empty text hides it.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.show
 */
export function showCallout(
  owner: string,
  text: string,
  mark: CalloutMark | undefined,
  anchor: CalloutRect,
  view: CalloutRect
): void {
  if (text.length === 0) {
    hideCallout(owner);
    return;
  }
  const opensRight = anchor.x + anchor.width / 2 <= view.x + view.width / 2;
  const now = hoverCalloutStore.getSnapshot();
  if (
    now !== undefined &&
    now.owner === owner &&
    now.text === text &&
    now.opensRight === opensRight &&
    sameMark(now.mark, mark) &&
    sameRect(now.anchor, anchor)
  ) {
    return;
  }
  hoverCalloutStore.update(() => ({ text, mark, anchor, opensRight, owner }));
}

/**
 * Takes the callout down — `owner`'s only, when one is named, so a view's leave cannot take down
 * the callout another has put up since. Cheap when none is up, so an owner can call it on every
 * event after which a callout would be lying.
 *
 * @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.hide
 */
export function hideCallout(owner?: string): void {
  const now = hoverCalloutStore.getSnapshot();
  if (now === undefined || (owner !== undefined && now.owner !== owner)) return;
  hoverCalloutStore.update(() => undefined);
}

const sameRect = (a: CalloutRect, b: CalloutRect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const sameMark = (a: CalloutMark | undefined, b: CalloutMark | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// A window that loses the focus stops sending the pointer's moves, so nothing else would ever say
// that the callout is now out of date.
// @upstream ByteRipperApp/Window/HoverCallout.swift#HoverCallout.observeKey
if (typeof window !== "undefined") window.addEventListener("blur", () => hideCallout());
