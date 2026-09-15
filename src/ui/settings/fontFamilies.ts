/**
 * The monospaced families a browser can draw the dump in.
 *
 * A page cannot list the fonts installed on the machine, so the usual
 * monospaced families are measured instead. A family counts when it is there —
 * measured over two different fallbacks it comes out the same, where a missing
 * one takes the shape of each fallback in turn — and when its narrow and wide
 * glyphs are one width, which is what upstream's `isFixedPitch` asks.
 */

/** The families asked about, in the alphabetical order the popup lists them. */
export const MONOSPACED_CANDIDATES: readonly string[] = [
  "Andale Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Courier New",
  "DejaVu Sans Mono",
  "Fira Code",
  "Fira Mono",
  "Hack",
  "IBM Plex Mono",
  "Inconsolata",
  "JetBrains Mono",
  "Liberation Mono",
  "Lucida Console",
  "Menlo",
  "Monaco",
  "PT Mono",
  "Roboto Mono",
  "SF Mono",
  "Source Code Pro",
  "Ubuntu Mono",
];

/** How wide `text` is in the CSS `font`. */
export type TextWidth = (font: string, text: string) => number;

const NARROW = "iiiiiiiiii";
const WIDE = "MMMMMMMMMM";

/** A canvas's measurement, where there is a document to make a canvas in. */
function canvasWidth(): TextWidth | undefined {
  if (typeof document === "undefined") return undefined;
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) return undefined;
  return (font, text) => {
    context.font = font;
    return context.measureText(text).width;
  };
}

/**
 * @upstream ByteRipperApp/Settings/AppearanceSettings.swift#AppearanceSettings.monospacedFontFamilies
 * @upstream-differs a browser cannot enumerate the installed families, so a list of the usual monospaced ones is measured
 */
export function monospacedFontFamilies(width: TextWidth | undefined = canvasWidth()): string[] {
  if (width === undefined) return [];
  return MONOSPACED_CANDIDATES.filter((family) => {
    const overSerif = width(`40px "${family}", serif`, WIDE);
    if (width(`40px "${family}", monospace`, WIDE) !== overSerif) return false;
    return width(`40px "${family}", serif`, NARROW) === overSerif;
  });
}
