/**
 * Where the Annotations panel's cards stand: in as many columns as the panel is wide, each card in
 * the shortest column, in order, at the height its text takes. The pure half of upstream's
 * masonry layout, so a test can ask where a card goes and where one carried would land.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout
 */

/** One card's place, in the list's own coordinates. */
export interface CardFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The cards laid out: each card's frame in order, the columns' spans, and the height of it all. */
export interface CardLayout {
  readonly frames: readonly CardFrame[];
  /**
   * Each column's left and right edges, widened by half the gap on each side so the columns meet.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.columnSpans
   */
  readonly columnSpans: readonly (readonly [number, number])[];
  readonly contentHeight: number;
  readonly columnWidth: number;
}

/** @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.inset */
export const NOTES_INSET = 12;
/** @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.gap */
export const NOTES_GAP = 12;

/**
 * How many columns the cards take: one below 640 pixels, two below 980, three above.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.columns
 */
export const notesColumns = (width: number): number => (width < 640 ? 1 : width < 980 ? 2 : 3);

/**
 * The cards put in the shortest column, in order, at the heights `heightOf` gives at the column's
 * width — so a long note leaves no hole beside it.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.prepare
 */
export function layOutCards(
  count: number,
  width: number,
  heightOf: (index: number, columnWidth: number) => number
): CardLayout {
  const columns = notesColumns(width);
  const columnWidth = Math.max(
    120,
    (width - 2 * NOTES_INSET - (columns - 1) * NOTES_GAP) / columns
  );
  const tops: number[] = Array.from({ length: columns }, () => NOTES_INSET);
  const columnSpans = tops.map((_, column) => {
    const left = NOTES_INSET + column * (columnWidth + NOTES_GAP);
    return [left - NOTES_GAP / 2, left + columnWidth + NOTES_GAP / 2] as const;
  });
  const frames: CardFrame[] = [];
  for (let index = 0; index < count; index++) {
    let column = 0;
    for (let other = 1; other < tops.length; other++) {
      if ((tops[other] ?? 0) < (tops[column] ?? 0)) column = other;
    }
    const height = Math.ceil(heightOf(index, columnWidth));
    const y = tops[column] ?? NOTES_INSET;
    frames.push({
      x: NOTES_INSET + column * (columnWidth + NOTES_GAP),
      y,
      width: columnWidth,
      height,
    });
    tops[column] = y + height + NOTES_GAP;
  }
  const contentHeight = Math.max(...tops) - NOTES_GAP + NOTES_INSET;
  return { frames, columnSpans, contentHeight, columnWidth };
}

/**
 * Where a card carried from `carrying` goes with the pointer at `point`: the place of the card
 * under it — well inside it, not on its rim, so a card is not taken by a pointer only passing its
 * edge — or the last place, below the last card of the column under it: the empty end of a column
 * shorter than its neighbour, where the last card goes. Nothing over the gaps between cards, and
 * over the carried card's own empty place.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.target
 */
export function carryTarget(
  layout: CardLayout,
  point: { readonly x: number; readonly y: number },
  carrying: number
): number | undefined {
  const { frames, columnSpans } = layout;
  const hit = frames.findIndex((frame, index) => {
    if (index === carrying) return false;
    const dx = frame.width * 0.15;
    const dy = Math.min(frame.height * 0.15, 24);
    return (
      point.x >= frame.x + dx &&
      point.x < frame.x + frame.width - dx &&
      point.y >= frame.y + dy &&
      point.y < frame.y + frame.height - dy
    );
  });
  if (hit >= 0) return hit;
  const column = columnSpans.find(([left, right]) => point.x >= left && point.x <= right);
  if (frames.length === 0 || column === undefined) return undefined;
  const bottom = Math.max(
    0,
    ...frames
      .filter((frame) => {
        const middle = frame.x + frame.width / 2;
        return middle >= column[0] && middle <= column[1];
      })
      .map((frame) => frame.y + frame.height)
  );
  return point.y > bottom ? frames.length - 1 : undefined;
}
