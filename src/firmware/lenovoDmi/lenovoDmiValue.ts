import { L } from "@/core/localization/localization";
import {
  overwriting,
  type PartBadge,
  type PartCodec,
  type PartParent,
  PartRefusal,
  type PartUpdate,
  sourceBytes,
} from "@/core/parts/partCodec";
import type { LenovoDMIArea } from "@/firmware/lenovoDmi/lenovoDmiArea";
import {
  bytes16,
  hexText,
  isSMBIOS,
  keyTypeText,
  knownType,
  knownTypeName,
  knownTypeReading,
  LenovoDMIFormat,
  type LenovoDMIKey,
  type LenovoDMIReadingKind,
  sum16,
  u32,
  xored,
} from "@/firmware/lenovoDmi/lenovoDmiFormat";
import {
  entryDataRange,
  isWriteProtected,
  LENVBlock,
  type LENVEntry,
} from "@/firmware/lenovoDmi/lenvBlock";

/**
 * What an entry's bytes say, read the way its type is known to be read.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue
 */

/**
 * What is wrong with a Windows key entry that is not a header and a key:
 * shorter than the header; the first 16 bytes are not the signature; the length
 * the header gives against the bytes that follow it; or a key holding bytes that
 * are not printable.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.WindowsKey.Problem
 */
export type WindowsKeyProblem =
  | { readonly kind: "tooShort"; readonly length: number }
  | { readonly kind: "signature"; readonly head: readonly number[] }
  | { readonly kind: "length"; readonly declared: number; readonly actual: number }
  | { readonly kind: "notText" };

/**
 * The Windows key entry, read: the 20-byte header of the licensing data in the
 * ACPI `MSDM` table and the key after it.
 *
 * The header is a signature and a length. The fields are the MSDM table's
 * Software Licensing Structure — `version`, `reserved`, `data_type`,
 * `data_reserved`, `data_length`, each a `UINT32`, then the data — as
 * Microsoft's "Microsoft Software Licensing Tables (SLIC and MSDM)" defines it
 * and fwts (`fwts_acpi_table_msdm`, 2015) checks it: both reserved fields zero,
 * data type 1 for a product key, data length `0x1D`. The version is 1 on every
 * dump examined; fwts does not check it. Together that is the 16-byte signature
 * `01000000 00000000 01000000 00000000`. The length, the last 4 bytes, is the
 * key's: `1D000000` for `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`. The key is split off
 * only when both hold; otherwise the entry is shown as bytes and the panel says
 * which of them did not.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.WindowsKey
 */
export const WindowsKey = {
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.WindowsKey.headerSize */
  headerSize: 20,
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.WindowsKey.signature */
  signature: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] as readonly number[],

  /**
   * The key, when `data` is a header and a key.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.WindowsKey.init
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.WindowsKey.key
   */
  key(data: Uint8Array): string | undefined {
    if (WindowsKey.problem(data) !== undefined) return undefined;
    // Printable ASCII, which is the same text read as UTF-8 or byte by byte.
    return String.fromCharCode(...data.subarray(WindowsKey.headerSize));
  },

  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.WindowsKey.problem */
  problem(data: Uint8Array): WindowsKeyProblem | undefined {
    if (data.length < WindowsKey.headerSize) return { kind: "tooShort", length: data.length };
    const head = Array.from(data.subarray(0, WindowsKey.signature.length));
    if (!head.every((byte, index) => byte === WindowsKey.signature[index])) {
      return { kind: "signature", head };
    }
    const declared = u32(data, 16);
    const actual = data.length - WindowsKey.headerSize;
    if (declared !== actual) return { kind: "length", declared, actual };
    if (actual === 0 || !data.subarray(WindowsKey.headerSize).every(isPrintable)) {
      return { kind: "notText" };
    }
    return undefined;
  },
} as const;

const isPrintable = (byte: number): boolean => byte >= 0x20 && byte <= 0x7e;

/**
 * Without the zeros and spaces after the last character.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.trimmed
 */
export function trimmed(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end -= 1;
  return bytes.subarray(0, end);
}

/**
 * Printable ASCII, then nothing but padding.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.isText
 */
export function isText(bytes: Uint8Array): boolean {
  const body = trimmed(bytes);
  return body.length > 0 && body.every(isPrintable);
}

/** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.hex */
export const valueHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => hexText(byte, 2, false)).join(" ");

/**
 * A UUID in the order SMBIOS stores one: the first three fields little-endian.
 * On the dumps examined that order gives a version-1 UUID with the RFC variant;
 * the bytes taken as they lie give neither.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.uuid
 */
export function valueUUID(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new RangeError("a UUID is 16 bytes");
  const order = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];
  const digits = order.map((index) => hexText(bytes[index] ?? 0, 2, false));
  return [
    digits.slice(0, 4),
    digits.slice(4, 6),
    digits.slice(6, 8),
    digits.slice(8, 10),
    digits.slice(10, 16),
  ]
    .map((group) => group.join(""))
    .join("-");
}

/**
 * The value in one line: text without its padding, a UUID, or hex.
 *
 * An entry of a type nobody has documented reads as text when every byte is
 * printable — most of them are names and numbers — and as hex when it is not.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.text
 */
export function valueText(entry: LENVEntry): string {
  const known = knownType(entry.key);
  const reading: LenovoDMIReadingKind =
    known === undefined ? (isText(entry.data) ? "text" : "bytes") : knownTypeReading(known);
  switch (reading) {
    case "text":
      return isText(entry.data)
        ? String.fromCharCode(...trimmed(entry.data))
        : valueHex(entry.data);
    case "uuid":
      return entry.data.length === 16 ? valueUUID(entry.data) : valueHex(entry.data);
    case "windowsKey":
      return WindowsKey.key(entry.data) ?? valueHex(entry.data);
    case "bytes":
      return valueHex(entry.data);
  }
}

/**
 * What the panel calls an entry: its known name, or its type for one nobody has
 * named.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIValue.name
 */
export function entryName(key: LenovoDMIKey): string {
  const known = knownType(key);
  if (known !== undefined) return knownTypeName(known);
  return isSMBIOS(key)
    ? L("Unknown SMBIOS entry %1$@", keyTypeText(key))
    : L("Unknown entry %1$@", keyTypeText(key));
}

/**
 * Why an edit of the store cannot be written: the value is not as long as the
 * entry; no block holds an entry with this key; the entry is marked
 * write-protected in a block that holds it; or a block holding the entry cannot
 * be read reliably enough to write.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIEdit.Refusal
 */
export type LenovoDMIEditRefusal =
  | { readonly kind: "lengthChanges"; readonly expected: number; readonly got: number }
  | { readonly kind: "noSuchEntry" }
  | { readonly kind: "writeProtected"; readonly block: number }
  | { readonly kind: "blockUnreadable"; readonly block: number };

/**
 * One write to the file.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIEdit.Write
 */
export interface LenovoDMIWrite {
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIEdit.Write.offset */
  readonly offset: number;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIEdit.Write.bytes */
  readonly bytes: Uint8Array;
}

/**
 * The writes that put a new value into an entry, the way the firmware would
 * find it: encoded with the block's key, with the block's checksum recomputed.
 *
 * The value never changes length. `L05SmbiosOverride` builds the SMBIOS tables
 * from these entries partly by fixed offsets, so an entry that grew or shrank
 * would move what comes after it in a way nobody has worked out.
 *
 * Every block that holds the entry is written — both copies, so the firmware
 * reads the new value whichever it picks. A block without the entry is left as
 * it is, and the result says which blocks were written. The generation is not
 * touched, and nothing is appended to the change log: the firmware writes the
 * log when *it* writes, and an entry made up here would be a record of something
 * the firmware never did.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIEdit
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIEdit.set
 * @upstream-differs a refusal is answered, not thrown: Swift's `throws` is a union here
 */
export function setEntry(
  key: LenovoDMIKey,
  value: Uint8Array,
  area: LenovoDMIArea
):
  | { readonly ok: true; readonly writes: LenovoDMIWrite[]; readonly blocks: number[] }
  | { readonly ok: false; readonly refusal: LenovoDMIEditRefusal } {
  const writes: LenovoDMIWrite[] = [];
  const written: number[] = [];
  for (const [index, block] of area.blocks.entries()) {
    const entry = block.isUsable ? block.entry(key) : undefined;
    if (entry === undefined) continue;
    if (!block.entriesFit) return { ok: false, refusal: { kind: "blockUnreadable", block: index } };
    if (isWriteProtected(entry)) {
      return { ok: false, refusal: { kind: "writeProtected", block: index } };
    }
    if (value.length !== entry.data.length) {
      return {
        ok: false,
        refusal: { kind: "lengthChanges", expected: entry.data.length, got: value.length },
      };
    }
    const encoded = xored(value, block.effectiveKey);
    const dataStart = entryDataRange(entry)[0];
    const stored = block.stored.slice();
    stored.set(encoded, dataStart - block.offset);
    const checksum = sum16(stored.subarray(LenovoDMIFormat.lenvHeaderSize));
    writes.push({ offset: dataStart, bytes: encoded });
    writes.push({ offset: block.offset + 0x0e, bytes: bytes16(checksum) });
    written.push(index);
  }
  if (written.length === 0) return { ok: false, refusal: { kind: "noSuchEntry" } };
  return { ok: true, writes, blocks: written };
}

/**
 * A whole block in the clear, and the way back.
 *
 * The decoded block is the header as stored and the body decoded: what a
 * technician reads in the hex view — the serial number as text — and can edit
 * in place. Putting it back encodes the body again with the key in the header
 * and writes the checksum the encoded body adds up to, so the block that lands
 * in the file is one the firmware reads.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIDecodedBlock
 */
export const LenovoDMIDecodedBlock = {
  /**
   * Whether the block can be opened decoded: signed, holding something, and
   * stored in a way that was recognised. A block whose entries parse under
   * neither reading is not decoded on a guess.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIDecodedBlock.canOpen
   */
  canOpen(block: LENVBlock): boolean {
    return block.hasSignature && !block.isBlank && block.encoding !== "undetermined";
  },

  /**
   * The block with its body decoded.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIDecodedBlock.decode
   */
  decode(block: LENVBlock): Uint8Array {
    const clear = new Uint8Array(block.stored.length);
    clear.set(block.stored.subarray(0, LenovoDMIFormat.lenvHeaderSize));
    clear.set(xored(block.storedBody, block.effectiveKey), LenovoDMIFormat.lenvHeaderSize);
    return clear;
  },

  /**
   * What the file gets back for `bytes`, a block in the clear: the body XORed
   * with the key byte of `bytes`' own header — so a key changed in the panel is
   * the key the block is written under — unless `encodes` is false, for a block
   * that was stored in the clear and stays so, and the checksum of the body as
   * it will be stored. Nothing for a block that is not a page long.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIDecodedBlock.encode
   * @upstream-differs nothing for the wrong length rather than a thrown refusal
   */
  encode(bytes: Uint8Array, encodes: boolean): Uint8Array | undefined {
    if (bytes.length !== LenovoDMIFormat.lenvSize) return undefined;
    const size = LenovoDMIFormat.lenvHeaderSize;
    const key = encodes ? (bytes[0x0d] ?? 0) : 0;
    const body = xored(bytes.subarray(size), key);
    const stored = new Uint8Array(bytes.length);
    stored.set(bytes.subarray(0, size));
    stored.set(bytes16(sum16(body)), 0x0e);
    stored.set(body, size);
    return stored;
  },
} as const;

/**
 * A `LENV` block opened in the clear and put back encoded: the codec Open
 * Decoded Block hands the application.
 *
 * Decoding takes the block as the file holds it now and decodes the body;
 * encoding encodes it again with the key in the panel's own header and writes
 * the checksum. Byte `n` of the panel is byte `n` of the block, so the parent's
 * bookmarks reach it.
 *
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIBlockCodec
 * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIBlockCodec.init
 */
export class LenovoDMIBlockCodec implements PartCodec {
  /**
   * False for a block that was stored in the clear: it goes back the same way,
   * with only its checksum recomputed.
   *
   * @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIBlockCodec.encodes
   */
  readonly encodes: boolean;
  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIBlockCodec.key */
  readonly key: number;
  readonly isImmediate = true;
  readonly decodesImmediately = true;
  readonly keepsOffsets = true;

  constructor(block: LENVBlock) {
    this.encodes = block.encoding !== "plain";
    this.key = block.xorKey;
  }

  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIBlockCodec.decode */
  async decode(parent: PartParent): Promise<Uint8Array> {
    const stored = await sourceBytes(parent);
    if (stored.length !== LenovoDMIFormat.lenvSize) {
      throw new PartRefusal(
        L("Those bytes could not be read."),
        L("A LENV block is %1$@ bytes, and goes back only at that length.", "0x1000")
      );
    }
    return LenovoDMIDecodedBlock.decode(new LENVBlock(parent.source[0], stored));
  }

  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIBlockCodec.encode */
  async encode(part: Uint8Array, parent: PartParent): Promise<PartUpdate> {
    const length = parent.source[1] - parent.source[0];
    const encoded =
      part.length === length ? LenovoDMIDecodedBlock.encode(part, this.encodes) : undefined;
    if (encoded === undefined) {
      throw PartRefusal.lengthChanged({
        part: parent.partName,
        parent: parent.name,
        source: length,
        now: part.length,
      });
    }
    return overwriting(parent.source, encoded);
  }

  /** @upstream Packages/LenovoDMI/Sources/LenovoDMI/LenovoDMIValue.swift#LenovoDMIBlockCodec.badge */
  get badge(): PartBadge {
    if (!this.encodes) {
      return {
        text: L("Plain", { context: "part badge" }),
        explanation: L(
          "A LENV block stored in the clear. Update in Parent recomputes its checksum."
        ),
      };
    }
    return {
      text: `XOR ${hexText(this.key, 2, false)}`,
      explanation: L(
        "Decoded from the file. Update in Parent encodes it again with the key in its header and recomputes the checksum."
      ),
    };
  }
}
