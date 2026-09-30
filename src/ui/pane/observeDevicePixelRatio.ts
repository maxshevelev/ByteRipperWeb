/**
 * Calls back whenever the device pixel ratio changes.
 *
 * Which is what a page zoom is, as far as a canvas is concerned: the element
 * keeps its size in CSS pixels and the backing store needs more of them. There
 * is no event for it, so this watches a media query pinned to the current ratio
 * and re-pins it each time — the query stops matching the moment the ratio
 * moves — and the window's resize, which a zoom always brings.
 *
 * **The event is not proof that the ratio has moved yet.** In Electron the
 * media query fires while `devicePixelRatio` still answers the old value, and
 * a callback that trusted it drew the pane one zoom step behind: the backing
 * store a step too large or too small, the old rows left at the foot and the
 * right edge. So the ratio is *read again* after the event — at once, on the
 * next frame, and once layout has surely settled — and the callback runs
 * whenever a read finds it different from the one last acted on.
 *
 * Without it the browser's zoom — now the only zoom there is — would leave the
 * dump drawn at the old scale and blurred up to the new one.
 */
export function observeDevicePixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | undefined;
  let stopped = false;
  let applied = window.devicePixelRatio;
  let timer: number | undefined;

  const listen = () => {
    if (stopped) return;
    query?.removeEventListener("change", settle);
    query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", settle, { once: true });
  };
  const check = () => {
    if (stopped || window.devicePixelRatio === applied) return;
    applied = window.devicePixelRatio;
    onChange();
    listen();
  };
  function settle() {
    check();
    requestAnimationFrame(check);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      check();
      // Pinned to what the ratio is now, whichever the event saw.
      listen();
    }, 150);
  }

  listen();
  window.addEventListener("resize", settle);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.removeEventListener("resize", settle);
    query?.removeEventListener("change", settle);
  };
}
