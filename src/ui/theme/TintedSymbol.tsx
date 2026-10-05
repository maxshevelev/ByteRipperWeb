/**
 * The symbols the app draws itself, by the names upstream asks the system for.
 * Each is a glyph on a 16-unit square: a line glyph is a stroke, a filled one
 * is a shape whose mark is a hole in it — an even-odd path, not a second
 * colour laid over the fill.
 */
export type TintedSymbolName = "checkmark" | "checkmark.circle" | "exclamationmark.octagon.fill";

const GLYPHS: Record<TintedSymbolName, { readonly path: string; readonly filled: boolean }> = {
  checkmark: { path: "M3.2 8.6 6.4 11.8 12.8 4.6", filled: false },
  "checkmark.circle": {
    path: "M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4ZM5 8.2 7.2 10.4 11 5.8",
    filled: false,
  },
  // The octagon, then the bar and the dot of its mark: with the even-odd rule
  // the two are holes in the fill, so the mark takes the colour of whatever the
  // symbol sits on — on either theme.
  "exclamationmark.octagon.fill": {
    path: "M5.31 1.5H10.69L14.5 5.31V10.69L10.69 14.5H5.31L1.5 10.69V5.31ZM7.2 4.2H8.8V9.4H7.2ZM7.2 10.4H8.8V12H7.2Z",
    filled: true,
  },
};

/**
 * A symbol filled with `color`, which is any CSS colour — a variable of the
 * theme, or `currentColor` to follow the text it sits in. The colour is
 * resolved where the symbol is drawn, so it follows the theme the page is in.
 *
 * The one way the app tints a symbol it cannot hand to a control's own colour:
 * an alert's icon, the tick inside a value. A symbol drawn two ways by two
 * places — a stroke here, a mask there — would not stay the same shape.
 *
 * @upstream Packages/AppPalette/Sources/AppPalette/TintedSymbol.swift#NSImage.tintedSymbol
 * @upstream-differs a component drawing an inline SVG, where upstream draws the
 * system symbol as a mask and fills it: the shapes are this file's own, after
 * the names the system has
 */
export function TintedSymbol({
  name,
  color,
  label,
  className,
}: {
  readonly name: TintedSymbolName;
  readonly color: string;
  /** What the symbol says to a reader who cannot see it; without one it is decoration. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}) {
  const glyph = GLYPHS[name];
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      style={{ color }}
    >
      <path
        d={glyph.path}
        fill={glyph.filled ? "currentColor" : "none"}
        fillRule="evenodd"
        stroke={glyph.filled ? "none" : "currentColor"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
