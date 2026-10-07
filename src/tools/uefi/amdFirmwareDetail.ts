import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import {
  AddressMode,
  type AddressModeCode,
  type AMDDirectory,
  type AMDEntry,
  type AMDFirmware,
  amdBlobs,
  amdDirectoryName,
  amdEntryName,
  amdEntryTypeName,
  DirectoryKind,
  directoryAddressMode,
  directoryRange,
  directorySignature,
  EFS_SIGNATURE,
  entryInstance,
  entryIsCompressed,
  entryIsCopy,
  entryIsReadOnly,
  entryIsReset,
  entryIsValue,
  entryIsWritable,
  entryPointsAtDirectory,
  entrySubprogram,
  isComboDirectory,
  readAMDFirmware,
} from "@/firmware/uefi/amdFirmware";
import type { ChecksumRepair } from "@/firmware/uefi/checksumRepair";
import { checksumText } from "@/firmware/uefi/checksums";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import {
  cell,
  type DetailField,
  type DetailTable,
  type DetailTableTarget,
  field,
} from "@/tools/toolDetail";

/**
 * What the details say of the AMD PSP's map (`AMDFirmware`): the EFS and the directories it
 * points at, a directory and every entry it lists, a blob and the entries that list it. Read
 * again from the file on each selection — a few kilobytes of headers — since the node keeps
 * only its place and its name.
 *
 * Where an entry's blob is a row of the tree, its line leads to the row; where it is
 * something else's bytes — a compressed BIOS image inside a volume, a store across a
 * volume's edge — to its bytes in the dump.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAMDFirmwareDetail.swift#UEFIAMDFirmwareDetail
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAMDFirmwareDetail.swift#UEFIAMDFirmwareDetail.build
 */
export function amdFirmwareDetail(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader,
  repairs: readonly ChecksumRepair[]
): { fields: DetailField[]; tables: DetailTable[] } {
  if (node.space.length !== 0) return { fields: [], tables: [] };
  const firmware = readAMDFirmware(reader);
  if (firmware === undefined) return { fields: [], tables: [] };
  switch (node.kind) {
    case "amdEFS":
      return efs(firmware, image);
    case "amdDirectory": {
      const directory = firmware.directories.find((one) => one.offset === node.header.start);
      return directory === undefined
        ? { fields: [], tables: [] }
        : directoryDetail(directory, firmware, image, repairs);
    }
    case "amdFirmwareEntry":
      return blob(node, firmware, image);
    default:
      return { fields: [], tables: [] };
  }
}

const hex = (value: number | bigint): string => `0x${value.toString(16).toUpperCase()}`;
const sizeText = (value: number): string => (value === 0 ? "Empty" : `${hex(value)} (${value})`);
const hex2 = (value: number): string => `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;

// MARK: - The EFS

function efs(
  firmware: AMDFirmware,
  image: UEFIImage
): { fields: DetailField[]; tables: DetailTable[] } {
  const fields = [
    field("Signature", hex(EFS_SIGNATURE)),
    field(L("Flash size"), sizeText(firmware.romSize)),
  ];
  const rows: DetailTable["rows"][number][] = [];
  const targets: (DetailTableTarget | undefined)[] = [];
  for (const pointer of firmware.pointers) {
    const directory = firmware.directories.find((one) => one.offset === pointer.target);
    rows.push([
      cell(`+${hex(pointer.field)}`),
      cell(hex(pointer.value)),
      cell(directory === undefined ? "" : amdDirectoryName(directory)),
    ]);
    targets.push(
      directory === undefined
        ? undefined
        : targetFor(directoryRange(directory), amdDirectoryName(directory), image)
    );
  }
  const table: DetailTable = {
    title: L("Directories"),
    symbol: "list.bullet.rectangle",
    columns: [L("Field"), L("Value"), L("Directory")],
    rows,
    rowTargets: targets,
    linkColumn: 1,
  };
  return { fields, tables: [table] };
}

// MARK: - A directory

function directoryDetail(
  directory: AMDDirectory,
  firmware: AMDFirmware,
  image: UEFIImage,
  repairs: readonly ChecksumRepair[]
): { fields: DetailField[]; tables: DetailTable[] } {
  const fields: DetailField[] = [];
  const signature = directorySignature(directory.kind);
  if (signature !== undefined) fields.push(field("Signature", signature));
  if (directory.storedChecksum !== undefined) {
    const repair = repairs.find((one) => one.offset === directory.offset + 4);
    const expected =
      repair === undefined
        ? undefined
        : repair.bytes.reduceRight((value, byte) => value * 256 + byte, 0);
    fields.push(
      field(
        "Checksum",
        checksumText({
          value: directory.storedChecksum,
          valid: repair === undefined,
          expected,
          digits: 8,
        }),
        repair !== undefined
      )
    );
  }
  if (directory.pspID !== undefined) fields.push(field("PSP ID", hex(directory.pspID)));

  if (directory.kind === DirectoryKind.slotHeader) {
    if (directory.slot !== undefined) fields.push(field(L("Slot"), directory.slot));
    if (directory.priority !== undefined)
      fields.push(field(L("Priority"), hex(directory.priority)));
    const level2 = firmware.directories.find((one) => one.offset === directory.slotTarget);
    if (directory.slotTarget === undefined || level2 === undefined) return { fields, tables: [] };
    const name = amdDirectoryName(level2);
    return {
      fields,
      tables: [
        {
          title: L("Second level"),
          symbol: "list.bullet.rectangle",
          columns: [L("Directory"), L("Location")],
          rows: [[cell(name), cell(hex(directory.slotTarget))]],
          rowTargets: [targetFor(directoryRange(level2), name, image)],
        },
      ],
    };
  }

  if (isComboDirectory(directory.kind)) {
    fields.push(field(L("Entries"), `${directory.comboEntries.length}`));
    const rows: DetailTable["rows"][number][] = [];
    const targets: (DetailTableTarget | undefined)[] = [];
    directory.comboEntries.forEach((entry, index) => {
      const chosen = firmware.directories.find((one) => one.offset === entry.resolvedOffset);
      rows.push([
        cell(`${index}`),
        cell(hex(entry.id)),
        cell(entry.resolvedOffset === undefined ? "—" : hex(entry.resolvedOffset)),
        cell(chosen === undefined ? "" : amdDirectoryName(chosen)),
      ]);
      targets.push(
        chosen === undefined
          ? undefined
          : targetFor(directoryRange(chosen), amdDirectoryName(chosen), image)
      );
    });
    return {
      fields,
      tables: [
        {
          title: L("Directories"),
          symbol: "list.bullet.rectangle",
          // A combo directory's ids are PSP ids, unless its header says chip family ids.
          columns: [
            "#",
            directory.info === 1 ? L("Chip family ID") : "PSP ID",
            L("Location"),
            L("Directory"),
          ],
          rows,
          rowTargets: targets,
          linkColumn: 2,
        },
      ],
    };
  }

  fields.push(field(L("Entries"), `${directory.entries.length}`));
  fields.push(field(L("Address mode"), addressModeText(directoryAddressMode(directory))));
  const rows: DetailTable["rows"][number][] = [];
  const targets: (DetailTableTarget | undefined)[] = [];
  for (const entry of directory.entries) {
    const value = entryIsValue(entry);
    rows.push([
      cell(`${entry.index}`),
      cell(`${amdEntryTypeName(entry)} (${hex2(entry.type)})`),
      cell(
        value
          ? "—"
          : sizeText(entry.range === undefined ? entry.size : entry.range.end - entry.range.start)
      ),
      cell(value || entry.resolvedOffset === undefined ? "—" : hex(entry.resolvedOffset)),
      cell(notes(entry, image.size)),
    ]);
    targets.push(entryTarget(entry, firmware, image));
  }
  return {
    fields,
    tables: [
      {
        title: L("Entries"),
        symbol: "list.bullet.rectangle",
        columns: ["#", L("Type"), L("Size"), L("Location"), L("Notes")],
        rows,
        rowTargets: targets,
        linkColumn: 3,
      },
    ],
  };
}

/** Where an entry leads: the directory it points at, or its blob — a row, or bytes in the dump. */
function entryTarget(
  entry: AMDEntry,
  firmware: AMDFirmware,
  image: UEFIImage
): DetailTableTarget | undefined {
  if (entryPointsAtDirectory(entry) && entry.resolvedOffset !== undefined) {
    const directory = firmware.directories.find((one) => one.offset === entry.resolvedOffset);
    if (directory !== undefined) {
      return targetFor(directoryRange(directory), amdDirectoryName(directory), image);
    }
  }
  const range = entry.range;
  if (range === undefined) return undefined;
  // The blob the tree reads is the one the smallest entry names.
  const blob =
    amdBlobs(firmware).find((one) => one.entry.range?.start === range.start)?.entry.range ?? range;
  return targetFor(blob, amdEntryName(entry), image);
}

/**
 * The row that is exactly `range`; else the FFS structure that holds all of it — the Zlib
 * section a compressed BIOS image sits in — and the bytes when there is neither.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAMDFirmwareDetail.swift#UEFIAMDFirmwareDetail.target
 */
function targetFor(
  range: { readonly start: number; readonly end: number },
  name: string,
  image: UEFIImage
): DetailTableTarget {
  const chain = image.nodesContaining(range.start);
  const exact = chain.findLast((node) => {
    if (node.space.length !== 0) return false;
    const own = nodeRange(node);
    return own.start === range.start && own.end === range.end;
  });
  if (exact !== undefined) return { kind: "node", path: exact.id };
  const holder = chain.findLast((node) => {
    if (node.space.length !== 0) return false;
    if (node.kind !== "section" && node.kind !== "file" && node.kind !== "volume") return false;
    const own = nodeRange(node);
    return own.start <= range.start && range.end <= own.end;
  });
  if (holder !== undefined) return { kind: "node", path: holder.id };
  return { kind: "range", start: range.start, end: range.end, name };
}

/** What an entry's flags, instance and destination say, in a few words. */
function notes(entry: AMDEntry, fileSize: number): string {
  const parts: string[] = [];
  if (entryIsValue(entry)) parts.push(L("value %1$@", hex(entry.location)));
  if (entryInstance(entry) !== 0) parts.push(L("instance %1$@", `${entryInstance(entry)}`));
  if (entrySubprogram(entry) !== 0) parts.push(L("subprogram %1$@", `${entrySubprogram(entry)}`));
  if (entryIsCompressed(entry)) parts.push(L("compressed, inflates to %1$@", hex(entry.size)));
  if (entryIsReset(entry)) parts.push(L("reset image"));
  if (entryIsCopy(entry)) parts.push(L("copied to memory"));
  if (entryIsReadOnly(entry)) parts.push(L("read-only"));
  if (entryIsWritable(entry)) parts.push(L("writable"));
  if (
    entry.destination !== undefined &&
    entry.destination !== 0xffff_ffff_ffff_ffffn &&
    entry.destination !== 0n
  ) {
    parts.push(L("destination %1$@", hex(entry.destination)));
  }
  if (
    !entryIsValue(entry) &&
    entry.range === undefined &&
    entry.resolvedOffset !== undefined &&
    entry.size > 0 &&
    entry.resolvedOffset + entry.size > fileSize
  ) {
    parts.push(L("outside the image"));
  }
  return parts.join(", ");
}

function addressModeText(mode: AddressModeCode): string {
  switch (mode) {
    case AddressMode.physical:
      return L("Memory-mapped address");
    case AddressMode.flashOffset:
      return L("Offset in the flash");
    case AddressMode.directoryRelative:
      return L("Offset from the directory, or as each entry says");
    default:
      return L("Offset from the slot, or as each entry says");
  }
}

// MARK: - A blob

function blob(
  node: UEFINode,
  firmware: AMDFirmware,
  image: UEFIImage
): { fields: DetailField[]; tables: DetailTable[] } {
  const start = nodeRange(node).start;
  const listings: { entry: AMDEntry; directory: AMDDirectory }[] = [];
  for (const directory of firmware.directories) {
    for (const entry of directory.entries) {
      if (entry.range?.start === start && !entryPointsAtDirectory(entry)) {
        listings.push({ entry, directory });
      }
    }
  }
  const first = listings[0];
  if (first === undefined) return { fields: [], tables: [] };
  const entry = first.entry;
  const fields: DetailField[] = [
    field(L("Entry type"), `${amdEntryTypeName(entry)} (${hex2(entry.type)})`),
  ];
  if (entryInstance(entry) !== 0) fields.push(field(L("Instance"), `${entryInstance(entry)}`));
  if (entry.isBIOS && entry.subtype !== 0) fields.push(field(L("Region type"), hex(entry.subtype)));
  if (entrySubprogram(entry) !== 0)
    fields.push(field(L("Subprogram"), `${entrySubprogram(entry)}`));
  const flags = notes(entry, image.size);
  if (flags.length > 0) fields.push(field(L("Entry flags"), flags));
  if (entry.isStoredCompressed) {
    fields.push(field(L("Compressed size"), sizeText(node.body.end - node.body.start)));
  }
  // A blob the directories give different room says so.
  const sizes = [...new Set(listings.map((one) => one.entry.size))].sort((a, b) => a - b);
  const own = nodeRange(node);
  if (
    (sizes.length > 1 || (sizes[0] !== undefined && sizes[0] !== own.end - own.start)) &&
    !entryIsCompressed(entry)
  ) {
    fields.push(field(L("Size in the directories"), sizes.map((size) => hex(size)).join(", ")));
  }

  const rows: DetailTable["rows"][number][] = [];
  const targets: (DetailTableTarget | undefined)[] = [];
  for (const listing of listings) {
    const name = amdDirectoryName(listing.directory);
    rows.push([cell(name), cell(`${listing.entry.index}`)]);
    targets.push(targetFor(directoryRange(listing.directory), name, image));
  }
  return {
    fields,
    tables: [
      {
        title: L("Listed in"),
        symbol: "list.bullet.rectangle",
        columns: [L("Directory"), "#"],
        rows,
        rowTargets: targets,
        linkColumn: 0,
      },
    ],
  };
}
