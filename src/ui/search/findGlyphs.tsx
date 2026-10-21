/**
 * The Find bar's glyphs, which the UEFI panel's search bar wears too (upstream `6119ac9a`): a bar
 * that looks for things looks the same wherever it stands.
 */

const glyphStroke = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** `list.bullet`: Find All, the list of every match. */
export function ListGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" {...glyphStroke}>
      <path d="M6 4h8.5M6 8h8.5M6 12h8.5" />
      <circle cx="2.5" cy="4" r="0.6" />
      <circle cx="2.5" cy="8" r="0.6" />
      <circle cx="2.5" cy="12" r="0.6" />
    </svg>
  );
}

/** `chevron.left` / `chevron.right`. */
export function ChevronGlyph({ direction }: { readonly direction: "forward" | "backward" }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" {...glyphStroke}>
      <path d={direction === "forward" ? "m6 3 5 5-5 5" : "M10 3 5 8l5 5"} />
    </svg>
  );
}
