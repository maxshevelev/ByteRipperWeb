/**
 * A byte count as a person reads it.
 *
 * Ported from `FilePaneView.friendlySize`. Binary units under decimal names —
 * "KB" for 1024 bytes — because that is what every tool in this corner of the
 * world means by them, and a firmware dump whose size is a power of two should
 * read as "8 MB" rather than "8.39 MB".
 *
 * Rounded to a whole unit: "255 KB", not "255.5 KB". The exact figure belongs
 * where exactness is the point (the status bar says the byte count in full);
 * this is for the places that are naming a size in passing.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function friendlySize(bytes: number): string {
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < UNITS.length - 1) {
    value /= 1024;
    index += 1;
  }
  if (index === 0) return `${bytes} B`;

  // The loop leaves value < 1024, so the only way rounding reaches 1024 is the
  // last half-unit, which rolls up to one of the next unit.
  const rounded = Math.round(value);
  if (rounded >= 1024 && index < UNITS.length - 1) return `1 ${UNITS[index + 1]}`;
  return `${rounded} ${UNITS[index]}`;
}
