import { L } from "@/core/localization/localization";
import { decodeUtf8 } from "@/core/text/utf";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { NVRAM } from "@/firmware/uefi/nvramParser";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Where Apple's firmware keeps the machine's identity (`UEFI_IMAGE_FORMAT.md` §9): in the SysF
 * store, the `Fsys` variables of the NVRAM, not in a block of its own. What the bench knows as
 * the serial number, the configuration code and the order number of a Mac.
 *
 * ```
 * ssn   the system serial number      ("C02QMDJVG940")
 * hwc   the configuration code        ("G940", the end of the serial: four
 *                                      characters, three on an 11-character one)
 * son   the sales order number        ("MJVE2D/", the model's order number)
 * ```
 *
 * The board's own serial, the MLB, is no variable of this store: it is in the names of the
 * calibration variables beside them, each named by the MLB and a suffix
 * (`C02542600KXG91TANMAC-1`), and is read from the prefix they share.
 *
 * The layout is read off four Mac dumps — a MacBook Air, a MacBook Pro 13 (A1708) and two
 * MacBook Pro 15 of 2010 and 2011 — and nothing is published. The two older boards keep an
 * 11-character serial with a three-character code, and no calibration variables, so no MLB is
 * read from them.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.init
 */
export interface AppleDMIArea {
  /**
   * The SysF store the fields are read from.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.store
   */
  readonly store: ImageRange;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.serialNumber */
  readonly serialNumber?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.configCode */
  readonly configCode?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.orderNumber */
  readonly orderNumber?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.boardSerial */
  readonly boardSerial?: string | undefined;
  /**
   * The store marks the copy of the serial invalid, and keeps no current one.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.isDeleted
   */
  readonly isDeleted: boolean;
  /**
   * The entries of the store each value is read from — the copies that stand, and for the MLB the
   * first variable named by it — where the store has them.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.serialEntry
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.configCodeEntry
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.orderNumberEntry
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.boardSerialEntry
   */
  readonly serialEntry?: ImageRange | undefined;
  readonly configCodeEntry?: ImageRange | undefined;
  readonly orderNumberEntry?: ImageRange | undefined;
  readonly boardSerialEntry?: ImageRange | undefined;
}

/**
 * The values, in the order a Mac's own tools list them, each with the entry it is read from. The
 * names are English keys, put into words where they are shown.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.values
 */
export function appleValues(area: AppleDMIArea): {
  readonly name: string;
  readonly value?: string | undefined;
  readonly entry?: ImageRange | undefined;
}[] {
  return [
    { name: "Serial number", value: area.serialNumber, entry: area.serialEntry },
    { name: "Configuration code", value: area.configCode, entry: area.configCodeEntry },
    { name: "Sales order number", value: area.orderNumber, entry: area.orderNumberEntry },
    { name: "MLB (board serial)", value: area.boardSerial, entry: area.boardSerialEntry },
  ];
}

/** Apple's names and numbers. */
export const APPLE_DMI = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.serialName */
  serialName: "ssn",
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.configCodeName */
  configCodeName: "hwc",
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.orderNumberName */
  orderNumberName: "son",
  /**
   * The length of the MLB on every board read from.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.boardSerialLength
   */
  boardSerialLength: 17,
} as const;

/**
 * The variables of the store that hold a value of the area.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.identityNames
 */
export const APPLE_IDENTITY_NAMES: ReadonlySet<string> = new Set([
  APPLE_DMI.serialName,
  APPLE_DMI.configCodeName,
  APPLE_DMI.orderNumberName,
]);

/**
 * Something about Apple's identity a technician should know before trusting it: the store
 * marks the serial invalid and keeps no current copy; the configuration code is not the end of
 * the serial; the serial and the board's serial do not begin with the same three characters,
 * the place of manufacture.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIFinding
 */
export type AppleDMIFinding =
  | "deletedCopy"
  | "configCodeIsNotTheSerialsEnd"
  | "serialIsNotTheBoardsLocation";

/**
 * What a technician should know before trusting the fields.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.findings
 */
export function appleFindings(area: AppleDMIArea): AppleDMIFinding[] {
  const found: AppleDMIFinding[] = [];
  if (area.isDeleted) found.push("deletedCopy");
  const serial = area.serialNumber;
  const code = area.configCode;
  if (
    serial !== undefined &&
    code !== undefined &&
    serial.length >= code.length &&
    !serial.endsWith(code)
  ) {
    found.push("configCodeIsNotTheSerialsEnd");
  }
  const board = area.boardSerial;
  if (serial !== undefined && board !== undefined && serial.slice(0, 3) !== board.slice(0, 3)) {
    found.push("serialIsNotTheBoardsLocation");
  }
  return found;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIFinding.text */
export function appleFindingText(finding: AppleDMIFinding): string {
  switch (finding) {
    case "deletedCopy":
      return L(
        "The store marks the serial invalid and keeps no current copy. The value is whole; where the firmware takes it from on such a board, the dump does not show."
      );
    case "configCodeIsNotTheSerialsEnd":
      return L(
        "The configuration code is not the end of the serial, as it is on a Mac's own. The serial was written without its code, or is a placeholder."
      );
    case "serialIsNotTheBoardsLocation":
      return L(
        "The serial does not begin as the board's serial does. On a Mac's own both begin with the code of the factory; the serial was changed, or came over from another machine."
      );
  }
}

/**
 * One variable of a SysF store as it is stored: its name, read from the bytes — a copy marked
 * invalid is named Invalid on the node — and its value.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.Variable
 */
interface Variable {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.Variable.name */
  readonly name: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.Variable.isValid */
  readonly isValid: boolean;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.Variable.data */
  readonly data: ImageRange;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.Variable.entry */
  readonly entry: ImageRange;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.variables */
function variables(store: UEFINode, reader: ImageReader): Variable[] {
  const found: Variable[] = [];
  for (const entry of store.children) {
    if (entry.kind !== "sysFEntry" || entry.header.end - entry.header.start < 3) continue;
    const flags = reader.uint8(entry.header.start);
    if (flags === undefined) continue;
    const nameBytes = reader.bytesAt(entry.header.start + 1, flags & NVRAM.sysfNameLengthMask);
    if (nameBytes === undefined) continue;
    const end = nameBytes.indexOf(0);
    const name = decodeUtf8(end < 0 ? nameBytes : nameBytes.subarray(0, end));
    found.push({
      name,
      isValid: (flags & NVRAM.sysfInvalidFlag) === 0,
      data: entry.body,
      entry: nodeRange(entry),
    });
  }
  return found;
}

/**
 * The copy that stands for a variable: the current one, or the last one where the store keeps
 * none.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.standing
 */
function standing(name: string, all: readonly Variable[]): Variable | undefined {
  const mine = all.filter((variable) => variable.name === name);
  return mine.findLast((variable) => variable.isValid) ?? mine.at(-1);
}

/**
 * The text of a variable, to its first NUL; nothing where it is empty or is not printable
 * ASCII.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.text
 */
function text(variable: Variable | undefined, reader: ImageReader): string | undefined {
  return variable === undefined ? undefined : textIn(variable.data, reader);
}

/**
 * The text a SysF entry holds, the same way: what its row says beside its name.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.text
 */
export function appleEntryText(entry: UEFINode, reader: ImageReader): string | undefined {
  return entry.kind === "sysFEntry" ? textIn(entry.body, reader) : undefined;
}

function textIn(data: ImageRange, reader: ImageReader): string | undefined {
  const bytes = reader.bytes(data);
  if (bytes === undefined) return undefined;
  const end = bytes.indexOf(0);
  const run = end < 0 ? bytes : bytes.subarray(0, end);
  if (run.length === 0 || !run.every((byte) => byte >= 0x20 && byte <= 0x7e)) return undefined;
  return String.fromCharCode(...run);
}

/**
 * The MLB: the prefix of `boardSerialLength` alphanumerics that at least two variables' names
 * share, the most shared one where there are several.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.boardSerial
 */
export function appleBoardSerial(names: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (name.length <= APPLE_DMI.boardSerialLength) continue;
    const prefix = name.slice(0, APPLE_DMI.boardSerialLength);
    if (!/^[0-9A-Z]+$/.test(prefix)) continue;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  let best: [string, number] | undefined;
  for (const [prefix, count] of counts) {
    if (count < 2) continue;
    // The most shared; between two shared as often, the one that sorts first.
    if (best === undefined || count > best[1] || (count === best[1] && prefix < best[0])) {
      best = [prefix, count];
    }
  }
  return best?.[0];
}

/**
 * Apple's identity as `store` holds it; nothing when it is no SysF store, or holds none of the
 * fields.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/AppleDMIArea.swift#AppleDMIArea.read
 */
export function readAppleDMIArea(store: UEFINode, reader: ImageReader): AppleDMIArea | undefined {
  if (store.kind !== "sysFStore" || !isFileSpace(store.space)) return undefined;
  const range = nodeRange(store);
  if (reader.uint32(range.start) !== NVRAM.appleSysfSignature) return undefined;
  const all = variables(store, reader);
  const serial = standing(APPLE_DMI.serialName, all);
  const serialNumber = text(serial, reader);
  const code = standing(APPLE_DMI.configCodeName, all);
  const order = standing(APPLE_DMI.orderNumberName, all);
  const configCode = text(code, reader);
  const orderNumber = text(order, reader);
  const boardSerial = appleBoardSerial(all.map((variable) => variable.name));
  const board =
    boardSerial === undefined
      ? undefined
      : all.find((variable) => variable.name.startsWith(boardSerial));
  if (
    serialNumber === undefined &&
    configCode === undefined &&
    orderNumber === undefined &&
    boardSerial === undefined
  ) {
    return undefined;
  }
  return {
    store: range,
    ...(serialNumber === undefined ? {} : { serialNumber }),
    ...(configCode === undefined ? {} : { configCode }),
    ...(orderNumber === undefined ? {} : { orderNumber }),
    ...(boardSerial === undefined ? {} : { boardSerial }),
    isDeleted: serial === undefined ? false : !serial.isValid,
    ...(serial === undefined ? {} : { serialEntry: serial.entry }),
    ...(code === undefined ? {} : { configCodeEntry: code.entry }),
    ...(order === undefined ? {} : { orderNumberEntry: order.entry }),
    ...(board === undefined ? {} : { boardSerialEntry: board.entry }),
  };
}
