import { ROW_HEIGHT_SCALE_RANGE } from "@/state/settingsStore";

/**
 * The words the Settings tabs put beside their controls, kept out of the
 * components so they can be checked without a DOM.
 */

/**
 * The row-height factor as the slider's label reads it: `0.8×`, `0.65×`, `1×`.
 *
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.formatScale
 */
export function formatScale(scale: number): string {
  return `${Number(scale.toPrecision(2))}×`;
}

/** @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.formatFontSize */
export function formatFontSize(size: number): string {
  return `${Math.trunc(size)} pt`;
}

/**
 * The slider's value on the 0.05 grid and inside its range, so the stored
 * value is exactly a tick.
 *
 * @upstream ByteRipperApp/Settings/SettingsWindowController.swift#AppearanceSettingsViewController.scaleChanged
 */
export function snapRowHeightScale(value: number): number {
  const snapped = Math.round(value / 0.05) * 0.05;
  return Math.min(ROW_HEIGHT_SCALE_RANGE.upper, Math.max(ROW_HEIGHT_SCALE_RANGE.lower, snapped));
}

/**
 * `256 bytes (16 rows)`: the byte count is what the grouping measures, the row
 * count is how it reads on screen.
 *
 * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettingsViewController.title
 */
export function groupingGapTitle(gap: number): string {
  const rows = Math.floor(gap / 16);
  return `${gap} bytes (${rows} row${rows === 1 ? "" : "s"})`;
}

/** `1 Byte`, `4 Bytes` — the Layout tab's word size choices. */
export function wordSizeChoiceTitle(size: number): string {
  return size === 1 ? "1 Byte" : `${size} Bytes`;
}

/**
 * What is wrong with a placeholder as typed, or nothing when it is one
 * character.
 *
 * @upstream ByteRipperApp/Settings/TextDecodingSettingsViewController.swift#TextDecodingSettingsViewController.controlTextDidChange
 * @upstream-differs a character is a code point here, where Swift counts grapheme clusters
 */
export function placeholderProblem(text: string): string | undefined {
  const count = [...text].length;
  if (count === 0) return "Enter a character";
  if (count > 1) return "Exactly one character";
  return undefined;
}
