import type { InputRegion } from "@/core/edit/typingController";
import { BOOKMARK_PADDING, PEER_CONTOUR_PADDING } from "@/render/hexGrid/hexGridRenderer";
import { BYTES_PER_ROW, type HexHit, type HexLayout } from "@/render/hexGrid/hexLayout";
import { contourNear, contourRowSpan, selectionContours } from "@/render/hexGrid/spanContour";
import { aroundPointer, type CalloutRect, type HoverMark } from "@/ui/callout/hoverCalloutGeometry";

/**
 * What a pointer in the hex grid means.
 *
 * Pure: the pane does the hit test with the layout and hands the result here,
 * with the pointer's x inside it, and gets back the byte the gesture is about,
 * the nibble of it and the column being typed into. The pane listens and acts;
 * this decides — the same split `hexKeys.ts` makes for the keyboard, and for
 * the same reason: every rule below is testable without a canvas.
 *
 * **Where in a byte a click lands decides the nibble.** In overwrite mode the
 * caret is the underline under one hex digit, so the threshold between the two
 * nibbles is the byte's centre and each nibble's zone reaches into the
 * inter-byte gaps beside it; in insert mode the caret is a vertical line and
 * the threshold stays on the middle of the high nibble's character. Both
 * thresholds are the same in the context menu's anchor, which is why one
 * function serves the left click and the right one.
 */

/** The byte a click lands on, and which half of it. */
export interface ClickPlacement {
  readonly column: number;
  /** 0 for the high nibble, 1 for the low one. */
  readonly nibble: 0 | 1;
}

/**
 * The byte and nibble a click at `x` places the caret on (§3.3). The column is
 * what `hitTest` reported; the returned one can differ by one when the click
 * sits in the gap before it (see below).
 *
 * Overwrite mode: the caret is the underline under one nibble character, so
 * each nibble's zone is the character it underlines plus the nearer half of
 * each adjacent inter-byte gap — the left nibble runs from the middle of the
 * preceding gap to the byte's centre, the right nibble from the centre to the
 * middle of the following gap. `hitTest` hands a whole gap to the *following*
 * byte, so a click in the gap's first half arrives as the following byte but
 * belongs to the previous byte's right nibble — the returned column is that
 * previous byte.
 *
 * Insert mode: the caret is a vertical line, so the byte is always the hit one
 * and the threshold stays where it was — the middle of the high-nibble
 * character, a large target so the mid-byte caret is easy to reach without
 * aiming at the gap.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.hexClickPlacement
 */
export function hexClickPlacement(
  layout: HexLayout,
  x: number,
  column: number,
  insertMode: boolean
): ClickPlacement {
  const byteX = layout.hexByteX(column);
  if (insertMode) return { column, nibble: x - byteX >= layout.charWidth / 2 ? 1 : 0 };
  if (x >= byteX) {
    // Inside the byte's own cell: the byte's centre splits the nibbles.
    return { column, nibble: x - byteX >= layout.charWidth ? 1 : 0 };
  }
  // In the gap before the byte — which exists only for column > 0, the row's
  // first byte starting the hex region. The gap's nearer half belongs to the
  // previous byte's right nibble; the far half to this byte's left nibble.
  if (column <= 0) return { column, nibble: 0 };
  const previous = column - 1;
  const gapMid = (layout.hexByteX(previous) + layout.hexByteWidth + byteX) / 2;
  return x < gapMid ? { column: previous, nibble: 1 } : { column, nibble: 0 };
}

/**
 * The nibble a right-click at `x` places the caret on, within `column`'s byte
 * (§10.2). Measured from the byte's own left edge with the same mode-dependent
 * threshold a left click uses. A click in the gap before the byte — where
 * `hitTest` still reports this byte — has no nibble to the left of it, so it
 * lands on the byte's left boundary.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.contextMenuCaretNibble
 */
function contextMenuCaretNibble(
  layout: HexLayout,
  x: number,
  column: number,
  insertMode: boolean
): 0 | 1 {
  const byteX = layout.hexByteX(column);
  if (x < byteX) return 0;
  if (!insertMode) return x - byteX >= layout.charWidth ? 1 : 0;
  return x - byteX >= layout.charWidth / 2 ? 1 : 0;
}

/**
 * What a right-click in the dump anchors its context menu to (§10.2).
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.ContextMenuAnchor
 */
export interface ContextMenuAnchor {
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexView.ContextMenuAnchor.offset */
  readonly offset: number;
  /**
   * True when the anchor is a single hex byte (the menu was opened on a byte in
   * the hex column); false when it is the Offset column's row address, whose
   * frame spans the whole column.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.ContextMenuAnchor.framesByte
   */
  readonly framesByte: boolean;
  /**
   * The nibble the caret lands on when the menu opens — the click's position
   * within the anchored byte for a hex-column click, 0 for the Offset column.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexView.ContextMenuAnchor.nibble
   */
  readonly nibble: 0 | 1;
}

/**
 * The anchor for a right-click context menu: the Offset column maps to the
 * row's start address, and the hex column maps to the clicked byte's own
 * offset. Returns `undefined` for the text column, the gaps, and anywhere past
 * EOF (the empty caret row, or a placeholder byte in a partial last row).
 *
 * The nibble is the right-clicked byte's — the same byte the menu frames — not
 * where a left-click's {@link hexClickPlacement} might send the caret, which for
 * a click in the gap before the byte would be the *previous* byte.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.contextMenuAnchor
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.rightClickedOffset
 */
export function contextMenuAnchor(
  layout: HexLayout,
  hit: HexHit,
  x: number,
  fileSize: number,
  insertMode: boolean
): ContextMenuAnchor | undefined {
  const anchor = anchorFor(layout, hit, x, insertMode);
  return anchor === undefined || anchor.offset >= fileSize ? undefined : anchor;
}

function anchorFor(
  layout: HexLayout,
  hit: HexHit,
  x: number,
  insertMode: boolean
): ContextMenuAnchor | undefined {
  switch (hit.column.kind) {
    case "offset":
      return { offset: layout.byteOffset(hit.row, 0), framesByte: false, nibble: 0 };
    case "hex": {
      const { column } = hit.column;
      return {
        offset: layout.byteOffset(hit.row, column),
        framesByte: true,
        nibble: contextMenuCaretNibble(layout, x, column, insertMode),
      };
    }
    case "text":
      return undefined;
  }
}

/** A point in content coordinates — the dump's own, not the element's. */
export interface GridPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Whether a drag that began at `origin` has moved far enough to extend the
 * selection, both points in content coordinates.
 *
 * A hex press that lands inside a byte's dead zone — from the middle of the
 * high-nibble character to the middle of the low-nibble one (§3.3) — sits on
 * the drag boundary `dragEndOffset` measures from, so a 1 px tremor there would
 * select the byte by accident. The selection is held back until the pointer
 * leaves the zone. The zone spans the pressed row, so vertical movement
 * engages too; a press outside it — a byte's outer quarters, or the offset and
 * text columns — is a clear position and engages at once.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.dragHasLeftDeadZone
 */
export function dragHasLeftDeadZone(
  layout: HexLayout,
  origin: GridPoint,
  point: GridPoint,
  rowCount: number
): boolean {
  const hit = layout.hitTest(origin.x, origin.y, rowCount);
  if (hit === undefined || hit.column.kind !== "hex") return true;
  const minX = layout.highNibbleMidX(hit.column.column);
  const maxX = layout.lowNibbleMidX(hit.column.column);
  const frame = layout.rowFrame(hit.row);
  const inZone = (p: GridPoint) =>
    p.x >= minX && p.x <= maxX && p.y >= frame.y && p.y <= frame.y + frame.height;
  if (!inZone(origin)) return true;
  return !inZone(point);
}

/** Where a left click puts the caret, and which column it types into. */
export interface PointerTarget {
  readonly offset: number;
  readonly region: InputRegion;
  /** 0 for the high nibble, 1 for the low one; always 0 outside the hex column. */
  readonly nibble: 0 | 1;
}

/**
 * What a left click at `x` does: the byte the caret lands on, the column it
 * types into, and where inside the byte it sits.
 *
 * A click past EOF lands on the last row's placeholder bytes; `moveCaret`
 * clamps it to the file's size, the same way it clamps an arrow key.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.handleMouse
 */
export function pointerTarget(
  layout: HexLayout,
  hit: HexHit,
  x: number,
  insertMode: boolean
): PointerTarget {
  switch (hit.column.kind) {
    case "offset":
      return { offset: layout.byteOffset(hit.row, 0), region: "hex", nibble: 0 };
    case "hex": {
      const placement = hexClickPlacement(layout, x, hit.column.column, insertMode);
      return {
        offset: layout.byteOffset(hit.row, placement.column),
        region: "hex",
        nibble: placement.nibble,
      };
    }
    case "text":
      return { offset: layout.byteOffset(hit.row, hit.column.column), region: "text", nibble: 0 };
  }
}

/**
 * How near a note's dashed outline the pointer has to be for the note to speak:
 * either side of the line.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.noteContourReach
 */
export const NOTE_CONTOUR_REACH = 4;

/** A note as the pane draws it: its stretch at the pane's own addresses. */
export interface NoteSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * The note whose outline runs under `(x, y)` — the innermost one where two
 * outlines meet there — or `undefined`. Only the notes whose outline reaches
 * the rows round the point are looked at: an outline further off cannot reach
 * it.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.noteContour
 */
export function noteContour<Note extends NoteSpan>(
  layout: HexLayout,
  notes: readonly Note[],
  fileSize: number,
  x: number,
  y: number
): Note | undefined {
  if (layout.rowHeight <= 0 || fileSize <= 0) return undefined;
  const row = Math.floor(y / layout.rowHeight);
  let found: Note | undefined;
  for (const note of notes) {
    const end = Math.min(note.end, fileSize);
    if (end <= note.start) continue;
    const rows = contourRowSpan(note.start, end);
    if (row + 1 < rows.first || row - 1 >= rows.end) continue;
    const contours = selectionContours(note.start, end, layout, PEER_CONTOUR_PADDING);
    if (!contourNear(contours, x, y, NOTE_CONTOUR_REACH)) continue;
    if (found === undefined || note.end - note.start < found.end - found.start) found = note;
  }
  return found;
}

/**
 * The box of a row's bookmark mark, which its callout stands beside: the
 * Offset column's frame and the padding the mark is drawn with.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkMarkRect
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.bookmarkMarkBody
 */
export function bookmarkMarkRect(layout: HexLayout, row: number): CalloutRect {
  const frame = layout.offsetColumnFrame(row);
  return {
    x: frame.x - BOOKMARK_PADDING,
    y: frame.y,
    width: frame.width + 2 * BOOKMARK_PADDING,
    height: frame.height,
  };
}

/** What the callout over the dump says, the glyph it wears, and what it stands beside. */
export interface HexHover {
  readonly text: string;
  readonly mark: HoverMark;
  /** In content coordinates: the pane turns it into the window's. */
  readonly anchor: CalloutRect;
}

/**
 * What the callout over the dump says for the pointer at `(x, y)`, or
 * `undefined` over anything with nothing to say. On an address it is the row's
 * bookmark, standing beside the mark — over the start of the row's bytes,
 * never over the address itself (§20.3). On a note's outline it is that note,
 * following the pointer along the line. Only on the outline: a note can cover
 * a whole region, and a callout up over every byte inside it would keep
 * covering the bytes being read. Nothing while a mark is being dragged: it is
 * on another row a moment later (§20.6).
 *
 * A named mark has the address. An address with nothing to say goes on to the
 * notes: the Offset column runs right up to the first byte, and the outer half
 * of a note's left edge lies in it — the same reach the right edge has over
 * the gap before the decoded text.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.updateHoverCallout
 * @upstream ByteRipperApp/Hex/HexView.swift#HexView.offsetColumnOffset
 */
export function hexHover<Note extends NoteSpan>(options: {
  readonly layout: HexLayout;
  readonly fileSize: number;
  readonly x: number;
  readonly y: number;
  readonly dragging: boolean;
  /** What the mark on the row starting at `offset` says; "" for nothing. */
  readonly bookmarkText: (offset: number) => string;
  readonly notes: readonly Note[];
  /** What a note says, and whether the person said it; `undefined` for nothing. */
  readonly noteText: (
    note: Note
  ) => { readonly text: string; readonly byPerson: boolean } | undefined;
  /** The two hues a note is drawn in. */
  readonly colors: { readonly person: string; readonly agent: string };
}): HexHover | undefined {
  const { layout, fileSize, x, y } = options;
  if (options.dragging) return undefined;
  const hit = layout.hitTest(x, y, layout.rowCount(fileSize));
  if (hit !== undefined && hit.column.kind === "offset") {
    const offset = hit.row * BYTES_PER_ROW;
    const text = options.bookmarkText(offset);
    if (text.length > 0) {
      return { text, mark: { kind: "bookmark" }, anchor: bookmarkMarkRect(layout, hit.row) };
    }
  }
  const note = noteContour(layout, options.notes, fileSize, x, y);
  const said = note === undefined ? undefined : options.noteText(note);
  if (said === undefined) return undefined;
  return {
    text: said.text,
    mark: {
      kind: "annotation",
      color: said.byPerson ? options.colors.person : options.colors.agent,
    },
    anchor: aroundPointer(x, y),
  };
}
