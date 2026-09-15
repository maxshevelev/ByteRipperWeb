/**
 * The last byte pattern Fill Selection used, so the next fill starts from it
 * rather than always from `FF`.
 *
 * Upstream keeps it in `UserDefaults`; the browser's counterpart is
 * `localStorage`, which can throw outright in a private window — so a failure to
 * read it means the default, and a failure to write it forgets the pattern
 * rather than failing the fill.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FillPatternStore
 */

/** The two calls this needs of `localStorage`, so a test can hand over its own. */
export interface PatternStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** @upstream ByteRipperApp/Documents/SheetControllers.swift#FillPatternStore.userDefaultsKey */
export const FILL_PATTERN_STORAGE_KEY = "byteripper.lastFillPattern";

/** @upstream ByteRipperApp/Documents/SheetControllers.swift#FillPatternStore.defaultPattern */
export const DEFAULT_FILL_PATTERN = "FF";

let storage: PatternStorage | undefined;

/** Points the store at another storage: a test's memory one. */
export function setFillPatternStorage(next: PatternStorage | undefined): void {
  storage = next;
}

const patterns = (): PatternStorage => storage ?? localStorage;

/**
 * The last pattern the user filled with, or the default when none is saved.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FillPatternStore.last
 */
export function lastFillPattern(): string {
  try {
    return patterns().getItem(FILL_PATTERN_STORAGE_KEY) ?? DEFAULT_FILL_PATTERN;
  } catch {
    return DEFAULT_FILL_PATTERN;
  }
}

/**
 * Keeps `pattern` — as typed, trimmed of the space around it — to offer next time.
 *
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#FillPatternStore.save
 */
export function saveFillPattern(pattern: string): void {
  try {
    patterns().setItem(FILL_PATTERN_STORAGE_KEY, pattern.trim());
  } catch {
    // A browser that will not store it offers the default next time.
  }
}
