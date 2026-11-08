import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A tree's rows opening and shutting in motion, as an outline view's do (upstream's
 * `NSOutlineView`, its `animator().expandItem` and `collapseItem`): the rows below a row that
 * opens slide down to make room and its rows fade in under them; the rows of one that shuts fade
 * out while the rows below slide up over them.
 *
 * Measured, not modelled: after each change of the rows, every row on screen that was in the
 * tree before and has moved is played from where it was to where it is, and every new one fades
 * in. Where a row was is where it was seen — so a table whose rows are not all one height, the
 * FIT table's CPUID lines under a microcode, moves as truly as a tree's — and, for a row that
 * was not on screen to be seen, its old index times the row height. The rows that went are
 * handed back as `exiting`, to be drawn where they were until they have faded.
 *
 * Every table of the app whose rows open and shut does it through this hook: the UEFI tree,
 * the ME tree and the FIT table.
 *
 * Any change of the rows moves, whatever made it: a click, a key, a search opening the way to a
 * match. One too large to follow — more rows than a screen holds many times over — and one the
 * caller asks to skip (`skipNext`) land at once, as they do with the system's reduced motion.
 *
 * @web-only upstream's outline view moves its own rows; a browser has none, so the motion is the
 * Web Animations API over rows a table lays out itself
 */

/** How long a row takes to reach its place. */
export const TREE_MOTION_MS = 200;

/** Past this many rows added or taken away, the change lands at once. */
const MOST_ROWS_IN_MOTION = 300;

const EASING = "ease-out";

/** A row that has gone from the tree, drawn where it was while it fades. */
export interface ExitingRow<R> {
  readonly row: R;
  readonly key: string;
  /** Its index before it went: what its striping and its place were. */
  readonly index: number;
  /** Where it stood, in its container's coordinates. */
  readonly top: number;
}

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The attribute a row carries its key under, which the motion finds it by. */
export const ROW_KEY_ATTRIBUTE = "data-row-key";

/** Where the rows stood after a change: what the next change is played from. */
export interface Snapshot<R> {
  readonly index: ReadonlyMap<string, number>;
  readonly rows: ReadonlyMap<string, R>;
  /**
   * Where the first row stands, in the container's coordinates — every row is one height, so
   * a row's place is this and its index — or nothing when no row was on screen to tell.
   */
  readonly origin: number | undefined;
  /**
   * Where each row on screen stood, in the container's coordinates, as it was measured: what a
   * row of a height of its own is placed by. A row missing here is placed by `origin`.
   */
  readonly tops?: ReadonlyMap<string, number>;
}

/** A change of the rows, as it is to be played. */
interface Change<R> {
  readonly rows: readonly R[];
  /** The rows before it; nothing for a change that lands at once. */
  readonly from: Snapshot<R> | undefined;
  readonly exiting: readonly ExitingRow<R>[];
}

/**
 * Plays every change of `rows` inside `container`, whose rows carry their key in
 * `data-row-key` and are `rowHeight` tall; `scroller` is what scrolls them, when it is not
 * `container` itself.
 */
export function useTreeMotion<R>(
  rows: readonly R[],
  keyOf: (row: R) => string,
  container: RefObject<HTMLElement | null>,
  rowHeight: number,
  scroller: RefObject<HTMLElement | null> = container
): {
  readonly exiting: readonly ExitingRow<R>[];
  /** The next change lands at once: an Option-click opening everything under a row. */
  readonly skipNext: () => void;
} {
  const previous = useRef<Snapshot<R> | undefined>(undefined);
  const skip = useRef(false);
  const [change, setChange] = useState<Change<R>>({ rows, from: undefined, exiting: [] });
  const [fading, setFading] = useState<readonly ExitingRow<R>[]>([]);

  // The change is planned as the rows are rendered, not after: the rows that went have to be in
  // the very render that takes them away, or the list is short for a frame and a table scrolled
  // to its end is snapped back by the browser before they are drawn.
  let current = change;
  if (change.rows !== rows) {
    current = planTreeMotion(
      previous.current,
      rows,
      keyOf,
      rowHeight,
      skip.current || reducedMotion()
    );
    setChange(current);
    if (current.exiting.length > 0) setFading(current.exiting);
  }

  useLayoutEffect(() => {
    const element = container.current;
    const rendered =
      element === null
        ? []
        : [
            ...element.querySelectorAll<HTMLElement>(
              `[${ROW_KEY_ATTRIBUTE}]:not([data-motion-exit])`
            ),
          ];
    const index = new Map(change.rows.map((row, at) => [keyOf(row), at]));
    const sample = rendered[0];
    const sampleIndex =
      sample === undefined ? undefined : index.get(sample.getAttribute(ROW_KEY_ATTRIBUTE) ?? "");
    const origin =
      sample === undefined || sampleIndex === undefined
        ? undefined
        : sample.offsetTop - sampleIndex * rowHeight;
    // `offsetTop` is the row's place in the layout, whatever a motion still in flight is
    // drawing it at.
    const tops = new Map(
      rendered.map((row) => [row.getAttribute(ROW_KEY_ATTRIBUTE) ?? "", row.offsetTop])
    );
    previous.current = {
      index,
      rows: new Map(change.rows.map((row) => [keyOf(row), row])),
      origin,
      tops,
    };
    skip.current = false;
    const was = change.from;
    if (was === undefined || element === null) return;

    const timing = { duration: TREE_MOTION_MS, easing: EASING };
    for (const row of rendered) {
      const key = row.getAttribute(ROW_KEY_ATTRIBUTE) ?? "";
      const before = was.index.get(key);
      const now = index.get(key);
      if (now === undefined) continue;
      if (before === undefined) {
        // New: under the rows that slide down past it, coming into view as they uncover it.
        row.setAttribute("data-motion", "under");
        row.animate([{ opacity: 0 }, { opacity: 1 }], timing).finished.then(
          () => row.removeAttribute("data-motion"),
          () => row.removeAttribute("data-motion")
        );
      } else {
        const stood = was.tops?.get(key);
        const by = stood === undefined ? (before - now) * rowHeight : stood - row.offsetTop;
        if (by !== 0) {
          row.animate([{ transform: `translateY(${by}px)` }, { transform: "none" }], timing);
        }
      }
    }
    for (const row of element.querySelectorAll<HTMLElement>("[data-motion-exit]")) {
      row.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, fill: "forwards" });
    }
    // A branch shut near the end of the list leaves less to scroll: the table is brought to its
    // new end along with the rows rather than snapped there when the last of them has faded.
    const view = scroller.current;
    const last = rendered[rendered.length - 1];
    const lastKey = change.rows.length === 0 ? undefined : keyOf(change.rows.at(-1) as R);
    const bottom =
      last !== undefined && last.getAttribute(ROW_KEY_ATTRIBUTE) === lastKey
        ? last.offsetTop + last.offsetHeight
        : origin === undefined
          ? undefined
          : origin + change.rows.length * rowHeight;
    if (view !== null && bottom !== undefined && change.exiting.length > 0) {
      // Where the rows' coordinates start in what the scroller scrolls.
      const base =
        view === element
          ? 0
          : element.getBoundingClientRect().top -
            view.getBoundingClientRect().top -
            view.clientTop +
            view.scrollTop;
      const end = base + bottom;
      const target = Math.max(0, end - view.clientHeight);
      if (view.scrollTop > target) glide(view, target);
    }
  }, [change, keyOf, container, scroller, rowHeight]);

  useEffect(() => {
    if (fading.length === 0) return;
    const timer = setTimeout(() => setFading([]), TREE_MOTION_MS);
    return () => clearTimeout(timer);
  }, [fading]);

  const skipNext = useCallback(() => {
    skip.current = true;
  }, []);
  return { exiting: fading, skipNext };
}

/** What a change of the rows is to play, from where they stood before it. */
export function planTreeMotion<R>(
  was: Snapshot<R> | undefined,
  rows: readonly R[],
  keyOf: (row: R) => string,
  rowHeight: number,
  atOnce: boolean
): Change<R> {
  const still: Change<R> = { rows, from: undefined, exiting: [] };
  if (was === undefined || atOnce) return still;
  const keys = new Set(rows.map(keyOf));
  const kept = [...keys].filter((key) => was.index.has(key)).length;
  const added = rows.length - kept;
  const gone = [...was.index.keys()].filter((key) => !keys.has(key));
  if (added === 0 && gone.length === 0) return still;
  if (added + gone.length > MOST_ROWS_IN_MOTION) return still;
  // What went and was on screen is drawn where it was a moment longer, fading.
  const origin = was.origin;
  const exiting = gone.flatMap((key): ExitingRow<R>[] => {
    const row = was.rows.get(key);
    const at = was.index.get(key);
    if (row === undefined || at === undefined) return [];
    const top = was.tops?.get(key) ?? (origin === undefined ? undefined : origin + at * rowHeight);
    return top === undefined ? [] : [{ row, key, index: at, top }];
  });
  return { rows, from: was, exiting };
}

/** Scrolls `view` to `target` over the rows' own time and easing. */
function glide(view: HTMLElement, target: number): void {
  const start = view.scrollTop;
  const begun = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - begun) / TREE_MOTION_MS);
    // ease-out, as the rows move
    const eased = 1 - (1 - t) ** 3;
    view.scrollTop = start + (target - start) * eased;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** The bottom of the lowest row still fading, for a list that sizes itself to its rows. */
export function exitingExtent(exiting: readonly ExitingRow<unknown>[], rowHeight: number): number {
  return exiting.reduce((bottom, row) => Math.max(bottom, row.top + rowHeight), 0);
}
