import { rowMarkSymbol } from "@/tools/toolRowMarkStyle";
import type { ToolRowMark } from "@/tools/toolRowMarks";

/**
 * One mark's glyph, drawn in the palette entry the catalogue gives it
 * (`Design/ROW_MARKS.md` §3, §4).
 *
 * Every firmware panel draws its marks here, so a row of the UEFI tree and a
 * row of the FIT table wearing the same mark wear the same picture in the same
 * colour — which is the whole point of the marks being a shared vocabulary.
 *
 * The symbol is named by `toolRowMarkStyle`, the same table the legend reads,
 * so a mark and its legend line cannot drift apart. The colour comes from
 * `.tool-row-mark[data-mark]` in the stylesheet, one rule per mark.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMark.symbol
 * @upstream-differs inline SVG shaped after the named SF Symbols: SF Symbols do
 * not ship to a browser
 */

/**
 * What an SF Symbol leaves out of a filled shape: the mark is a hole in it, and
 * what stands in the hole is the ground the mark is drawn on. A browser draws
 * the shape and the mark over it instead, so the hole is a colour — `--knockout`,
 * the same name `ToolbarIcons` punches its own marks through with. In the light
 * theme that is the white the mark used to be fixed at; in the dark theme it is
 * the panel, which is the point: a mark whose shape goes light takes its hole
 * with it, or the mark inside it is a white shape on a pale fill.
 *
 * Two objects rather than one, because a path takes either the stroke or the
 * fill and a mark that got both would be painted where it should be cut.
 *
 * They are `style`, not attributes: `stroke="var(--knockout)"` is a
 * presentation attribute, which SVG2 reads as a declaration and an engine that
 * has not caught up simply drops — and a mark that vanishes is worse than a
 * mark in the wrong colour. A declaration in `style` is read everywhere.
 */
const KNOCKOUT_STROKE = { stroke: "var(--knockout)" } as const;
const KNOCKOUT_FILL = { fill: "var(--knockout)" } as const;

/**
 * `size` is in pixels, because every panel here sizes its marks in pixels: the
 * UEFI tree at 13, the FIT table at 12.
 *
 * `label` and `title` are what a reader gets told about the mark: the name a
 * screen reader reads, and the lines the pointer shows. A mark drawn in a row
 * carries both — a mark drawn in the legend carries neither, being explained by
 * the line beside it.
 */
export function RowMarkIcon({
  mark,
  size = 13,
  label,
  title,
}: {
  readonly mark: ToolRowMark;
  readonly size?: number | undefined;
  readonly label?: string | undefined;
  readonly title?: string | undefined;
}) {
  if (rowMarkSymbol(mark) === undefined) return null;
  return (
    <span
      className="tool-row-mark"
      data-mark={mark}
      role="img"
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      title={title}
    >
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
        <Glyph mark={mark} />
      </svg>
    </span>
  );
}

/** The shape of one symbol, drawn to fill the 16-point box it is given. */
function Glyph({ mark }: { readonly mark: ToolRowMark }) {
  switch (mark) {
    // `exclamationmark.octagon.fill`.
    case "error":
      return (
        <>
          <path fill="currentColor" d="M5.4 1h5.2L15 5.4v5.2L10.6 15H5.4L1 10.6V5.4z" />
          <path
            d="M8 4.1v5.3"
            fill="none"
            style={KNOCKOUT_STROKE}
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <circle cx="8" cy="12" r="1.05" style={KNOCKOUT_FILL} />
        </>
      );

    // `exclamationmark.circle.fill`.
    case "caution":
      return (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path
            d="M8 3.8v4.9"
            fill="none"
            style={KNOCKOUT_STROKE}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.7" r="1" style={KNOCKOUT_FILL} />
        </>
      );

    // `checkmark.seal.fill`: the seal, with a tick cut out of it.
    //
    // The outline is SF Symbols' own, measured rather than drawn by eye: the
    // symbol was rendered by AppKit at 900 points, its silhouette walked along
    // 1440 rays from the centre, and that walk folded onto one eighth and
    // averaged. The folding is what makes it a seal — the eight lobes are one
    // measured lobe repeated, where twenty hand-written vertices could only
    // lean.
    //
    // Measured, it is a wave and not a scallop: the radius falls from 7 to 5.81
    // and back as a cosine of eight times the angle, with no corner anywhere on
    // the outline. Sixteen cubics — one shape and its mirror, eight times over —
    // follow it to within 0.7% of the radius, which is four hundredths of a
    // pixel at the 13 the panels draw it at. Arcs meeting in points, which is
    // what stood here, read as a flower and a little square.
    //
    // The tick is the hole SF Symbols leaves, measured from the same render: its
    // box spans 0.29 to 0.70 of the seal's width, and the stroke below is what
    // those numbers come to — 0.97 wide, round caps, round join.
    case "newest":
      return (
        <>
          <path
            fill="currentColor"
            d="M15 8C15 6.9 13.66 6.47 13.38 5.77C13.09 5.08 13.73 3.83 12.95 3.05C12.17 2.27 10.92 2.91 10.23 2.62C9.53 2.34 9.1 1 8 1C6.9 1 6.47 2.34 5.77 2.62C5.08 2.91 3.83 2.27 3.05 3.05C2.27 3.83 2.91 5.08 2.62 5.77C2.34 6.47 1 6.9 1 8C1 9.1 2.34 9.53 2.62 10.23C2.91 10.92 2.27 12.17 3.05 12.95C3.83 13.73 5.08 13.09 5.77 13.38C6.47 13.66 6.9 15 8 15C9.1 15 9.53 13.66 10.23 13.38C10.92 13.09 12.17 13.73 12.95 12.95C13.73 12.17 13.09 10.92 13.38 10.23C13.66 9.53 15 9.1 15 8z"
          />
          <path
            d="M5.55 8.35 7.28 10.5l3.06-4.73"
            fill="none"
            style={KNOCKOUT_STROKE}
            strokeWidth="0.97"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    // `arrow.up.circle`.
    case "newerListed":
      return (
        <>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M8 11.8V5.4M5.4 8 8 5.4 10.6 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    // `questionmark.circle`.
    case "newerMaybe":
      return (
        <>
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M6.1 6.3a2 2 0 0 1 3.9.6c0 1.3-2 1.6-2 2.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="8.1" cy="12" r="1" fill="currentColor" />
        </>
      );

    // `zipper.page`: a page whose leading edge is the zip, the teeth the teeth.
    case "compressed":
    case "compressedUndecoded":
      return (
        <>
          <path fill="currentColor" d="M2.6 1.5h10.8v13H2.6z" />
          <path
            d="M5.2 3.4h1.8M5.2 5.6h1.8M5.2 7.8h1.8M5.2 10h1.8M5.2 12.2h1.8"
            fill="none"
            style={KNOCKOUT_STROKE}
            strokeWidth="1.2"
            strokeLinecap="butt"
          />
        </>
      );

    // `lock.shield`: a shield with a keyhole punched through it.
    case "holdsChecks":
      return (
        <>
          <path
            fill="currentColor"
            d="M8 1.2 14 3.4v4.4c0 3.3-2.4 5.9-6 7-3.6-1.1-6-3.7-6-7V3.4z"
          />
          <path
            d="M8 5.3a1.8 1.8 0 0 0-.9 3.3v2.1h1.8V8.6A1.8 1.8 0 0 0 8 5.3"
            style={KNOCKOUT_FILL}
          />
        </>
      );

    // `shield.lefthalf.filled`.
    case "partlyProtected":
      return (
        <>
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            d="M8 1.2 14 3.4v4.4c0 3.3-2.4 5.9-6 7-3.6-1.1-6-3.7-6-7V3.4z"
          />
          <path fill="currentColor" d="M8 1.2 14 3.4v4.4c0 3.3-2.4 5.9-6 7z" />
        </>
      );

    default:
      return null;
  }
}
