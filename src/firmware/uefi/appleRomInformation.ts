/**
 * The "Apple ROM Version" block a Mac's firmware carries as plain text: the
 * model or BIOS ID, the EFI version, who built it and when, the compiler and
 * the UUIDs of the build.
 *
 * Older boards keep it as a raw section of a file (`nameOfGuid` calls it
 * "Apple ROM Information"); newer ones leave it in the padding at the start of
 * the BIOS region, so what finds it is the title line, not where it lies. Each
 * line after the title is `  Key:   value` — a key may repeat (`UUID` does), so
 * the entries stay a list.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleROMInformation.swift#AppleROMInformation
 */
export interface AppleROMInformation {
  /**
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleROMInformation.swift#AppleROMInformation.entries
   */
  readonly entries: readonly ROMInformationEntry[];
}

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleROMInformation.swift#AppleROMInformation.Entry
 */
export interface ROMInformationEntry {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleROMInformation.swift#AppleROMInformation.Entry.key */
  readonly key: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleROMInformation.swift#AppleROMInformation.Entry.value */
  readonly value: string;
}

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleROMInformation.swift#AppleROMInformation.title
 */
export const title = "Apple ROM Version";

/**
 * More than any block seen is long; a bound on what a padding node is searched
 * for.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleROMInformation.swift#AppleROMInformation.searchLimit
 */
export const searchLimit = 0x10000;

/**
 * The block in `bytes`, wherever it starts in them, or nothing when there is
 * no title line. It ends at the first byte that is not text.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleROMInformation.swift#AppleROMInformation.read
 */
export function readAppleROMInformation(bytes: Uint8Array): AppleROMInformation | undefined {
  const length = title.length;
  if (bytes.length < length) return undefined;
  let start = -1;
  for (let at = 0; at + length <= bytes.length; at++) {
    if (bytes.subarray(at, at + length).every((byte, i) => byte === title.charCodeAt(i))) {
      start = at;
      break;
    }
  }
  if (start === -1) return undefined;

  // The block is ASCII text: a newline, or a printable. It ends at the first
  // byte that is neither.
  let end = start;
  while (end < bytes.length) {
    const byte = bytes[end] ?? 0;
    if (byte !== 0x0a && (byte < 0x20 || byte > 0x7e)) break;
    end++;
  }
  const text = new TextDecoder().decode(bytes.subarray(start, end));

  const entries: ROMInformationEntry[] = [];
  for (const line of text
    .split("\n")
    .filter((one) => one.length > 0)
    .slice(1)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = trimSpaces(line.slice(0, colon));
    if (key.length === 0) continue;
    entries.push({ key, value: trimSpaces(line.slice(colon + 1)) });
  }
  return entries.length === 0 ? undefined : { entries };
}

/** The spaces at both ends — the block pads its columns with them, and with nothing else. */
function trimSpaces(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) === 0x20) start++;
  while (end > start && text.charCodeAt(end - 1) === 0x20) end--;
  return text.slice(start, end);
}
