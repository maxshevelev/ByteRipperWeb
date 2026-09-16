import { afterEach, describe, expect, it, vi } from "vitest";
import { isDarkTheme, saturatedHighlight } from "@/ui/theme/hexColors";

/**
 * The hovered segment band's tint, and which theme is in force.
 *
 * Ported from `HexTheme.saturatedHighlight`, and the expectation is upstream's:
 * the band under the pointer is the *same hue*, made louder. A test that only
 * checked "different from the tint" would pass for a hue change, which is the
 * one thing this must not do — the tint is the piece's identity.
 *
 * The inputs are the palette's own tints, read from `theme.css`, so a change
 * there that broke the hover would break here.
 */

/** The palette as it resolves in each theme: `--segment-0` … `--segment-5`. */
const LIGHT_TINTS = ["#d6f0d6", "#f7d9e0", "#d6e6fa", "#faf2cc", "#e3d9f7", "#fce3d1"];
const DARK_TINTS = ["#29402b", "#4a2b36", "#29384d", "#4a4526", "#3b304f", "#4f3b29"];

/** A colour split into the channels the rule is stated in. */
function toHsb(color: string): { h: number; s: number; v: number } {
  const match = /^rgba?\(([^)]+)\)$/.exec(color);
  expect(match, `${color} should be a resolved rgb() colour`).not.toBeNull();
  const parts = (match?.[1] ?? "").split(/[\s,/]+/).filter((part) => part.length > 0);
  const [r = 0, g = 0, b = 0] = parts.map((part) => Number.parseFloat(part) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  let hue = 0;
  if (span !== 0) {
    if (max === r) hue = ((g - b) / span) % 6;
    else if (max === g) hue = (b - r) / span + 2;
    else hue = (r - g) / span + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return { h: hue, s: max === 0 ? 0 : span / max, v: max };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a hovered segment band's tint", () => {
  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testHoveringAStripBlockPaintsItMoreSaturated
  it("keeps every tint's hue in dark theme, and lifts both saturation and brightness", () => {
    for (const tint of DARK_TINTS) {
      const before = toHsb(resolve(tint));
      const after = toHsb(saturatedHighlight(tint, true));
      expect(after.h).toBeCloseTo(before.h, 2);
      expect(after.s).toBeCloseTo(Math.min(1, before.s + 0.2), 2);
      expect(after.v).toBeCloseTo(Math.min(1, before.v + 0.35), 2);
    }
  });

  // @upstream ByteRipperTests/MinimapTests.swift#MinimapTests.testHoveringAStripBlockPaintsItMoreSaturated
  it("keeps every tint's hue in light theme, and moves only the saturation", () => {
    // The green (tint 0) is the exception, and has the test below.
    for (const tint of LIGHT_TINTS.slice(1)) {
      const before = toHsb(resolve(tint));
      const after = toHsb(saturatedHighlight(tint, false));
      expect(after.h).toBeCloseTo(before.h, 2);
      expect(after.v).toBeCloseTo(before.v, 2);
      expect(after.s).toBeCloseTo(Math.min(1, before.s + 0.3), 2);
    }
  });

  // @web-only upstream tests the hover's general rule (testHoveringAStripBlockPaintsItMoreSaturated) but not the green branch of HexTheme.saturatedHighlight, whose numbers are only in its own doc comment
  it("treats the light theme's green differently: louder, and heavier", () => {
    // The pale green reads as near-white at full brightness, so saturation
    // alone would leave it a wash. Its hover pushes further and dips the
    // brightness — the one tint where the brightness moves in light theme.
    const green = toHsb(resolve(LIGHT_TINTS[0] ?? ""));
    const hovered = toHsb(saturatedHighlight(LIGHT_TINTS[0] ?? "", false));
    expect(green.h).toBeGreaterThanOrEqual(0.25);
    expect(green.h).toBeLessThanOrEqual(0.45);
    expect(hovered.s).toBeCloseTo(Math.min(1, green.s + 0.45), 2);
    expect(hovered.v).toBeCloseTo(green.v - 0.12, 2);

    // And the neighbours on either side of the green band take the ordinary step.
    for (const tint of [LIGHT_TINTS[1] ?? "", LIGHT_TINTS[2] ?? "", LIGHT_TINTS[5] ?? ""]) {
      const before = toHsb(resolve(tint));
      expect(toHsb(saturatedHighlight(tint, false)).v).toBeCloseTo(before.v, 2);
    }
  });

  it("makes a pale tint louder rather than a different colour", () => {
    // "The same colour, just louder" (§19.4.4): saturation never falls, and the
    // green's is the only hue whose brightness is ever lowered.
    for (const tint of [...LIGHT_TINTS, ...DARK_TINTS]) {
      const before = toHsb(resolve(tint));
      const after = toHsb(saturatedHighlight(tint, true));
      expect(after.s).toBeGreaterThanOrEqual(before.s);
      expect(after.v).toBeGreaterThanOrEqual(before.v);
    }
  });

  it("clamps at full saturation and full brightness rather than running past them", () => {
    const loud = saturatedHighlight("rgb(255, 0, 0)", true);
    expect(toHsb(loud)).toEqual({ h: 0, s: 1, v: 1 });
    // Brightness already at 1 and saturation already at 1: the colour stands.
    expect(saturatedHighlight("rgb(255, 0, 0)", false)).toBe("rgb(255, 0, 0)");
  });

  it("carries the tint's alpha through, so a translucent tint stays translucent", () => {
    const hovered = saturatedHighlight("rgba(214, 240, 214, 0.5)", false);
    expect(hovered.startsWith("rgba(")).toBe(true);
    expect(hovered.endsWith(", 0.5)")).toBe(true);
  });

  it("returns a colour it cannot read unchanged", () => {
    // The palette can be mid-swap. A band left as it was is quiet; a band
    // repainted in a guessed hue would say the wrong thing about its piece.
    expect(saturatedHighlight("color-mix(in oklab, red, blue)", true)).toBe(
      "color-mix(in oklab, red, blue)"
    );
    expect(saturatedHighlight("", false)).toBe("");
  });
});

describe("which theme is in force", () => {
  const root = (theme: string | null) => ({ getAttribute: () => theme }) as unknown as Element;

  it("follows a manual choice, whatever the system prefers", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(isDarkTheme(root("dark"))).toBe(true);
    expect(isDarkTheme(root("light"))).toBe(false);
  });

  it("falls back to the system preference when nothing is chosen", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(isDarkTheme(root(null))).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(isDarkTheme(root(null))).toBe(false);
  });
});

/** `rgb()` as the browser resolves a hex tint — what `getComputedStyle` gives. */
function resolve(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match === null) return color;
  const value = Number.parseInt(match[1] ?? "", 16);
  return `rgb(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff})`;
}
