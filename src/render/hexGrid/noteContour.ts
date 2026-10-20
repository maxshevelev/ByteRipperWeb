import { BYTES_PER_ROW, type HexLayout } from "@/render/hexGrid/hexLayout";
import { type ContourPoint, selectionContours } from "@/render/hexGrid/spanContour";

/**
 * How near a note's dashed outline the pointer has to be for the note to speak: either side of
 * the line.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.noteContourReach
 */
export const NOTE_CONTOUR_REACH = 4;

/** A span of the pane's bytes a note is drawn over. */
export interface NoteSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * The note whose outline runs under `point` — in the layout's content coordinates — the innermost
 * one where two outlines meet there; nothing off every outline. Only the notes on the rows round
 * the point are looked at: an outline further off cannot reach it. `padding` is the one the
 * outlines are drawn with.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.noteContour
 */
export function noteContourAt<Span extends NoteSpan>(
  point: ContourPoint,
  notes: readonly Span[],
  layout: HexLayout,
  padding: number
): Span | undefined {
  if (layout.rowHeight <= 0) return undefined;
  const row = Math.floor(point.y / layout.rowHeight);
  const near = { start: Math.max(0, row - 1) * BYTES_PER_ROW, end: (row + 2) * BYTES_PER_ROW };
  let found: Span | undefined;
  for (const note of notes) {
    if (note.end <= near.start || note.start >= near.end) continue;
    if (found !== undefined && note.end - note.start >= found.end - found.start) continue;
    const contours = selectionContours(note.start, note.end, layout, padding);
    if (contours.some((loop) => onLoop(point, loop, NOTE_CONTOUR_REACH))) found = note;
  }
  return found;
}

/** Whether `point` lies within `reach` of the closed loop's line, round its corners too. */
function onLoop(point: ContourPoint, loop: readonly ContourPoint[], reach: number): boolean {
  for (let index = 0; index < loop.length; index++) {
    const a = loop[index];
    const b = loop[(index + 1) % loop.length];
    if (a === undefined || b === undefined) continue;
    if (distanceToSegment(point, a, b) <= reach) return true;
  }
  return false;
}

function distanceToSegment(p: ContourPoint, a: ContourPoint, b: ContourPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
