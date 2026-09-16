/**
 * A byte count as a person reads it.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.friendlySize
 *
 * The same 1024 steps under the same names, so "8 MB" means the same size in
 * both editions, and a firmware dump whose size is a power of two reads as
 * "8 MB" rather than "8.39 MB".
 *
 * Rounded to a whole unit: "255 KB", not "255.5 KB". The exact figure belongs
 * where exactness is the point — a dialog that is naming a byte count in full;
 * this is for the places that are naming a size in passing, which is the pane's
 * status line and the Segments form.
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
