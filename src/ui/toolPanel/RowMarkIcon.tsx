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
 * What an SF Symbol leaves out of a filled shape. A browser draws the shape and
 * the mark over it instead, in the colour the hex view already puts on a filled
 * glyph (`ToolbarIcons`), so a filled mark reads the same here as there.
 */
const KNOCKOUT = "#fff";

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
            stroke={KNOCKOUT}
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <circle cx="8" cy="12" r="1.05" fill={KNOCKOUT} />
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
            stroke={KNOCKOUT}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.7" r="1" fill={KNOCKOUT} />
        </>
      );

    // `checkmark.seal.fill`: a rosette with a tick on it.
    case "newest":
      return (
        <>
          <path
            fill="currentColor"
            d="M8 1 9.6 2.2l2 .1.6 1.9 1.7 1.1-.7 1.9.7 1.9-1.7 1.1-.6 1.9-2 .1L8 15l-1.6-1.2-2-.1-.6-1.9L2.1 10.7l.7-1.9-.7-1.9 1.7-1.1.6-1.9 2-.1z"
          />
          <path
            d="M5.5 8.1 7.2 9.9l3.4-3.8"
            fill="none"
            stroke={KNOCKOUT}
            strokeWidth="1.7"
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
            stroke={KNOCKOUT}
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
          <path d="M8 5.3a1.8 1.8 0 0 0-.9 3.3v2.1h1.8V8.6A1.8 1.8 0 0 0 8 5.3" fill={KNOCKOUT} />
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
