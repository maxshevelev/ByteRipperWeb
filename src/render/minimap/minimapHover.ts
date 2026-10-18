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
import { aroundPointer, type CalloutRect, type HoverMark } from "@/ui/callout/hoverCalloutGeometry";

/**
 * What hovering the map says: the segment strip's piece or cut, a zone's bracket,
 * a bookmark's mark — each named the way the list that holds it writes it, with
 * the glyph the callout wears for it and what the callout stands beside.
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
  /** The piece's own tint, not the louder one it is drawn in under the pointer. */
  readonly tint: string;
}

/** A bookmark's mark where it is painted, and the bookmark's name. */
export interface NamedMark extends MapMark {
  readonly name: string;
}

/** A zone's bracket where it is painted, and the zone's name. */
export interface NamedBracket extends ZoneBracketBox {
  /** @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.ZoneBracket.name */
  readonly name: string;
  /** Whether it is the zone in focus, which decides its colour. */
  readonly focused?: boolean | undefined;
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
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripHoverText
 */
export function segmentStripHoverText(options: {
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
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketHoverText
 */
export function zoneBracketHoverText(
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
 * hit, and a callout that only answers on the pixel is one nobody sees.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.bookmark
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.bookmarkMark
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
 * The glyph for a point on the segment strip, decided the way
 * {@link segmentStripHoverText} decides its words: a cut in reach is the two
 * pieces it separates, the one before it on top, as the strip draws them;
 * otherwise the piece under the point, in its own tint (§19.4.4).
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.segmentStripMark
 */
export function segmentStripMark(options: {
  readonly strip: Rect | undefined;
  readonly cuts: readonly MapMark[];
  readonly pieces: readonly StripPiece[];
  readonly x: number;
  readonly y: number;
}): HoverMark | undefined {
  const { strip, x, y, pieces } = options;
  if (strip === undefined || x < strip.x || x > strip.x + strip.width) return undefined;
  const cut = nearestCut(options.cuts, y);
  if (cut !== undefined) {
    const after = pieces.findIndex((piece) => piece.start === cut);
    const before = pieces[after - 1];
    const piece = pieces[after];
    if (after > 0 && before !== undefined && piece !== undefined) {
      return { kind: "cut", above: before.tint, below: piece.tint };
    }
  }
  const piece = pieces.find((one) => y >= one.top && y < one.top + one.height);
  return piece === undefined ? undefined : { kind: "segment", tint: piece.tint };
}

/**
 * The glyph for a point on a zone gutter: the bracket in the colour the gutter
 * draws it in — the focused zone's, or every other one's (§19.4.5).
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.zoneBracketMark
 */
export function zoneBracketMark(
  layout: MinimapLayout,
  brackets: readonly NamedBracket[],
  colors: { readonly focused: string; readonly other: string },
  x: number,
  y: number
): HoverMark | undefined {
  const bracket = zoneBracket(layout, brackets, x, y) as NamedBracket | undefined;
  if (bracket === undefined) return undefined;
  return { kind: "zone", color: bracket.focused === true ? colors.focused : colors.other };
}

/** What the callout on the map says, the glyph it wears, and what it stands beside. */
export interface MinimapHover {
  readonly text: string;
  readonly mark: HoverMark;
  /** In the map's own coordinates. */
  readonly anchor: CalloutRect;
}

/**
 * What hovering the map says, the glyph that says what kind of thing it is, and
 * what the callout stands beside: the segment strip's answer for a point on it,
 * the zone gutter's for a point on a bracket, else a bookmark's for a point on
 * its mark, else nothing. The two legends are asked before the marks: they are
 * what the reader reads, and theirs is the more specific answer where a mark's
 * grown box could reach one of them (§19.4.4, §19.4.5, §19.4.3).
 *
 * A mark's callout stands beside the mark, which is what it names; a legend's
 * follows the pointer, because a strip or a bracket is long and the part being
 * named is the part under the pointer.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.hoverCallout
 */
export function minimapHover(options: {
  readonly layout: MinimapLayout;
  readonly cuts: readonly MapMark[];
  readonly pieces: readonly StripPiece[];
  readonly brackets: readonly NamedBracket[];
  readonly marks: readonly NamedMark[];
  readonly zoneColors: { readonly focused: string; readonly other: string };
  readonly x: number;
  readonly y: number;
}): MinimapHover | undefined {
  const { layout, x, y } = options;
  const strip = {
    strip: layout.segmentStripRect,
    cuts: options.cuts,
    pieces: options.pieces,
    x,
    y,
  };
  const stripText = segmentStripHoverText(strip);
  const stripMark = segmentStripMark(strip);
  if (stripText.length > 0 && stripMark !== undefined) {
    return { text: stripText, mark: stripMark, anchor: aroundPointer(x, y) };
  }
  const zoneText = zoneBracketHoverText(layout, options.brackets, x, y);
  const zoneMark = zoneBracketMark(layout, options.brackets, options.zoneColors, x, y);
  if (zoneText.length > 0 && zoneMark !== undefined) {
    return { text: zoneText, mark: zoneMark, anchor: aroundPointer(x, y) };
  }
  const mark = bookmarkAtMarkPoint(layout, options.marks, x, y);
  if (mark === undefined) return undefined;
  const box = bookmarkMarkBox(layout, mark.y);
  if (box === undefined) return undefined;
  const address = hexAddress(mark.offset);
  return {
    text: mark.name.length === 0 ? address : `${address}: ${mark.name}`,
    mark: { kind: "bookmark" },
    anchor: { x: box.x, y: box.top, width: box.width, height: box.height },
  };
}

/**
 * Just the words of {@link minimapHover}, "" where it has none.
 *
 * @upstream ByteRipperApp/Minimap/MinimapView.swift#MinimapView.hoverText
 */
export function minimapHoverText(options: Parameters<typeof minimapHover>[0]): string {
  return minimapHover(options)?.text ?? "";
}
