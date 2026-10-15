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
 * The cards' ids after `moving` is carried to stand before `before` — or, with none, last. Nothing
 * moves onto itself.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.target
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.emptyIndex
 * @upstream-differs upstream's cards are carried by the mouse and the layout says where they land;
 * the browser drops one on another, and this is the arithmetic of the drop
 */
export function carried(
  ids: readonly string[],
  moving: string,
  before: string | undefined
): string[] {
  if (before === moving || !ids.includes(moving)) return [...ids];
  const rest = ids.filter((id) => id !== moving);
  const at = before === undefined ? rest.length : rest.indexOf(before);
  if (at < 0) return [...ids];
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}
