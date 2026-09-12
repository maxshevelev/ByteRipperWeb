import type { MinimapColors } from "@/render/minimap/minimapRenderer";

/**
 * The minimap's colours, read out of the theme's CSS variables.
 *
 * The same contract the hex grid's palette has, and mostly the same variables:
 * a map that used its own colours would say a different thing from the dump
 * beside it about the same byte.
 */

const VARIABLES: Record<keyof MinimapColors, string> = {
  background: "--surface",
  selection: "--selection",
  findIndicator: "--find-indicator",
  byte: "--byte-text",
  mutedByte: "--byte-text-muted",
  modified: "--byte-modified",
  difference: "--difference-fill",
  matchFill: "--match-fill",
  bookmark: "--bookmark",
  currentMatchFill: "--current-match-fill",
};

export function readMinimapColors(element: Element = document.documentElement): MinimapColors {
  const computed = getComputedStyle(element);
  const colors = {} as Record<keyof MinimapColors, string>;
  for (const [role, variable] of Object.entries(VARIABLES) as [keyof MinimapColors, string][]) {
    colors[role] = computed.getPropertyValue(variable).trim();
  }
  return colors as MinimapColors;
}
