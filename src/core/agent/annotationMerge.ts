/**
 * The annotations the app's windows share, and how two windows' versions of them come together
 * (`Design/DESKTOP_WINDOWS.md`, D7c).
 *
 * Upstream's annotations are one object in one process, which every window reads. The desktop
 * shell's windows are pages of their own, so each holds a copy and tells the others of every
 * change. A change made in one window while another's was on its way must survive both: each
 * window remembers the version it last agreed on with the others, so what it holds now and what
 * it is told can each be read as changes since then — an annotation added, removed, edited, a card
 * moved — and both sets of changes kept.
 *
 * @web-only upstream's windows share one `AgentAnnotationTools`; here each window's page holds a
 * copy, and the copies are brought together
 */

/** An annotation as the windows tell one another of it: plain data, its file named, not held. */
export interface SharedAnnotation {
  readonly id: string;
  /**
   * The file it is on — on disk, or a document with no file that one window holds, named by that
   * window and the pane it is in there.
   */
  readonly file:
    | { readonly kind: "disk"; readonly identity: unknown }
    | {
        readonly kind: "elsewhere";
        readonly window: string;
        readonly pane: string;
        readonly name: string;
      };
  readonly [field: string]: unknown;
}

/** The annotations of the app, as one window holds them. */
export interface SharedAnnotations {
  readonly items: readonly SharedAnnotation[];
  /** The cards' order, first card first. */
  readonly order: readonly string[];
  /** Not yet marked new in the Annotations window. */
  readonly fresh: readonly string[];
  /** The agent's, made while the Annotations window was not in view. */
  readonly unseen: readonly string[];
  /** The number the next annotation's id is made with. */
  readonly nextId: number;
}

export const NO_SHARED_ANNOTATIONS: SharedAnnotations = {
  items: [],
  order: [],
  fresh: [],
  unseen: [],
  nextId: 1,
};

/** What came of putting two versions together: the version, and the ids this window gave up. */
export interface MergedAnnotations {
  readonly merged: SharedAnnotations;
  /**
   * Annotations made here under an id another window had given one of its own meanwhile: this
   * window's takes a new id, the other's keeps it.
   */
  readonly renamed: ReadonlyMap<string, string>;
}

const same = (one: SharedAnnotation, other: SharedAnnotation): boolean =>
  JSON.stringify(one) === JSON.stringify(other);

const byId = (items: readonly SharedAnnotation[]) => new Map(items.map((one) => [one.id, one]));

/**
 * `theirs` — another window's version — with what this window has changed since `base`, the
 * version both last agreed on, kept on top: an annotation added here stays, one removed here stays
 * removed, one edited here keeps the edit. What the other window changed is taken. Where both
 * changed one annotation, this window's edit stands, and one removed in either is gone.
 */
export function mergeAnnotations(
  base: SharedAnnotations,
  mine: SharedAnnotations,
  theirs: SharedAnnotations
): MergedAnnotations {
  const was = byId(base.items);
  const here = byId(mine.items);
  const there = byId(theirs.items);
  const number = (id: string) => Number(id.slice(1)) || 0;
  let nextId = Math.max(
    base.nextId,
    mine.nextId,
    theirs.nextId,
    ...[...mine.items, ...theirs.items].map((one) => number(one.id) + 1),
    1
  );
  const renamed = new Map<string, string>();
  const result = new Map<string, SharedAnnotation>();
  const addedHere: string[] = [];

  for (const [id, theirsOne] of there) {
    const before = was.get(id);
    const mineOne = here.get(id);
    // Removed here: stays removed.
    if (before !== undefined && mineOne === undefined) continue;
    if (mineOne !== undefined && before !== undefined && !same(mineOne, before)) {
      // Edited here: the edit stands.
      result.set(id, mineOne);
    } else if (mineOne !== undefined && before === undefined && !same(mineOne, theirsOne)) {
      // Made in both windows under one id: theirs keeps it, this window's takes the next.
      result.set(id, theirsOne);
      const fresh = `a${nextId++}`;
      renamed.set(id, fresh);
      result.set(fresh, { ...mineOne, id: fresh });
      addedHere.push(fresh);
    } else {
      result.set(id, theirsOne);
    }
  }
  for (const [id, mineOne] of here) {
    if (there.has(id) || was.has(id)) continue;
    // Made here since: stays.
    result.set(id, mineOne);
    addedHere.push(id);
  }
  if (renamed.size > 0) {
    for (const id of addedHere) {
      const one = result.get(id);
      const related = one?.relatedTo;
      if (one === undefined || !Array.isArray(related)) continue;
      result.set(id, {
        ...one,
        relatedTo: related.map((other: string) => renamed.get(other) ?? other),
      });
    }
  }

  const ids = new Set(result.keys());
  const rename = (list: readonly string[]) => list.map((id) => renamed.get(id) ?? id);
  // The order: the one moved since, this window's when only it moved a card; then the cards made
  // here in front, as a new card stands.
  const orderedBy =
    base.order.join() !== mine.order.join() && base.order.join() === theirs.order.join()
      ? rename(mine.order)
      : theirs.order;
  const order = orderedBy.filter((id) => ids.has(id));
  const placed = new Set(order);
  const inFront = rename(mine.order).filter((id) => addedHere.includes(id) && !placed.has(id));
  for (const id of addedHere) if (!inFront.includes(id) && !placed.has(id)) inFront.push(id);
  const rest = [...ids].filter((id) => !placed.has(id) && !inFront.includes(id));

  return {
    merged: {
      items: [...result.values()],
      order: [...inFront, ...order, ...rest],
      fresh: mergedSet(base.fresh, rename(mine.fresh), theirs.fresh, ids),
      unseen: mergedSet(base.unseen, rename(mine.unseen), theirs.unseen, ids),
      nextId,
    },
    renamed,
  };
}

/** Their set, with what was added here since added and what was taken away here taken away. */
function mergedSet(
  base: readonly string[],
  mine: readonly string[],
  theirs: readonly string[],
  ids: ReadonlySet<string>
): string[] {
  const was = new Set(base);
  const here = new Set(mine);
  const result = new Set(theirs.filter((id) => !(was.has(id) && !here.has(id))));
  for (const id of mine) if (!was.has(id)) result.add(id);
  return [...result].filter((id) => ids.has(id)).sort();
}
