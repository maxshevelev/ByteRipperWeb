/**
 * What a document with no file behind it may be called (§23).
 *
 * An unsaved document's name is a label rather than a path: the header shows
 * it, Save As starts from it, and Save All as Separate Files builds every
 * piece's file name from it — which is why it has to survive being turned into
 * a file name. A base name with a slash in it names a directory that is not
 * there.
 *
 * @upstream ByteRipperApp/Documents/PaneName.swift#PaneName
 */

/**
 * The characters a name cannot carry into a file name: the POSIX separator,
 * the Finder's, and the null a filesystem ends a name with.
 *
 * @upstream ByteRipperApp/Documents/PaneName.swift#PaneName.forbidden
 */
const FORBIDDEN = new Set(["/", ":", "\0"]);

/**
 * The name `raw` asks for, or nothing when it asks for nothing.
 *
 * Trimmed, since space at either end reads as a mistake in a header and makes a
 * file nobody can tell from its neighbour. Forbidden characters are dropped
 * rather than the whole name refused: the result is in the header the moment
 * the field closes, so the user sees what was taken. A name of only space or
 * separators asks for nothing, and the old name stays.
 *
 * @upstream ByteRipperApp/Documents/PaneName.swift#PaneName.sanitized
 */
export function sanitizedPaneName(raw: string): string | undefined {
  const kept = [...raw].filter((character) => !FORBIDDEN.has(character)).join("");
  const trimmed = kept.trim();
  return trimmed === "" ? undefined : trimmed;
}
