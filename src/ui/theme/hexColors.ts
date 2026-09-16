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
  /**
   * The address's leading zeros on a filled mark. Upstream dims the mark's own
   * ink (`mutedBookmarkText`), so this is `--bookmark-text` at reduced alpha,
   * exactly as `--address-text-muted` is `--address-text` dimmed.
   *
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.mutedBookmarkText
   */
  mutedBookmarkAddress: "--bookmark-text-muted",
  /** @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.indicatorInk */
  indicator: "--find-indicator-ink",
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
  /**
   * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.findIndicatorFill
   * @upstream-differs a light lemon rather than the platform's find yellow, by the owner's choice
   */
  findIndicator: "--find-indicator",
  /** @web-only the outline the web edition's flat find indicator has in place of upstream's shadow (GAPS.md G9) */
  findIndicatorBorder: "--find-indicator-border",
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

/**
 * Whether the page is currently drawn dark.
 *
 * Upstream asks the view's `NSAppearance` where a colour has to be resolved by
 * hand. The web equivalent is the root's `data-theme` attribute — which a
 * manual choice in Settings writes — and, where that is not set, the system's
 * own preference, which is what the theme's media query follows.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.saturatedHighlight
 * @upstream-differs the root's data-theme attribute and the system preference, not an NSAppearance
 */
export function isDarkTheme(element: Element = document.documentElement): boolean {
  const forced = element.getAttribute("data-theme");
  if (forced === "dark") return true;
  if (forced === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/** A colour split into the three channels a tint is reasoned about in. */
interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

/** Reads `rgb()`, `rgba()` or a hex colour; `undefined` for anything else. */
function parseColor(color: string): Rgb | undefined {
  const text = color.trim();
  const functional = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (functional !== null) {
    const parts = (functional[1] ?? "").split(/[\s,/]+/).filter((part) => part.length > 0);
    const [r, g, b, a] = parts.map((part) => Number.parseFloat(part));
    if (r !== undefined && g !== undefined && b !== undefined) {
      return { r, g, b, alpha: a === undefined || Number.isNaN(a) ? 1 : a };
    }
    return undefined;
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex === null) return undefined;
  const digits = hex[1] ?? "";
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  const value = Number.parseInt(full, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff, alpha: 1 };
}

function toHsb({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const span = max - min;
  let hue = 0;
  if (span !== 0) {
    if (max === red) hue = ((green - blue) / span) % 6;
    else if (max === green) hue = (blue - red) / span + 2;
    else hue = (red - green) / span + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return { h: hue, s: max === 0 ? 0 : span / max, v: max };
}

function fromHsb(h: number, s: number, v: number, alpha: number): string {
  const sector = ((h % 1) + 1) % 1;
  const index = Math.floor(sector * 6);
  const fraction = sector * 6 - index;
  const p = v * (1 - s);
  const q = v * (1 - fraction * s);
  const t = v * (1 - (1 - fraction) * s);
  // The six sectors of the hue wheel, each as the three channels it mixes.
  const sectors: readonly (readonly [number, number, number])[] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  const [r, g, b] = sectors[index % 6] ?? [v, v, v];
  const channel = (value: number) => Math.round(value * 255);
  return alpha < 1
    ? `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${alpha})`
    : `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

/**
 * A tint made louder without being made a different colour.
 *
 * The piece under the pointer is drawn in "the same colour, just louder", so
 * that the strip says which piece is being asked about without changing which
 * colour it is (§19.4.4). The tints are pastels, so a fixed step rather than a
 * multiplier is what makes a pale tint read as louder.
 *
 * Which step depends on the theme. In dark theme the tints sit at the dark end
 * of their range, where saturation alone does not lift a 6 pt band off the
 * near-black paper, so the brightness moves too. In light theme the tints are
 * bright enough to read against white paper and only the saturation moves —
 * except the green, whose pale hue reads as near-white at full brightness: its
 * hover dips the brightness and pushes the saturation further, so the band
 * reads as a weighty green rather than a wash.
 *
 * @upstream ByteRipperApp/Hex/HexView.swift#HexTheme.saturatedHighlight
 */
export function saturatedHighlight(color: string, isDark: boolean): string {
  const parsed = parseColor(color);
  // A colour that cannot be read is returned unchanged, as `withAlpha` returns
  // it: too quiet is a visible answer, and a wrong hue would not be.
  if (parsed === undefined) return color;
  const { h, s, v } = toHsb(parsed);
  const green = !isDark && h >= 0.25 && h <= 0.45;
  const saturation = Math.min(1, s + (isDark ? 0.2 : green ? 0.45 : 0.3));
  const brightness = isDark ? Math.min(1, v + 0.35) : green ? Math.max(0, v - 0.12) : v;
  return fromHsb(h, saturation, brightness, parsed.alpha);
}
