import { segmentLabel } from "@/core/segments/segmentation";
import { friendlySize } from "@/core/text/byteSize";
import { hexAddress } from "@/core/text/hexText";
import {
  bookmarkMarkBox,
  type MapMark,
  nearestCut,
  type ZoneBracketBox,
  zoneBracket,
} from "@/render/minimap/minimapClick";
import type { MinimapLayout, Rect } from "@/render/minimap/minimapLayout";

/**
 * What hovering the map says: the segment strip's piece or cut, a zone's bracket,
 * a bookmark's mark — each named the way the list that holds it writes it.
 *
 * Ported from the hover half of `ByteRipperApp/Minimap/MinimapView.swift`. Pure
 * arithmetic over one map's layout and the heights its marks were painted at,
 * the same inputs a click reads, so what is tested is what the pointer finds.
 */

/** A piece of the file as the strip paints it, with the name it has now. */
export interface StripPiece {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  /**
   * The piece's current name, read when the map is drawn rather than kept: a
   * rename is a store change, and the strip is drawn again from the store.
   *
   * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentPieceName
   * @upstream-differs a field read off the store as the map draws, where upstream asks a closure at hover time because its store fires nothing for a rename
   */
  readonly name: string;
  readonly top: number;
  readonly height: number;
}

/** A bookmark's mark where it is painted, and the bookmark's name. */
export interface NamedMark extends MapMark {
  readonly name: string;
}

/** A zone's bracket where it is painted, and the zone's name. */
export interface NamedBracket extends ZoneBracketBox {
  /** @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.ZoneBracket.name */
  readonly name: string;
}

/** `0xSTART…0xLAST, size`: the extent the strip's and the gutter's answers share. */
function extent(start: number, end: number): string {
  const first = start.toString(16).toUpperCase();
  const last = Math.max(start, end - 1)
    .toString(16)
    .toUpperCase();
  return `0x${first}…0x${last}, ${friendlySize(end - start)}`;
}

/**
 * The hover text for a point on the segment strip, or "" for none. A point within
 * the snap distance of a cut names the boundary — the line between two colours
 * is the more precise fact — and a point over a piece names the piece: its label,
 * range, size and name, the shape the form's list writes (§19.4.4, §21.4).
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripTooltipText
 */
export function segmentStripTooltipText(options: {
  readonly strip: Rect | undefined;
  readonly cuts: readonly MapMark[];
  readonly pieces: readonly StripPiece[];
  readonly x: number;
  readonly y: number;
}): string {
  const { strip, x, y } = options;
  if (strip === undefined || x < strip.x || x > strip.x + strip.width) return "";
  const cut = nearestCut(options.cuts, y);
  if (cut !== undefined) return `0x${cut.toString(16).toUpperCase()}`;
  const piece = options.pieces.find((one) => y >= one.top && y < one.top + one.height);
  if (piece === undefined) return "";
  const text = `${segmentLabel(piece.index)} — ${extent(piece.start, piece.end)}`;
  return piece.name.length === 0 ? text : `${text} · ${piece.name}`;
}

/**
 * The hover text for a point on a zone's bracket, or "" for none: the zone's
 * name, its range and its size — the strip's own shape, because the two are the
 * same kind of legend (§19.4.5). A zone with no name is named by its range alone.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketTooltipText
 */
export function zoneBracketTooltipText(
  layout: MinimapLayout,
  brackets: readonly NamedBracket[],
  x: number,
  y: number
): string {
  const bracket = zoneBracket(layout, brackets, x, y) as NamedBracket | undefined;
  if (bracket === undefined) return "";
  const range = extent(bracket.start, bracket.end);
  return bracket.name.length === 0 ? range : `${bracket.name} — ${range}`;
}

/**
 * The bookmark whose mark is under the point, if any. The mark's own box is the
 * target, grown a little: a small arrow in a narrow margin is a small thing to
 * hit, and a tooltip that only answers on the pixel is one nobody sees.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.bookmark
 */
export function bookmarkAtMarkPoint(
  layout: MinimapLayout,
  marks: readonly NamedMark[],
  x: number,
  y: number
): NamedMark | undefined {
  for (const mark of marks) {
    const box = bookmarkMarkBox(layout, mark.y);
    if (box === undefined) return undefined;
    const inside =
      x >= box.x - 2 &&
      x <= box.x + box.width + 2 &&
      y >= box.top - 2 &&
      y <= box.top + box.height + 2;
    if (inside) return mark;
  }
  return undefined;
}

/**
 * What hovering the map says: the segment strip's answer for a point on it, the
 * zone gutter's for a point on a bracket, else a bookmark's for a point on its
 * mark, else nothing. The two legends are asked before the marks: they are what
 * the reader reads, and theirs is the more specific answer where a mark's grown
 * box could reach one of them (§19.4.4, §19.4.5, §19.4.3).
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.view
 */
export function minimapTooltip(options: {
  readonly layout: MinimapLayout;
  readonly cuts: readonly MapMark[];
  readonly pieces: readonly StripPiece[];
  readonly brackets: readonly NamedBracket[];
  readonly marks: readonly NamedMark[];
  readonly x: number;
  readonly y: number;
}): string {
  const { layout, x, y } = options;
  const strip = segmentStripTooltipText({
    strip: layout.segmentStripRect,
    cuts: options.cuts,
    pieces: options.pieces,
    x,
    y,
  });
  if (strip.length > 0) return strip;
  const zone = zoneBracketTooltipText(layout, options.brackets, x, y);
  if (zone.length > 0) return zone;
  const mark = bookmarkAtMarkPoint(layout, options.marks, x, y);
  if (mark === undefined) return "";
  const address = hexAddress(mark.offset);
  return mark.name.length === 0 ? address : `${address}: ${mark.name}`;
}
