import { decodeUtf8 } from "@/core/text/utf";
import { devicePathText } from "@/firmware/uefi/devicePath";
import {
  type EFIGUID,
  guidEquals,
  guidFromBytes,
  guidKey,
  guid as guidOf,
} from "@/firmware/uefi/efiGuid";

/**
 * What a variable's value is, read as its type (`UEFI_IMAGE_FORMAT.md` §9).
 *
 * A VSS header says nothing about the type of the value, so the type comes from
 * three places, in this order. The UEFI specification defines a number of variables
 * by name and GUID — `BootOrder` is a list of `UINT16`, `Lang` an ASCII string,
 * `ConOut` a device path, `PK` a signature list — and those are read as it defines
 * them. The attributes name one more: a hardware error record. Everything else is
 * read from its own bytes, by structures that check themselves (a device path, a
 * load option, a signature list) and then by plain shapes: text, a number of a
 * register's width, bytes. What the value was read by is kept (`basis`), so the
 * panel can say which readings are certain and which are guesses.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue
 */
export interface NvramValue {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.content */
  readonly content: NvramContent;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.basis */
  readonly basis: NvramBasis;
}

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.Content
 * @upstream-differs a tagged object, where upstream has an enum with payloads
 */
export type NvramContent =
  /** No bytes at all. */
  | { readonly kind: "empty" }
  /** A little-endian unsigned number of `size` bytes: 1, 2, 4 or 8. */
  | { readonly kind: "number"; readonly value: bigint; readonly size: number }
  /** `BootOrder` and its kind: a list of load option numbers. */
  | { readonly kind: "optionList"; readonly numbers: readonly number[] }
  /** `BootNext`, `BootCurrent`: one load option number. */
  | { readonly kind: "optionNumber"; readonly number: number }
  | { readonly kind: "text"; readonly text: string; readonly encoding: NvramTextEncoding }
  /** A device path, in the spec's text form. */
  | { readonly kind: "devicePath"; readonly path: string }
  | { readonly kind: "loadOption"; readonly option: NvramLoadOption }
  | { readonly kind: "signatures"; readonly lists: readonly NvramSignatureList[] }
  /** A record the firmware keeps of a hardware error (`HwErrRec####`). */
  | { readonly kind: "hardwareErrorRecord" }
  /** Nothing the bytes read as. */
  | { readonly kind: "bytes" };

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.TextEncoding */
export type NvramTextEncoding = "ascii" | "ucs2";

/**
 * What decided the type.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.Basis
 */
export type NvramBasis =
  /** The UEFI specification defines the variable by this name and GUID. */
  | "specification"
  /** The specification defines a variable of this name; this one has a vendor's GUID. */
  | "name"
  /** The attributes say what it is. */
  | "attributes"
  /** The bytes read as this; nothing else says so. */
  | "content";

/**
 * `EFI_LOAD_OPTION`: `Boot####` and its kind.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.LoadOption
 */
export interface NvramLoadOption {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.LoadOption.attributes */
  readonly attributes: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.LoadOption.description */
  readonly description: string;
  /** The file path list in text; nothing when it does not read as one. */
  readonly devicePath: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.LoadOption.optionalDataSize */
  readonly optionalDataSize: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.LoadOption.isActive */
export const isActiveLoadOption = (option: NvramLoadOption): boolean =>
  (option.attributes & 0x1) !== 0;

/**
 * `EFI_SIGNATURE_LIST`: signatures of one type.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.SignatureList
 */
export interface NvramSignatureList {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.SignatureList.type */
  readonly type: EFIGUID;
  /** The spec's name of the type — `X.509`, `SHA-256` — or nothing. */
  readonly typeName: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.SignatureList.signatures */
  readonly signatures: readonly NvramSignature[];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.SignatureList.isCertificates */
export const isCertificateList = (list: NvramSignatureList): boolean =>
  guidEquals(list.type, CERT_X509);

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.Signature */
export interface NvramSignature {
  readonly owner: EFIGUID;
  /** A certificate's subject: its common name, or its organisation. */
  readonly subject: string | undefined;
  readonly size: number;
}

// MARK: - Reading

/**
 * `EFI_GLOBAL_VARIABLE`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.globalVariable
 */
export const GLOBAL_VARIABLE = guidOf("8BE4DF61-93CA-11D2-AA0D-00E098032B8C");
/**
 * `EFI_IMAGE_SECURITY_DATABASE_GUID`: `db`, `dbx`, `dbt`, `dbr`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.imageSecurityDatabase
 */
export const IMAGE_SECURITY_DATABASE = guidOf("D719B2CB-3D3A-4596-A3BC-DAD00E67656F");
// @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.certX509
const CERT_X509 = guidOf("A5C059A1-94E4-4AA7-87B5-AB155C2BF072");

/**
 * The attribute that marks a hardware error record.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.hardwareErrorRecordAttribute
 */
export const HARDWARE_ERROR_RECORD_ATTRIBUTE = 0x0000_0008;

/**
 * `value` of the variable `name` in `guid`, with `attributes`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.read
 */
export function readNvramValue(
  name: string,
  guid: EFIGUID | undefined,
  attributes: number,
  value: Uint8Array
): NvramValue {
  if (value.length === 0) return { content: { kind: "empty" }, basis: "content" };
  const defined = specified(name, guid, value);
  if (defined !== undefined) return defined;
  if ((attributes & HARDWARE_ERROR_RECORD_ATTRIBUTE) !== 0) {
    return { content: { kind: "hardwareErrorRecord" }, basis: "attributes" };
  }
  return { content: guessed(value), basis: "content" };
}

/**
 * What the spec defines a variable of this name to be, when the value has that
 * shape. A value of another shape — a vendor reusing a name — is left to be read
 * from its bytes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.specified
 */
function specified(
  name: string,
  guid: EFIGUID | undefined,
  value: Uint8Array
): NvramValue | undefined {
  let owner: EFIGUID = GLOBAL_VARIABLE;
  let content: NvramContent | undefined;
  switch (name) {
    case "BootOrder":
    case "DriverOrder":
    case "SysPrepOrder":
    case "PlatformRecoveryOrder":
      content = value.length % 2 === 0 ? { kind: "optionList", numbers: words(value) } : undefined;
      break;
    case "BootNext":
    case "BootCurrent":
      content =
        value.length === 2 ? { kind: "optionNumber", number: words(value)[0] ?? 0 } : undefined;
      break;
    case "Timeout":
    case "HwErrRecSupport":
      content = number(value, 2);
      break;
    case "BootOptionSupport":
      content = number(value, 4);
      break;
    case "OsIndications":
    case "OsIndicationsSupported":
      content = number(value, 8);
      break;
    case "SecureBoot":
    case "SetupMode":
    case "AuditMode":
    case "DeployedMode":
    case "VendorKeys":
      content = number(value, 1);
      break;
    case "Lang":
    case "PlatformLang":
    case "LangCodes":
    case "PlatformLangCodes": {
      const text = asciiText(value, false);
      content = text === undefined ? undefined : { kind: "text", text, encoding: "ascii" };
      break;
    }
    case "ConIn":
    case "ConOut":
    case "ErrOut":
    case "ConInDev":
    case "ConOutDev":
    case "ErrOutDev": {
      const path = devicePathText(value);
      content = path === undefined ? undefined : { kind: "devicePath", path };
      break;
    }
    case "PK":
    case "KEK":
    case "PKDefault":
    case "KEKDefault":
    case "dbDefault":
    case "dbxDefault":
    case "dbtDefault":
    case "dbrDefault": {
      const lists = signatureLists(value);
      content = lists === undefined ? undefined : { kind: "signatures", lists };
      break;
    }
    case "db":
    case "dbx":
    case "dbt":
    case "dbr": {
      owner = IMAGE_SECURITY_DATABASE;
      const lists = signatureLists(value);
      content = lists === undefined ? undefined : { kind: "signatures", lists };
      break;
    }
    default: {
      if (!isLoadOptionName(name)) return undefined;
      const option = loadOption(value);
      content = option === undefined ? undefined : { kind: "loadOption", option };
    }
  }
  if (content === undefined) return undefined;
  return {
    content,
    basis: guid !== undefined && guidEquals(guid, owner) ? "specification" : "name",
  };
}

/**
 * `Boot####`, `Driver####`, `SysPrep####`, `PlatformRecovery####`: four upper-case
 * hex digits after the prefix.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.isLoadOptionName
 */
export function isLoadOptionName(name: string): boolean {
  for (const prefix of ["Boot", "Driver", "SysPrep", "PlatformRecovery"]) {
    if (!name.startsWith(prefix)) continue;
    return /^[0-9A-F]{4}$/.test(name.slice(prefix.length));
  }
  return false;
}

/** The structures that check themselves first, then the shapes. */
function guessed(value: Uint8Array): NvramContent {
  const lists = signatureLists(value);
  if (lists !== undefined) return { kind: "signatures", lists };
  const path = devicePathText(value);
  if (path !== undefined) return { kind: "devicePath", path };
  const ucs2 = ucs2Text(value);
  if (ucs2 !== undefined) return { kind: "text", text: ucs2, encoding: "ucs2" };
  const ascii = asciiText(value, true);
  if (ascii !== undefined) return { kind: "text", text: ascii, encoding: "ascii" };
  if ([1, 2, 4, 8].includes(value.length)) {
    const shape = number(value, value.length);
    if (shape !== undefined) return shape;
  }
  return { kind: "bytes" };
}

// MARK: - Shapes

/** UTF-16 code units as text, in pieces: a long value must not overflow the call. */
function unitsText(units: ArrayLike<number>): string {
  let text = "";
  for (let at = 0; at < units.length; at += 8192) {
    text += String.fromCharCode(
      ...Array.from({ length: Math.min(8192, units.length - at) }, (_, i) => units[at + i] ?? 0)
    );
  }
  return text;
}

function number(value: Uint8Array, size: number): NvramContent | undefined {
  if (value.length !== size) return undefined;
  let result = 0n;
  for (let index = value.length - 1; index >= 0; index--) {
    result = (result << 8n) | BigInt(value[index] ?? 0);
  }
  return { kind: "number", value: result, size };
}

function words(value: Uint8Array): number[] {
  const found: number[] = [];
  for (let at = 0; at + 1 < value.length; at += 2) {
    found.push((value[at] ?? 0) | ((value[at + 1] ?? 0) << 8));
  }
  return found;
}

const isPrintable = (unit: number): boolean =>
  (unit >= 0x20 && unit <= 0x7e) ||
  (unit >= 0xa0 && unit <= 0xff) ||
  unit === 0x09 ||
  unit === 0x0a ||
  unit === 0x0d;

/**
 * Whether a run of `characters` in a value of `size` bytes is text rather than a
 * number. A value as wide as a register — 1, 2, 4 or 8 bytes — is a number before
 * it is anything else: a counter whose bytes happen to be printable (`"9 "`,
 * ``"e@7`"``) is far more common than a word that short. So there it counts as
 * text only with a terminator after three characters or more; elsewhere two will
 * do.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.isText
 */
function isText(characters: number, terminated: boolean, size: number): boolean {
  return [1, 2, 4, 8].includes(size) ? terminated && characters >= 3 : characters >= 2;
}

/**
 * UCS-2 text: printable characters, then nothing but zeros.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.ucs2Text
 */
export function ucs2Text(value: Uint8Array): string | undefined {
  if (value.length < 4 || value.length % 2 !== 0) return undefined;
  const units = words(value);
  const zero = units.indexOf(0);
  const end = zero < 0 ? units.length : zero;
  if (!units.slice(end).every((unit) => unit === 0)) return undefined;
  if (!units.slice(0, end).every(isPrintable)) return undefined;
  if (!isText(end, end < units.length, value.length)) return undefined;
  return unitsText(units.slice(0, end));
}

/**
 * ASCII text: printable bytes, then nothing but zeros. `strict` holds a guess to
 * `isText`; a variable the spec says is text needs only one character.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.asciiText
 */
export function asciiText(value: Uint8Array, strict = true): string | undefined {
  const zero = value.indexOf(0);
  const end = zero < 0 ? value.length : zero;
  for (let at = end; at < value.length; at++) if (value[at] !== 0) return undefined;
  for (let at = 0; at < end; at++) {
    const byte = value[at] ?? 0;
    if (!isPrintable(byte) || byte >= 0x80) return undefined;
  }
  const fits = strict ? isText(end, end < value.length, value.length) : end >= 1;
  if (!fits) return undefined;
  return unitsText(value.subarray(0, end));
}

// MARK: - Structures

/**
 * `EFI_LOAD_OPTION`: attributes, the path list's length, a terminated UCS-2
 * description, the path list, optional data. Nothing unless all of it fits and the
 * path list reads as one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.loadOption
 */
export function loadOption(value: Uint8Array): NvramLoadOption | undefined {
  if (value.length < 8) return undefined;
  const attributes =
    ((value[0] ?? 0) |
      ((value[1] ?? 0) << 8) |
      ((value[2] ?? 0) << 16) |
      ((value[3] ?? 0) << 24)) >>>
    0;
  const pathLength = (value[4] ?? 0) | ((value[5] ?? 0) << 8);
  let at = 6;
  const units: number[] = [];
  for (;;) {
    if (at + 2 > value.length) return undefined;
    const unit = (value[at] ?? 0) | ((value[at + 1] ?? 0) << 8);
    at += 2;
    if (unit === 0) break;
    units.push(unit);
  }
  if (at + pathLength > value.length) return undefined;
  return {
    attributes,
    description: unitsText(units),
    devicePath: devicePathText(value.subarray(at, at + pathLength)),
    optionalDataSize: value.length - at - pathLength,
  };
}

/**
 * Signature lists back to back, filling the value exactly, each of a type the spec
 * names. Nothing otherwise.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.signatureLists
 */
export function signatureLists(value: Uint8Array): NvramSignatureList[] | undefined {
  const u32 = (at: number): number =>
    ((value[at] ?? 0) |
      ((value[at + 1] ?? 0) << 8) |
      ((value[at + 2] ?? 0) << 16) |
      ((value[at + 3] ?? 0) << 24)) >>>
    0;
  const lists: NvramSignatureList[] = [];
  let at = 0;
  while (at < value.length) {
    if (at + 28 > value.length) return undefined;
    const type = guidFromBytes(value, at);
    const typeName = SIGNATURE_TYPES.get(guidKey(type));
    if (typeName === undefined) return undefined;
    const listSize = u32(at + 16);
    const headerSize = u32(at + 20);
    const signatureSize = u32(at + 24);
    const first = at + 28 + headerSize;
    if (
      !(
        signatureSize > 16 &&
        listSize >= 28 &&
        first <= at + listSize &&
        at + listSize <= value.length &&
        (at + listSize - first) % signatureSize === 0
      )
    ) {
      return undefined;
    }
    const signatures: NvramSignature[] = [];
    for (let entry = first; entry < at + listSize; entry += signatureSize) {
      const data = value.subarray(entry + 16, entry + signatureSize);
      signatures.push({
        owner: guidFromBytes(value, entry),
        subject: guidEquals(type, CERT_X509) ? x509Subject(data) : undefined,
        size: data.length,
      });
    }
    lists.push({ type, typeName, signatures });
    at += listSize;
  }
  return lists.length === 0 ? undefined : lists;
}

/**
 * The signature types of UEFI §32.4.1.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#NvramValue.signatureTypes
 */
const SIGNATURE_TYPES: ReadonlyMap<string, string> = new Map(
  (
    [
      ["C1C41626-504C-4092-ACA9-41F936934328", "SHA-256"],
      ["3C5766E8-269C-4E34-AA14-ED776E85B3B6", "RSA-2048"],
      ["E2B36190-879B-4A3D-AD8D-F2E7BBA32784", "RSA-2048 + SHA-256"],
      ["826CA512-CF10-4AC9-B187-BE01496631BD", "SHA-1"],
      ["67F8444F-8743-48F1-A328-1EAAB8736080", "RSA-2048 + SHA-1"],
      ["A5C059A1-94E4-4AA7-87B5-AB155C2BF072", "X.509"],
      ["0B6E5233-A65C-44C9-9407-D9AB83BFC8BD", "SHA-224"],
      ["FF3E5307-9FD0-48C9-85F1-8AD56C701E01", "SHA-384"],
      ["093E0FAE-A6C4-4F50-9F1B-D41E2B89C19A", "SHA-512"],
      ["3BD2A492-96C0-4079-B420-FCF98EF103ED", "X.509 + SHA-256"],
      ["7076876E-80C2-4EE6-AAD2-28B349A6865B", "X.509 + SHA-384"],
      ["446DBF63-2502-4CDA-BCFA-2465D2B0FE9D", "X.509 + SHA-512"],
    ] as const
  ).map(([text, name]) => [guidKey(guidOf(text)), name])
);

// MARK: - X.509

/**
 * Just enough DER to name a certificate: its subject's common name, or its
 * organisation where it has no common name.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#X509
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#X509.subject
 */
export function x509Subject(der: Uint8Array): string | undefined {
  // Certificate ::= SEQUENCE { tbsCertificate SEQUENCE { [0] version OPTIONAL,
  // serial, signature, issuer, validity, subject, … } … }
  const certificate = derElement(der, 0);
  if (certificate === undefined || certificate.tag !== 0x30) return undefined;
  const tbs = derElement(der, certificate.start);
  if (tbs === undefined || tbs.tag !== 0x30) return undefined;
  let at = tbs.start;
  const version = derElement(der, at);
  if (version !== undefined && version.tag === 0xa0) at = version.end;
  // Serial, signature, issuer, validity, subject.
  const fields: DerElement[] = [];
  while (fields.length < 5 && at < tbs.end) {
    const field = derElement(der, at);
    if (field === undefined) break;
    fields.push(field);
    at = field.end;
  }
  const subject = fields[4];
  if (fields.length !== 5 || subject === undefined || subject.tag !== 0x30) return undefined;
  return attribute([0x55, 0x04, 0x03], subject, der) ?? attribute([0x55, 0x04, 0x0a], subject, der);
}

/**
 * The value of the attribute `oid` names in a Name: SEQUENCE OF SET OF SEQUENCE
 * { OID, value }.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#X509.attribute
 */
function attribute(oid: readonly number[], name: DerElement, der: Uint8Array): string | undefined {
  let at = name.start;
  while (at < name.end) {
    const set = derElement(der, at);
    if (set === undefined) break;
    let inner = set.start;
    while (inner < set.end) {
      const pair = derElement(der, inner);
      if (pair === undefined) break;
      const id = derElement(der, pair.start);
      if (id !== undefined && id.tag === 0x06) {
        const same =
          id.end - id.start === oid.length && oid.every((byte, i) => der[id.start + i] === byte);
        const value = same ? derElement(der, id.end) : undefined;
        if (value !== undefined) return derString(der.subarray(value.start, value.end), value.tag);
      }
      inner = pair.end;
    }
    at = set.end;
  }
  return undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#X509.string */
function derString(bytes: Uint8Array, tag: number): string | undefined {
  switch (tag) {
    case 0x0c:
    case 0x13:
    case 0x16:
    case 0x14:
      return decodeUtf8(bytes);
    case 0x1e: {
      let text = "";
      for (let at = 0; at + 1 < bytes.length; at += 2) {
        text += String.fromCharCode(((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0));
      }
      return text;
    }
    default:
      return undefined;
  }
}

interface DerElement {
  readonly tag: number;
  /** Where the content starts. */
  readonly start: number;
  /** Where the content, and so the element, ends. */
  readonly end: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramValue.swift#X509.element */
function derElement(der: Uint8Array, at: number): DerElement | undefined {
  if (at + 2 > der.length) return undefined;
  const tag = der[at] ?? 0;
  let length = der[at + 1] ?? 0;
  let start = at + 2;
  if ((length & 0x80) !== 0) {
    const count = length & 0x7f;
    if (count < 1 || count > 4 || start + count > der.length) return undefined;
    length = 0;
    for (let index = 0; index < count; index++) length = length * 256 + (der[start + index] ?? 0);
    start += count;
  }
  if (start + length > der.length) return undefined;
  return { tag, start, end: start + length };
}
