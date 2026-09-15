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

/**
 * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme
 * @upstream-differs the colours are CSS custom properties in theme.css, read once per theme change
 */
const VARIABLES: Record<keyof HexGridColors, string> = {
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.byteText */
  byte: "--byte-text",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.mutedByteText */
  mutedByte: "--byte-text-muted",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.modifiedText */
  modified: "--byte-modified",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.inkBlue */
  address: "--address-text",
  /**
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.mutedInkBlue
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.mutedTextColor
   */
  mutedAddress: "--address-text-muted",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.bookmarkTextColor */
  bookmarkAddress: "--bookmark-text",
  background: "--surface",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.selectionFill */
  selection: "--selection",
  /**
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.eofHatch
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.eofFill
   * @upstream-differs one hatch colour; the cell beneath keeps the surface
   */
  eofHatch: "--eof-hatch",
  /**
   * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#DifferenceColors
   * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#DifferenceColors.fill
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.differenceFill
   */
  difference: "--difference-fill",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.mirrorFrame */
  peerSelection: "--peer-selection",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.caretColor */
  caret: "--caret",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.insertCaretColor */
  insertCaret: "--insert-caret",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.matchFill */
  matchFill: "--match-fill",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.findIndicatorFill */
  currentMatchFill: "--current-match-fill",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.bookmarkColor */
  bookmark: "--bookmark",
  /**
   * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#ZoneColors
   * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#ZoneColors.focused
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.zoneFrame
   */
  zoneFocused: "--zone-focused",
  /**
   * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#ZoneColors.other
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.zoneFrameInactive
   */
  zoneOther: "--zone-other",
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

/**
 * The segment tints, in the order the pieces take them.
 *
 * Pastels, and deliberately few: they are paper under bytes, and a palette long
 * enough never to repeat would have to reach colours that stop being paper. Six
 * is what upstream uses, and the seventh piece takes the first tint again.
 */
export const SEGMENT_TINT_COUNT = 6;

/**
 * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#SegmentTints
 * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#SegmentTints.all
 * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#SegmentTints.tint
 * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.segmentTints
 */
export function readSegmentTints(element: Element = document.documentElement): string[] {
  const computed = getComputedStyle(element);
  const tints: string[] = [];
  for (let index = 0; index < SEGMENT_TINT_COUNT; index++) {
    tints.push(computed.getPropertyValue(`--segment-${index}`).trim());
  }
  return tints;
}
