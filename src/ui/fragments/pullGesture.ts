import {
  type Direction,
  directionOf,
  FLICK_WINDOW_MS,
  type Movement,
  outcome,
  position,
  recentTravel,
  type Sample,
  throwTiming,
} from "@/ui/fragments/pullDown";
import { prefersReducedMotion } from "@/ui/toolPanel/cardMotion";

/**
 * A fragment panel pulled down by its header: it follows the pointer until the button comes
 * up, and then either springs back or carries on into its pill.
 *
 * The pointer is tracked on the window rather than on the header, because the gesture belongs
 * to the panel while it lasts: the header it started on is moving away under the hand. The
 * panel moves by `transform`, which moves its layer and lays nothing out again — the dump inside
 * it does not reflow sixty times a second to be somewhere nobody will read.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.beginPullDown
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.pullPanel
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.endPull
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.finishPullDown
 * @upstream-differs pointer events on the window, where upstream runs a nested tracking loop
 */

/**
 * How long a spring back takes: nothing changed, so the panel should look like it never left.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.springBackDuration
 */
export const SPRING_BACK_MS = 200;
/**
 * How long the rest of the way into the pill takes from the top; less from lower down.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.slideDuration
 */
export const SLIDE_MS = 240;
/** Never faster than this, however little of the way is left. */
export const MINIMUM_SLIDE_MS = 100;

/**
 * A fold that a pull began, for the panel's own fold to carry on from: how long the rest of the
 * way should take. Where the hand left the panel is not part of it — the panel is still there,
 * moved by its own transform, and is measured where it stands.
 */
export interface PulledFold {
  readonly duration: number;
  /** The easing that carries a throw on, at the hand's speed; nothing for a fold that was not thrown. */
  readonly easing?: string | undefined;
}

/**
 * Starts pulling `panel` from the pointer at `startY`. `collapse` is called, with the panel
 * left where the hand put it, when the pull carries on into the pill; it answers whether the
 * panel is folding, and a panel that is not springs back.
 *
 * Answers the means to let the pull go without deciding anything — the panel folded or went
 * away under the hand — which leaves the panel where it is.
 */
export function beginPull(
  panel: HTMLElement,
  pointerId: number,
  startY: number,
  startTime: number,
  collapse: (fold: PulledFold) => boolean
): () => void {
  let anchor = startY;
  let direction: Direction = "none";
  // The pointer's last tenth of a second and a little more: how fast the hand was going is
  // measured over them, not over the last movement alone.
  let samples: Sample[] = [{ y: startY, time: startTime }];
  let travel = 0;
  const movement = (): Movement => ({ direction, ...recentTravel(samples, direction) });

  document.body.setAttribute("data-pulling-panel", "");
  window.getSelection()?.removeAllRanges();

  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const y = event.clientY;
    samples.push({ y, time: event.timeStamp });
    samples = samples.filter((one) => one.time >= event.timeStamp - FLICK_WINDOW_MS * 2);
    const moved = directionOf(y - anchor);
    if (moved !== undefined) {
      direction = moved;
      anchor = y;
    }
    travel = position(y - startY);
    panel.style.transform = `translateY(${travel}px)`;
  };

  const release = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    window.removeEventListener("blur", lost);
    document.body.removeAttribute("data-pulling-panel");
  };

  const finish = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    release();

    const height = panel.offsetHeight;
    // A cancelled gesture is not an instruction.
    const last = movement();
    const decided = event.type === "pointercancel" ? "springBack" : outcome(travel, height, last);
    if (decided === "collapse") {
      // From wherever the hand left it, so the rest of the way takes the rest of the time: a
      // panel already most of the way down must not dawdle through a full slide.
      const share = height > 0 ? Math.max(0, height - travel) / height : 1;
      const duration = Math.max(MINIMUM_SLIDE_MS, SLIDE_MS * share);
      // A throw down carries on at its speed.
      const easing =
        last.direction === "down"
          ? throwTiming(last.speed, Math.max(0, height - travel), duration)
          : undefined;
      if (collapse({ duration, easing })) return;
    }
    springBack(panel, travel);
  };

  // The window lost the pointer — another application came to the front with the button still
  // down — and the button will come up where this page never hears it: a cancelled gesture.
  const lost = () => {
    release();
    springBack(panel, travel);
  };

  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("pointercancel", finish, true);
  window.addEventListener("blur", lost);
  return release;
}

/** Back where it was, as if nothing had happened. */
function springBack(panel: HTMLElement, from: number): void {
  panel.style.transform = "";
  if (from === 0 || prefersReducedMotion() || typeof panel.animate !== "function") return;
  panel.animate([{ transform: `translateY(${from}px)` }, { transform: "translateY(0)" }], {
    duration: SPRING_BACK_MS,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  });
}
