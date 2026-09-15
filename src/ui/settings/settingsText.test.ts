import { describe, expect, it } from "vitest";
import { GROUPING_GAP_CHOICES } from "@/state/settingsStore";
import {
  formatFontSize,
  formatScale,
  groupingGapTitle,
  placeholderProblem,
  snapRowHeightScale,
  wordSizeChoiceTitle,
} from "@/ui/settings/settingsText";

/** The words beside the Settings controls. */

describe("the appearance tab's labels", () => {
  it("read the row height as a short factor", () => {
    expect(formatScale(0.8)).toBe("0.8×");
    expect(formatScale(0.65)).toBe("0.65×");
    expect(formatScale(1)).toBe("1×");
    // A snapped value carries the arithmetic's dust, and the label does not.
    expect(formatScale(Math.round(0.83 / 0.05) * 0.05)).toBe("0.85×");
  });

  it("read the size in whole points", () => {
    expect(formatFontSize(13)).toBe("13 pt");
  });

  it("snaps the slider to its ticks and keeps it inside its range", () => {
    expect(snapRowHeightScale(0.83)).toBeCloseTo(0.85);
    expect(snapRowHeightScale(0.5)).toBe(0.65);
    expect(snapRowHeightScale(1.2)).toBe(1);
  });
});

describe("the comparison tab's choices", () => {
  // Every choice in bytes and rows. Which one is selected is the select's own
  // value, bound to the store.
  // @upstream ByteRipperTests/ComparisonSettingsTests.swift#ComparisonSettingsTests.testThePopupListsTheChoicesAndSelectsTheCurrentOne
  it("name each distance in bytes and in rows", () => {
    expect(GROUPING_GAP_CHOICES.map(groupingGapTitle)).toEqual([
      "16 bytes (1 row)",
      "32 bytes (2 rows)",
      "64 bytes (4 rows)",
      "256 bytes (16 rows)",
    ]);
  });
});

describe("the layout tab's word sizes", () => {
  it("say byte in the singular only for one", () => {
    expect([1, 2, 4, 8].map(wordSizeChoiceTitle)).toEqual([
      "1 Byte",
      "2 Bytes",
      "4 Bytes",
      "8 Bytes",
    ]);
  });
});

describe("the placeholder field", () => {
  it("asks for a character, and for exactly one", () => {
    expect(placeholderProblem("")).toBe("Enter a character");
    expect(placeholderProblem("ab")).toBe("Exactly one character");
    expect(placeholderProblem("·")).toBeUndefined();
    // One character that is two UTF-16 units is still one character.
    expect(placeholderProblem("😀")).toBeUndefined();
  });
});
