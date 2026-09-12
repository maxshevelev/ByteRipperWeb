import type { InkRole } from "@/render/hexGrid/byteStyle";
import type { HexGridColors } from "@/render/hexGrid/hexGridRenderer";

/**
 * The renderer's colours, read out of the theme's CSS variables.
 *
 * A canvas cannot use a CSS variable — it needs a resolved colour string — so
 * the variables are read once per theme change and handed over. The palette
 * itself stays in `theme.css`, ported from `AppPalette`, which keeps one place
 * to change a colour in and keeps the canvas honest about following the theme.
 */

const VARIABLES: Record<keyof HexGridColors, string> = {
  byte: "--byte-text",
  mutedByte: "--byte-text-muted",
  modified: "--byte-modified",
  address: "--address-text",
  mutedAddress: "--address-text-muted",
  bookmarkAddress: "--bookmark-text",
  background: "--surface",
  selection: "--selection",
  eofHatch: "--eof-hatch",
  difference: "--difference-fill",
  peerSelection: "--peer-selection",
  caret: "--caret",
  insertCaret: "--insert-caret",
  matchFill: "--match-fill",
  currentMatchFill: "--current-match-fill",
  bookmark: "--bookmark",
};

/** Reads the palette as it currently resolves on `element`. */
export function readHexColors(element: Element = document.documentElement): HexGridColors {
  const computed = getComputedStyle(element);
  const read = (name: string) => computed.getPropertyValue(name).trim();

  const colors = {} as Record<keyof HexGridColors, string>;
  for (const [role, variable] of Object.entries(VARIABLES) as [keyof HexGridColors, string][]) {
    colors[role] = read(variable);
  }
  return colors as HexGridColors;
}

/**
 * Calls `onChange` whenever the resolved palette could have changed: the
 * viewer's system theme, or a manual override written onto the root element.
 */
export function observeHexColors(onChange: () => void): () => void {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
  });

  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

/** Every ink role, for the atlas's own bookkeeping. */
export type { InkRole };
