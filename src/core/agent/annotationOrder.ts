import type { AgentAnnotation } from "@/core/agent/agentAnnotation";

/**
 * The annotations in the order of the cards: first card first. One the order does not know — it
 * has none for it yet — stands before the rest, as a new card does.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.ordered
 */
export function inCardOrder(
  annotations: readonly AgentAnnotation[],
  order: readonly string[]
): AgentAnnotation[] {
  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  // A stable sort: the ones with no rank keep the order they were made in.
  return [...annotations].sort(
    (one, other) => (rank.get(one.id) ?? -1) - (rank.get(other.id) ?? -1)
  );
}

/**
 * The order after the person arranged the cards as `ids` says: those first, in that order, then
 * the rest as they stood. Ids the order does not hold are ignored.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.arrange
 */
export function arranged(order: readonly string[], ids: readonly string[]): string[] {
  const known = new Set(order);
  const first = ids.filter((id) => known.has(id));
  const placed = new Set(first);
  return [...first, ...order.filter((id) => !placed.has(id))];
}

/**
 * The cards' ids after the one at `from` is taken to `to`: it stands there, the cards between
 * moving up or down by one to make room.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.moveCarry
 */
export function movedTo(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [moving] = next.splice(from, 1);
  if (moving !== undefined) next.splice(to, 0, moving);
  return next;
}

/** A card's box, in the list's own coordinates. */
export interface CardFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A column's left and right edges, widened by half the gap on each side so the columns meet. */
export interface ColumnSpan {
  readonly left: number;
  readonly right: number;
}

/**
 * Where a card carried from `carrying` goes with the pointer at (`x`, `y`): the place of the card
 * under it — well inside it, not on its rim, so a card is not taken by a pointer only passing its
 * edge — or the last place, below the last card of the column under it: the empty end of a column
 * shorter than its neighbour, where the last card goes. Undefined over the gaps between cards, and
 * over the carried card's own empty place.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.target
 */
export function carryTarget(
  frames: readonly CardFrame[],
  columns: readonly ColumnSpan[],
  carrying: number,
  x: number,
  y: number
): number | undefined {
  const hit = frames.findIndex((frame, index) => {
    if (index === carrying) return false;
    const dx = frame.width * 0.15;
    const dy = Math.min(frame.height * 0.15, 24);
    return (
      x > frame.x + dx &&
      x < frame.x + frame.width - dx &&
      y > frame.y + dy &&
      y < frame.y + frame.height - dy
    );
  });
  if (hit >= 0) return hit;
  const column = columns.find((span) => x >= span.left && x <= span.right);
  if (frames.length === 0 || column === undefined) return undefined;
  const bottom = Math.max(
    0,
    ...frames
      .filter((frame) => {
        const middle = frame.x + frame.width / 2;
        return middle >= column.left && middle <= column.right;
      })
      .map((frame) => frame.y + frame.height)
  );
  return y > bottom ? frames.length - 1 : undefined;
}

/**
 * Whether the pointer is still where the cards last moved aside for it: they move again only once
 * it has gone on, or two cards of unlike heights would trade places for as long as the pointer
 * rests between them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.Carry
 */
export const stillSettled = (
  settledAt: { readonly x: number; readonly y: number } | undefined,
  x: number,
  y: number
): boolean => settledAt !== undefined && Math.hypot(x - settledAt.x, y - settledAt.y) < 8;

/**
 * What became of the cards between two drawings: some only went, the rest in the order they stood
 * ("remove"); some only came, the others in the order they stood ("insert"); or anything else.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.show
 */
export function cardChange(
  before: readonly string[],
  after: readonly string[]
): "remove" | "insert" | "other" {
  const same = (one: readonly string[], other: readonly string[]) =>
    one.length === other.length && one.every((id, index) => other[index] === id);
  const had = new Set(before);
  const has = new Set(after);
  if (before.length === 0) return "other";
  if (
    after.length < before.length &&
    same(
      before.filter((id) => has.has(id)),
      after
    )
  ) {
    return "remove";
  }
  if (
    after.length > before.length &&
    same(
      after.filter((id) => had.has(id)),
      before
    )
  ) {
    return "insert";
  }
  return "other";
}
