/**
 * Turns for the event loop, for long work that has to run on the main thread.
 *
 * An `await` alone is not one. A read the chunk cache or an edit overlay answers
 * resolves as a microtask, and a loop of those holds the thread until it ends:
 * no frame is drawn, no key is taken, and the search the user wanted to cancel
 * cannot be cancelled. A task boundary is what lets the browser in.
 *
 * @web-only upstream runs this work on a background queue; a page has one thread for the interface and whatever work stays beside it
 */

/** How long a stretch of work may hold the thread: half a 60 Hz frame. */
export const TIME_SLICE_MS = 8;

/**
 * A pause for a loop to call between steps: `undefined` while its slice lasts,
 * and a promise of the next task once the slice is spent.
 */
export type Pause = () => Promise<void> | undefined;

export function createTimeSlicer(budgetMs = TIME_SLICE_MS): Pause {
  let sliceStart = performance.now();
  return () => {
    if (performance.now() - sliceStart < budgetMs) return undefined;
    return nextTask().then(() => {
      sliceStart = performance.now();
    });
  };
}

let channel: MessageChannel | undefined;
const waiting: (() => void)[] = [];

/**
 * Resolves in a task of its own.
 *
 * A message rather than `setTimeout(0)`: nested timers are clamped to four
 * milliseconds, which a scan yielding every eight would spend a third of its
 * time waiting out.
 */
export function nextTask(): Promise<void> {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (channel === undefined) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => waiting.shift()?.();
    // Node keeps a port with a listener alive; a pause is no reason to.
    (channel.port1 as { unref?: () => void }).unref?.();
  }
  const port = channel.port2;
  return new Promise((resolve) => {
    waiting.push(resolve);
    port.postMessage(null);
  });
}
