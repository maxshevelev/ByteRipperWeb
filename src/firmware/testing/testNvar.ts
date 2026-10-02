import { encodeUtf8 } from "@/core/text/utf";
import {
  BinaryWriter,
  DRIVER_GUID,
  file,
  sectionedFile,
  volume,
} from "@/firmware/testing/testImage";
import { ucs2 } from "@/firmware/testing/testNvram";
import { sum8 } from "@/firmware/uefi/checksums";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import { NVAR } from "@/firmware/uefi/nvarParser";
import { nvramNvarStoreFileGuid } from "@/firmware/uefi/nvramGuids";

/**
 * AMI NVAR stores, built byte for byte (§9). Ported from upstream's
 * `TestNVAR.swift`.
 *
 * An NVAR store has no header: it is entries back to back, erased space, and a
 * table of GUIDs at the very end, counted backwards. So a store here is a list
 * of entries and a list of GUIDs, and every field of an entry is a parameter —
 * the stores worth testing are the ones with a superseded entry, a chain, a
 * checksum that does not add up.
 */

const join = (...parts: readonly Uint8Array[]): Uint8Array => {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
};

/**
 * An entry: `NVAR`, the size, `next`, the attributes, then — on a valid entry
 * that is not a later link — the GUID or its index and the name, then the data
 * and the extended header.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestNVAR.swift#TestNVAR.entry
 */
export function nvarEntry(
  options: {
    readonly attributes?: number;
    readonly next?: number;
    readonly guid?: EFIGUID;
    readonly guidIndex?: number;
    readonly name?: string;
    readonly data?: Uint8Array;
    readonly extended?: Uint8Array;
  } = {}
): Uint8Array {
  const attributes = options.attributes ?? NVAR.valid | NVAR.localGuid | NVAR.asciiName;
  const fields = new BinaryWriter();
  if ((attributes & NVAR.valid) !== 0 && (attributes & NVAR.dataOnly) === 0) {
    if ((attributes & NVAR.localGuid) !== 0) fields.guid(options.guid ?? DRIVER_GUID);
    else fields.u8(options.guidIndex ?? 0);
    const name = options.name ?? "Setup";
    if ((attributes & NVAR.asciiName) !== 0) {
      fields.raw([...encodeUtf8(name), 0]);
    } else {
      fields.raw(ucs2(name));
    }
  }
  fields.raw(options.data ?? Uint8Array.of(0x01, 0x02));
  fields.raw(options.extended ?? []);

  return new BinaryWriter()
    .u32(NVAR.signature)
    .u16(NVAR.headerSize + fields.count)
    .u24(options.next ?? NVAR.noNext)
    .u8(attributes)
    .raw(fields.bytes).bytes;
}

/**
 * A whole entry the firmware has since superseded: written valid, with its
 * GUID and name, then its valid bit cleared — which is all the firmware does to
 * it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestNVAR.swift#TestNVAR.supersededEntry
 */
export function supersededNvarEntry(name: string, data: Uint8Array): Uint8Array {
  const bytes = nvarEntry({ name, data });
  bytes[9] = (bytes[9] ?? 0) & ~NVAR.valid & 0xff;
  return bytes;
}

/**
 * A later link of a chain: no GUID and no name, only data.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestNVAR.swift#TestNVAR.dataEntry
 */
export function nvarDataEntry(options: {
  readonly next?: number;
  readonly data: Uint8Array;
  readonly valid?: boolean;
}): Uint8Array {
  return nvarEntry({
    attributes: ((options.valid ?? true) ? NVAR.valid : 0) | NVAR.dataOnly,
    next: options.next ?? NVAR.noNext,
    data: options.data,
  });
}

/**
 * An entry whose four-byte extended header carries a checksum — the extended
 * attributes, the checksum, and the header's own size. Right, unless `wrongBy`
 * says how far off to make it.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestNVAR.swift#TestNVAR.checksummedEntry
 */
export function checksummedNvarEntry(options: {
  readonly name: string;
  readonly data: Uint8Array;
  readonly next?: number;
  readonly wrongBy?: number;
}): Uint8Array {
  const attributes = NVAR.valid | NVAR.localGuid | NVAR.asciiName | NVAR.extendedHeader;
  const bytes = nvarEntry({
    attributes,
    name: options.name,
    data: options.data,
    ...(options.next === undefined ? {} : { next: options.next }),
    extended: Uint8Array.of(NVAR.extendedChecksum, 0x00, 0x04, 0x00),
  });
  // Over the data and the extended header, the size and the attributes.
  const covered = bytes.subarray(bytes.length - 4 - options.data.length);
  const sum = (sum8(covered) + (bytes[4] ?? 0) + (bytes[5] ?? 0) + attributes) & 0xff;
  bytes[bytes.length - 3] = (0x100 - sum + (options.wrongBy ?? 0)) & 0xff;
  return bytes;
}

/**
 * A store `length` bytes long: the entries, the erase byte, and the GUID table,
 * whose index 0 is the store's last sixteen bytes.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestNVAR.swift#TestNVAR.store
 */
export function nvarStore(
  entries: readonly Uint8Array[],
  options: {
    readonly guids?: readonly EFIGUID[];
    readonly length?: number;
    readonly emptyByte?: number;
  } = {}
): Uint8Array {
  const body = join(...entries);
  const table = new BinaryWriter();
  for (const one of [...(options.guids ?? [])].reverse()) table.guid(one);
  const free = (options.length ?? 0x100) - body.length - table.count;
  return join(body, new Uint8Array(free).fill(options.emptyByte ?? 0xff), table.bytes);
}

/**
 * An FFSv2 volume holding one raw file whose body is `body`.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/TestNVAR.swift#TestNVAR.volume
 */
export function nvarVolume(options: {
  readonly fileGuid?: EFIGUID;
  readonly body: Uint8Array;
}): Uint8Array {
  return volume({
    length: 0x400,
    files: [file({ guid: options.fileGuid ?? nvramNvarStoreFileGuid, body: options.body })],
  });
}

/** An FFSv2 volume holding one freeform file with these sections. */
export function nvarSectionVolume(options: {
  readonly fileGuid?: EFIGUID;
  readonly sections: readonly Uint8Array[];
}): Uint8Array {
  return volume({
    length: 0x400,
    files: [
      sectionedFile({
        guid: options.fileGuid ?? DRIVER_GUID,
        type: 0x02,
        sections: options.sections,
      }),
    ],
  });
}
