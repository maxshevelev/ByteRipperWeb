/**
 * How many bytes a dump row holds.
 *
 * Sixteen, and not a setting: the whole application is built on it — the
 * offset column's addresses, a bookmark marking a row rather than a byte, the
 * minimap's sixteen cells across. CLAUDE.md states it as a rule of the project
 * rather than a preference.
 *
 * It lives in the domain rather than in the renderer because the things that
 * need it are not all drawings. A bookmark is a row, and `src/core` may not
 * import from `src/render` (D1) — so the renderer takes it from here instead of
 * the other way round.
 */
export const BYTES_PER_ROW = 16;
