/**
 * The large view's motion: the card opens out of the details pane it was lifted from and
 * folds back into it.
 *
 * The card keeps its own size throughout and is *revealed* — a `clip-path` that grows from
 * the pane's rectangle to the card's — rather than scaled or resized, so its text is never
 * stretched and nothing is laid out again on a frame: what moves is a clip over a layer the
 * browser already holds. The clip runs on past the card's edge by `SHADOW_ROOM` at the end, so
 * the shadow is not cut off while it is open.
 *
 * The fragment panels use the same motion: a panel grows out of its pill in the dock and folds
 * back into it, as upstream's flight onto the pill does with a transform.
 *
 * @web-only upstream's card is an `NSView` that appears; this is the page's own motion
 */

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Room left past the card's edges at the end of the reveal, for its shadow. */
export const SHADOW_ROOM = 48;
export const OPEN_MS = 240;
export const CLOSE_MS = 240;

/**
 * The `clip-path` that shows only `from` of a card standing at `card`: the card's own box
 * pulled in on each side to where the pane's box is.
 */
export function revealFrom(from: Box, card: Box): string {
  const top = Math.round(from.top - card.top);
  const right = Math.round(card.right - from.right);
  const bottom = Math.round(card.bottom - from.bottom);
  const left = Math.round(from.left - card.left);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round 6px)`;
}

/** The clip with the whole card, and its shadow, showing. */
export const REVEALED = `inset(-${SHADOW_ROOM}px -${SHADOW_ROOM}px -${SHADOW_ROOM}px -${SHADOW_ROOM}px round 6px)`;

/** Whether the reader asked for less motion; nothing here moves then. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Plays the card's motion and answers when it is over. `opening` grows it out of `from`;
 * otherwise it folds back into it and stays folded, for the caller to take down.
 *
 * Nothing moves — and the answer is at once — without a source box, without the browser's
 * animations, or when the reader asked for less motion.
 *
 * The card is measured where it is seen. An element moved by a transform of its own — a panel
 * pulled down by hand — carries its clip with it, so the clip is worked out against the moved
 * box, not the one the layout gave it. `duration` replaces the usual time, for a fold that is
 * carrying on from part of the way.
 */
export function playCardMotion(
  element: HTMLElement,
  from: Box | undefined,
  opening: boolean,
  options: { readonly duration?: number | undefined } = {}
): Promise<void> {
  if (from === undefined || prefersReducedMotion() || typeof element.animate !== "function") {
    return Promise.resolve();
  }
  const folded = revealFrom(from, element.getBoundingClientRect());
  const animation = element.animate(
    opening
      ? [
          { clipPath: folded, opacity: 0.4 },
          { clipPath: REVEALED, opacity: 1 },
        ]
      : [
          { clipPath: REVEALED, opacity: 1 },
          { clipPath: folded, opacity: 0.4 },
        ],
    {
      duration: options.duration ?? (opening ? OPEN_MS : CLOSE_MS),
      easing: opening ? "cubic-bezier(0.2, 0.8, 0.2, 1)" : "cubic-bezier(0.4, 0, 1, 1)",
      // Folded stays folded until the caller takes the card away; opened is just the card.
      fill: opening ? "none" : "forwards",
    }
  );
  return animation.finished.then(
    () => undefined,
    // Cancelled: the card was taken away mid-way.
    () => undefined
  );
}
