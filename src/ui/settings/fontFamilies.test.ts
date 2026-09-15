import { describe, expect, it } from "vitest";
import { hexFontStack, MONOSPACE_STACK } from "@/render/hexGrid/fontMetrics";
import {
  MONOSPACED_CANDIDATES,
  monospacedFontFamilies,
  type TextWidth,
} from "@/ui/settings/fontFamilies";

/**
 * The Appearance tab's font list and what a chosen family draws with —
 * upstream's `AppearanceSettingsTests` where they are about fonts.
 */

interface Face {
  readonly narrow: number;
  readonly wide: number;
}

/**
 * A machine measured without a canvas: the named faces are installed, and a
 * font naming any other family measures as its fallback.
 */
function machine(installed: Readonly<Record<string, Face>>): TextWidth {
  const serif: Face = { narrow: 5, wide: 15 };
  const monospace: Face = { narrow: 9, wide: 9 };
  return (font, text) => {
    const family = /"([^"]+)"/.exec(font)?.[1];
    const face =
      family !== undefined && installed[family] !== undefined
        ? installed[family]
        : font.endsWith("serif")
          ? serif
          : monospace;
    return text.startsWith("i") ? face.narrow * text.length : face.wide * text.length;
  };
}

describe("the monospaced families", () => {
  // Sorted, and only the fixed-pitch ones.
  // @upstream ByteRipperTests/AppearanceSettingsTests.swift#AppearanceSettingsTests.testMonospacedFamiliesAreSortedAndFixedPitch
  it("are the installed fixed-pitch ones, in order", () => {
    const families = monospacedFontFamilies(
      machine({
        Menlo: { narrow: 10, wide: 10 },
        Consolas: { narrow: 11, wide: 11 },
        // Installed, and on the list, but not fixed-pitch.
        "Courier New": { narrow: 4, wide: 14 },
      })
    );

    expect(families).toEqual(["Consolas", "Menlo"]);
    expect(MONOSPACED_CANDIDATES).toEqual([...MONOSPACED_CANDIDATES].sort());
  });

  it("are none where nothing can be measured", () => {
    expect(monospacedFontFamilies(undefined)).toEqual([]);
  });
});

describe("the font a family draws with", () => {
  // A family the machine does not have still draws in a monospaced face: the
  // platform's own sit behind it in the stack.
  // @upstream ByteRipperTests/AppearanceSettingsTests.swift#AppearanceSettingsTests.testFontResolutionFallsBackToSystemMonospaced
  it("falls back to the platform's monospaced faces", () => {
    expect(hexFontStack("No Such Family")).toBe(`"No Such Family", ${MONOSPACE_STACK}`);
    expect(hexFontStack("")).toBe(MONOSPACE_STACK);
  });

  it("cannot be broken out of by a quote in the name", () => {
    expect(hexFontStack('Evil", serif')).toBe(`"Evil, serif", ${MONOSPACE_STACK}`);
  });
});
