import { expect, test } from "vitest";
import { withAlpha } from "@/render/minimap/minimapRenderer";

// The renderer itself needs a canvas; what is testable without one is the
// colour arithmetic the tone scale rests on. The drawing is checked in the
// browser, and the paint page measures it.

test("a resolved rgb colour takes an alpha", () => {
  expect(withAlpha("rgb(20, 30, 40)", 0.5)).toBe("rgba(20, 30, 40, 0.5)");
  expect(withAlpha("rgb(20 30 40)", 0.25)).toBe("rgba(20, 30, 40, 0.25)");
  expect(withAlpha("rgba(20, 30, 40, 0.8)", 0.1)).toBe("rgba(20, 30, 40, 0.1)");
});

test("a hex colour takes an alpha", () => {
  expect(withAlpha("#102030", 0.5)).toBe("rgba(16, 32, 48, 0.5)");
  expect(withAlpha("#123", 1)).toBe("rgba(17, 34, 51, 1)");
});

test("a colour that cannot be read is drawn at full strength, not dropped", () => {
  expect(withAlpha("color(display-p3 0.1 0.2 0.3)", 0.5)).toBe("color(display-p3 0.1 0.2 0.3)");
  expect(withAlpha("", 0.5)).toBe("");
});
