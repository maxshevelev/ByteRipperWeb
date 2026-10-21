import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { acerUUIDTextOf } from "@/firmware/uefi/acerDmiStore";
import { guidFromBytes, guidText } from "@/firmware/uefi/efiGuid";
import { hpText } from "@/firmware/uefi/hpDmiArea";
import { madeUpName, makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * One value of a vendor's identity area where the area keeps it as a field of its own bytes —
 * Acer's block, HP's `HP_MUD` — shown in the tree as a row under the area's (`dmiField`), the way
 * Lenovo's entries are under their block. The row's subtype is the field's encoding, so the row
 * reads its value from its own bytes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField.init
 */
export interface DMIField {
  /**
   * The field's name, an English key the row puts into words.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField.name
   */
  readonly name: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField.range */
  readonly range: ImageRange;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField.encoding */
  readonly encoding: DMIFieldEncoding;
}

/**
 * How the value is written in the field's bytes: printable ASCII to the first byte that is not;
 * UTF-16 little-endian to the first NUL; a UUID as SMBIOS stores one, the first three groups
 * little-endian; a UUID as Acer stores one, the first two groups little-endian.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField.Encoding
 */
export type DMIFieldEncoding = "ascii" | "utf16" | "smbiosUUID" | "acerUUID";

/** The encodings by the subtype a row carries, upstream's raw values. */
const ENCODINGS: readonly DMIFieldEncoding[] = ["ascii", "utf16", "smbiosUUID", "acerUUID"];

/**
 * The field's row: all body, no header.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField.node
 */
export function dmiFieldNode(field: DMIField, isFixed: boolean): UEFINode {
  return makeNode({
    kind: "dmiField",
    subtype: ENCODINGS.indexOf(field.encoding),
    ...madeUpName(field.name),
    header: { start: field.range.start, end: field.range.start },
    body: field.range,
    isFixed,
  });
}

/**
 * The value `bytes` hold, written as `encoding`; empty where nothing readable is written.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField.text
 */
export function dmiFieldText(bytes: Uint8Array, encoding: DMIFieldEncoding): string {
  switch (encoding) {
    case "ascii": {
      let end = 0;
      while (end < bytes.length && (bytes[end] as number) >= 0x20 && (bytes[end] as number) <= 0x7e)
        end += 1;
      return String.fromCharCode(...bytes.subarray(0, end));
    }
    case "utf16":
      return hpText(bytes) ?? "";
    case "smbiosUUID":
      return bytes.length === 16 ? guidText(guidFromBytes(bytes)) : "";
    case "acerUUID":
      return bytes.length === 16 ? acerUUIDTextOf(bytes) : "";
  }
}

/**
 * The value a `dmiField` row holds, read from its bytes; nothing for any other row, or one whose
 * bytes are not there.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DMIStore.swift#DMIField.text
 */
export function dmiFieldTextOf(node: UEFINode, reader: ImageReader): string | undefined {
  if (node.kind !== "dmiField" || node.subtype === undefined) return undefined;
  const encoding = ENCODINGS[node.subtype];
  const bytes = reader.bytes(node.body);
  return encoding === undefined || bytes === undefined ? undefined : dmiFieldText(bytes, encoding);
}
