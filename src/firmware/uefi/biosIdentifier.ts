/**
 * The BIOS ID a firmware file carries: the signature `$IBIOSI$` and then a
 * UTF-16 string, in the file with GUID `C3E36D09-8294-4B97-A857-D5288FE33E28`
 * (`nameOfGuid` calls it "BIOS ID").
 *
 * Intel's layout is five parts between dots — board, OEM, major version, minor
 * version and a build date, `yymmddHHMM` — as Apple writes it
 * (`MBA71.88Z.F000.B00.1906140921`). A string that does not split that way is
 * still a BIOS ID, and only its text is given.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier
 */
export interface BIOSIdentifier {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier.text */
  readonly text: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier.board */
  readonly board: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier.oem */
  readonly oem: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier.majorVersion */
  readonly majorVersion: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier.minorVersion */
  readonly minorVersion: string | undefined;
  /**
   * `yyyy-mm-dd hh:mm`, from the ten digits at the end.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier.buildDate
   */
  readonly buildDate: string | undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier.signature */
const signature = [0x24, 0x49, 0x42, 0x49, 0x4f, 0x53, 0x49, 0x24]; // "$IBIOSI$"

/**
 * The identifier in a section's bytes, or nothing when they do not open with
 * the signature or hold no string after it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/BIOSIdentifier.swift#BIOSIdentifier.read
 */
export function readBIOSIdentifier(bytes: Uint8Array): BIOSIdentifier | undefined {
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return undefined;
  }
  const units: number[] = [];
  let index = signature.length;
  while (index + 1 < bytes.length) {
    const unit = (bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8);
    if (unit === 0) break;
    units.push(unit);
    index += 2;
  }
  const text = decodeUTF16(units).replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
  if (text.length === 0) return undefined;

  // Five parts between dots, the last ten digits: Intel's layout. A string of
  // any other shape keeps its text and nothing else.
  const parts = text.split(".");
  const date = parts[4];
  const five = parts.length === 5 && date !== undefined && /^[0-9]{10}$/.test(date);
  return {
    text,
    board: five ? parts[0] : undefined,
    oem: five ? parts[1] : undefined,
    majorVersion: five ? parts[2] : undefined,
    minorVersion: five ? parts[3] : undefined,
    buildDate:
      five && date !== undefined
        ? `20${date.slice(0, 2)}-${date.slice(2, 4)}-${date.slice(4, 6)} ${date.slice(6, 8)}:${date.slice(8, 10)}`
        : undefined,
  };
}

/** The UTF-16 code units as text, a surrogate pair combining the way the format writes it. */
function decodeUTF16(units: readonly number[]): string {
  let text = "";
  for (const unit of units) text += String.fromCharCode(unit);
  return text;
}
