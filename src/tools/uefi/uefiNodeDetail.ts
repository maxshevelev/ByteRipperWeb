import { L } from "@/core/localization/localization";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { amdCpuID, amdMicrocodeDate, readAMDMicrocode } from "@/firmware/uefi/amdMicrocode";
import { readAppleROMInformation, searchLimit } from "@/firmware/uefi/appleRomInformation";
import { readBIOSIdentifier } from "@/firmware/uefi/biosIdentifier";
import { outermostSection } from "@/firmware/uefi/byteSpace";
import { type ChecksumRepair, volumeErasePolarityOf } from "@/firmware/uefi/checksumRepair";
import { checksumText, crc32, sum8, sum8Of } from "@/firmware/uefi/checksums";
import type { DellSetupSetting } from "@/firmware/uefi/dellSetupForms";
import { generationCodeName, generationSeries } from "@/firmware/uefi/descriptorGeneration";
import {
  type DescriptorChipSource,
  type DescriptorClock,
  type DescriptorComponent,
  type DescriptorInfo,
  type DescriptorProtectedRange,
  isProtectedRangeOn,
  readDescriptorInfo,
} from "@/firmware/uefi/descriptorInfo";
import { FLASH_REGIONS, regionLabel } from "@/firmware/uefi/descriptorParser";
import { allECImages, isECFirmwarePadding } from "@/firmware/uefi/ecFirmware";
import { type EFIGUID, guidEquals, guidText } from "@/firmware/uefi/efiGuid";
import { fileTypeName, marksHeaderInvalid } from "@/firmware/uefi/fileParser";
import {
  acmSubtypeName,
  fitComponentKindOf,
  readFITComponentHeader,
} from "@/firmware/uefi/fitComponents";
import { FlashDeviceMap, regionTypeName } from "@/firmware/uefi/flashDeviceMapFormat";
import {
  type FlashDeviceMapEntry,
  flashDeviceMapAddressDiff,
  flashDeviceMapEntries,
  flashDeviceMapEntryRange,
} from "@/firmware/uefi/flashDeviceMapParser";
import { readInsydeBvdt } from "@/firmware/uefi/insydeBvdt";
import { allITEFirmware } from "@/firmware/uefi/iteFirmware";
import { itemType } from "@/firmware/uefi/itemClassification";
import { nameOfGuid } from "@/firmware/uefi/knownGuids";
import {
  microcodeCpuid,
  microcodeFields,
  microcodePlatformsText,
  microcodeProcessorText,
  readMicrocodeHeader,
} from "@/firmware/uefi/microcodeParser";
import { NVAR, nvarChecksumOf } from "@/firmware/uefi/nvarParser";
import {
  fillPercentUsed,
  fillUsed,
  type NvramStoreFill,
  nvramStoreFillOf,
} from "@/firmware/uefi/nvramStoreFill";
import { readNvramValue } from "@/firmware/uefi/nvramValue";
import {
  changedBytes,
  isNoChange,
  type NvramVariableChange,
  type NvramVariableHistory,
  type NvramVariableVersion,
  variableChange,
  variableHistoryOf,
  variableOf,
} from "@/firmware/uefi/nvramVariableHistory";
import {
  pictureFormatName,
  pictureFormatOf,
  pictureMimeType,
  readPicture,
} from "@/firmware/uefi/picture";
import {
  isIbbKind,
  type ProtectedRange,
  protectedRangeKindName,
  rangesTouchingNode,
} from "@/firmware/uefi/protectedRanges";
import { sectionTypeName } from "@/firmware/uefi/sectionParser";
import { readSound, soundDuration, soundEncodingName } from "@/firmware/uefi/sound";
import { tcgHashName } from "@/firmware/uefi/tcgHash";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { isNodeCompressed, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub, subtypeName } from "@/firmware/uefi/uefiTypes";
import {
  decodedVssName,
  isZeroTime,
  readVssEntryIn,
  timeText,
  type VSSVariable,
} from "@/firmware/uefi/vssVariable";
import {
  cell,
  type DetailCell,
  type DetailField,
  type DetailTable,
  type DetailTableTarget,
  field,
  type NodeDetail,
  permission,
  tonedField,
} from "@/tools/toolDetail";
import {
  nvarValueAttributes,
  nvramSignaturesTable,
  nvramValueFields,
} from "@/tools/uefi/nvramValueText";
import { uefiTopSwapDetail } from "@/tools/uefi/uefiTopSwap";
import { dvarMeaning, kindLabel } from "@/tools/uefi/uefiTreeDisplay";

/**
 * What the panel says about the selected node, by its type. Ported from
 * upstream's `UEFINodeDetail.swift` (`Design/UEFI_STRUCTURE_TOOL.md`).
 *
 * The fields come from the bytes, through the same reader the parser used: a
 * field the header does not hold is absent, not guessed, and the name tables are
 * the parser's own, not re-derived here.
 *
 * One divergence: upstream's "Decompressed from" row is not here, because this
 * port does not open compressed sections yet.
 *
 * @param repairs the writes that would put this node's checksums right, or none
 *   when they check out. A repair at a checksum's own offset says that field is
 *   wrong, and its bytes are the value the row quotes as what it should be.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.build
 */
export function buildNodeDetail(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader,
  repairs: readonly ChecksumRepair[] = []
): NodeDetail {
  const detail = withMapRegions(
    withListedRanges(
      withVariableHistory(buildDetailRows(node, image, reader, repairs), node, image, reader),
      node,
      image,
      reader
    ),
    node,
    image,
    reader
  );
  // A sound is played as well: its bytes are the whole WAV file.
  if (node.kind === "sound") {
    const sound = reader.bytes(node.body);
    return sound === undefined ? detail : { ...detail, sound };
  }
  // A picture is shown as well as described. Only one the parser recognised and
  // measured: its bytes are exactly the picture's.
  if (node.kind !== "picture") return detail;
  const bytes = reader.bytes(node.body);
  const format = node.subtype === undefined ? undefined : pictureFormatOf(node.subtype);
  if (bytes === undefined || format === undefined) return detail;
  return { ...detail, picture: { bytes, mime: pictureMimeType(format) } };
}

/**
 * What the BVDT's `$BME$` record lists, placed in the file.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.build
 */
function withListedRanges(
  detail: NodeDetail,
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): NodeDetail {
  if (
    node.kind !== "flashDeviceMapRegion" ||
    node.guid === undefined ||
    !guidEquals(node.guid, FlashDeviceMap.biosVersionDataTable)
  ) {
    return detail;
  }
  const table = readInsydeBvdt(node.body, reader);
  if (table === undefined || table.listedRanges.length === 0) return detail;
  return {
    ...detail,
    tables: [listedRangesTable(table.listedRanges, node, image), ...detail.tables],
  };
}

/**
 * What Setup says the variable is (`DellSetupCatalogue`): the option as its page
 * words it, its keyword, the page, what this copy's value means there, and the
 * page's help for it. All the firmware's own English.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.settingFields
 */
function settingFields(setting: DellSetupSetting, value: Uint8Array): DetailField[] {
  const fields: DetailField[] = [field(L("Setup option"), setting.prompt)];
  if (setting.keyword !== undefined) fields.push(field(L("Keyword"), setting.keyword));
  if (setting.form !== undefined && setting.form !== setting.prompt) {
    fields.push(field(L("Setup page"), setting.form));
  }
  if (value.length > 0 && value.length <= 8) {
    let number = 0n;
    for (let index = value.length - 1; index >= 0; index--) {
      number = (number << 8n) | BigInt(value[index] ?? 0);
    }
    const meaning = dvarMeaning(number, setting);
    if (meaning !== undefined) {
      fields.push(
        field(L("Value in Setup"), `${meaning} (0x${number.toString(16).toUpperCase()})`)
      );
    }
  }
  if (setting.help !== undefined) fields.push(field(L("Setup help"), setting.help));
  return fields;
}

/**
 * The header the reference prints for a DVAR entry: the state by its name, the
 * flags and type, the namespace id it is filed under, the name id and the data
 * size.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.dvarFields
 */
function dvarFields(node: UEFINode, reader: ImageReader): DetailField[] {
  const h = node.header.start;
  const raw = reader.bytesAt(h, 5);
  if (raw === undefined) return [];
  const state = 0xff - (raw[0] ?? 0);
  const flags = 0xff - (raw[1] ?? 0);
  const type = 0xff - (raw[2] ?? 0);
  const stateNames: Readonly<Record<number, string>> = {
    1: "Storing",
    5: "Stored",
    21: "Deleting",
    85: "Deleted",
  };
  const stateName = stateNames[state];
  const fields: DetailField[] = [
    field("State", stateName === undefined ? hex(state) : `${hex(state)} (${stateName})`),
    field(
      "Entry flags",
      bits(flags, [
        [0x02, "NameId"],
        [0x04, "NamespaceGuid"],
      ])
    ),
    field("Type", hex(type)),
    field("Attributes", hex(0xff - (raw[3] ?? 0))),
    field("Namespace ID", hex(0xff - (raw[4] ?? 0))),
  ];
  // Past the namespace's GUID, when the entry declares one, the name id and the
  // data size, one or two bytes each by the type.
  let cursor = h + 5 + ((flags & 0x04) !== 0 ? 16 : 0);
  const wideName = type !== 0x00;
  const wideSize = type === 0x05;
  const nameId = wideName ? reader.uint16(cursor) : reader.uint8(cursor);
  if (nameId !== undefined) fields.push(field("Name ID", hex((wideName ? 0xffff : 0xff) - nameId)));
  cursor += wideName ? 2 : 1;
  const size = wideSize ? reader.uint16(cursor) : reader.uint8(cursor);
  if (size !== undefined)
    fields.push(field("Data size", sizeText((wideSize ? 0xffff : 0xff) - size)));
  return fields;
}

/**
 * `$BME$`'s ranges, which are offsets into the BIOS region, as addresses in the
 * file, and the node each one is exactly — the BVDT's own region, a volume —
 * where one is. What the list is for is not known, so the table says where and
 * not why.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.listedRangesTable
 */
function listedRangesTable(
  ranges: readonly ImageRange[],
  near: UEFINode,
  image: UEFIImage
): DetailTable {
  // A dump of the BIOS region alone starts with it.
  const biosIndex = FLASH_REGIONS.indexOf("bios");
  const bios =
    image
      .nodesContaining(nodeRange(near).start)
      .find((one) => one.kind === "region" && one.subtype === biosIndex) ?? undefined;
  const origin = bios === undefined ? 0 : nodeRange(bios).start;
  const rows: DetailCell[][] = [];
  const targets: (DetailTableTarget | undefined)[] = [];
  for (const range of ranges) {
    const start = origin + range.start;
    const end = origin + range.end;
    const holder = image.allNodes.find((one) => {
      const where = nodeRange(one);
      return (
        one.space.length === 0 &&
        where.start === start &&
        where.end === end &&
        one.kind !== "region"
      );
    });
    rows.push([
      cell(hex(start)),
      cell(sizeText(range.end - range.start)),
      cell(holder === undefined ? "—" : holderText(holder)),
    ]);
    // An empty slot — `SPI_EF6018`'s second is a size of zero — and a range past
    // the end have nothing to outline.
    targets.push(
      end > start && end <= image.size
        ? {
            kind: "range",
            start,
            end,
            name: holder === undefined ? "$BME$" : holderText(holder),
          }
        : undefined
    );
  }
  return {
    title: L("Ranges listed in $BME$"),
    symbol: "list.bullet.rectangle",
    columns: [L("Start"), L("Size"), L("Holds")],
    rows,
    rowTargets: targets,
    linkColumn: 0,
  };
}

/**
 * Where the regions an Insyde map names lie in the file — the whole map on its
 * own row, one region on an entry's.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.build
 */
function withMapRegions(
  detail: NodeDetail,
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): NodeDetail {
  if (node.kind !== "flashDeviceMapStore" && node.kind !== "flashDeviceMapEntry") return detail;
  const store =
    node.kind === "flashDeviceMapStore"
      ? node
      : node.id.length === 0
        ? undefined
        : image.node(node.id.slice(0, -1));
  if (store === undefined) return detail;
  const entries = flashDeviceMapEntries(store, reader).filter(
    (entry) => node.kind === "flashDeviceMapStore" || entry.offset === node.header.start
  );
  if (entries.length === 0) return detail;
  // The image's mapping, or — on an AMD board, whose flash ends in no Volume Top
  // File — the one the map states about itself.
  const addressDiff =
    image.addressDiff ??
    (store.space.length === 0 ? flashDeviceMapAddressDiff(store, reader) : undefined);
  return { ...detail, tables: [...detail.tables, mapRegionsTable(entries, addressDiff, image)] };
}

/**
 * Each entry's region as the firmware addresses it and as the file holds it, with
 * the node that is exactly that range where there is one. With no mapping known,
 * only the address can be given.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.mapRegionsTable
 */
function mapRegionsTable(
  entries: readonly FlashDeviceMapEntry[],
  addressDiff: number | undefined,
  image: UEFIImage
): DetailTable {
  const rows: DetailCell[][] = [];
  const targets: (DetailTableTarget | undefined)[] = [];
  for (const entry of entries) {
    const type = regionTypeName(entry.type) ?? nameOfGuid(entry.type) ?? guidText(entry.type);
    const placed =
      addressDiff === undefined ? undefined : flashDeviceMapEntryRange(entry, addressDiff);
    const holder =
      placed === undefined
        ? undefined
        : image.allNodes.find((one) => {
            const where = nodeRange(one);
            return (
              one.space.length === 0 &&
              where.start === placed.start &&
              where.end === placed.end &&
              one.kind !== "region"
            );
          });
    rows.push([
      cell(type),
      cell(hex(entry.address)),
      cell(placed === undefined ? "—" : hex(placed.start)),
      cell(sizeText(entry.size)),
      cell(holder === undefined ? "—" : holderText(holder)),
    ]);
    // Only what lies in the file can be shown in it.
    targets.push(
      placed !== undefined && placed.end > placed.start && placed.end <= image.size
        ? { kind: "range", start: placed.start, end: placed.end, name: type }
        : undefined
    );
  }
  // A click on a region outlines its bytes in the dump: the way to see where a
  // region the tree does not cut out lies.
  // help: panel.uefi.map-regions
  return {
    title: L("Regions of the flash device map"),
    symbol: "list.bullet.rectangle",
    columns: [L("Type"), L("Address"), L("Start"), L("Size"), L("Holds")],
    rows,
    rowTargets: targets,
    linkColumn: 2,
  };
}

/**
 * A volume's name is its file system, which alone does not say it is one;
 * anything else is named by what it is.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.holderText
 */
function holderText(node: UEFINode): string {
  if (node.kind === "volume") return `${kindLabel("volume")} ${node.name}`;
  return node.name.length === 0 ? kindLabel(node.kind) : node.name;
}

/**
 * Microsoft's compiler version, and the Visual Studio it shipped with.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.compilerText
 */
function compilerText(version: number): string {
  const product = visualStudioOf(version);
  return product === undefined ? `MSC ${version}` : `MSC ${version} (${product})`;
}

function visualStudioOf(version: number): string | undefined {
  switch (version) {
    case 1400:
      return "Visual Studio 2005";
    case 1500:
      return "Visual Studio 2008";
    case 1600:
      return "Visual Studio 2010";
    case 1700:
      return "Visual Studio 2012";
    case 1800:
      return "Visual Studio 2013";
    case 1900:
      return "Visual Studio 2015";
  }
  if (version >= 1910 && version <= 1916) return "Visual Studio 2017";
  if (version >= 1920 && version <= 1929) return "Visual Studio 2019";
  if (version >= 1930 && version <= 1949) return "Visual Studio 2022";
  return undefined;
}

/**
 * A variable's entry: whose copy it is where the tree calls it Invalid, and every
 * copy the store keeps of it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.build
 */
function withVariableHistory(
  detail: NodeDetail,
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader
): NodeDetail {
  if (
    (node.kind !== "vssEntry" && node.kind !== "nvarEntry" && node.kind !== "dvarEntry") ||
    node.id.length === 0
  ) {
    return detail;
  }
  const store = image.node(node.id.slice(0, -1));
  if (store === undefined) return detail;
  const history = variableHistoryOf(node, store, reader);
  const variable = history ?? variableOf(node, store, reader);
  // A Dell variable is a number, and only its namespace says whose.
  const variableText =
    variable === undefined
      ? undefined
      : node.kind === "dvarEntry" && variable.guid !== undefined
        ? `${guidText(variable.guid)} · ${variable.name}`
        : variable.name;
  let fields =
    variable !== undefined && variableText !== undefined && variable.name !== node.name
      ? [...detail.fields, field(L("Variable"), variableText)]
      : detail.fields;
  if (node.kind === "dvarEntry" && variable?.guid !== undefined) {
    const setting = image.dvarSettings?.settingIn(variable.guid, variable.name);
    if (setting !== undefined) {
      fields = [...fields, ...settingFields(setting, reader.bytes(node.body) ?? new Uint8Array(0))];
    }
  }
  if (history === undefined) return { ...detail, fields };
  return { ...detail, fields, tables: [historyTable(history, node.id, reader), ...detail.tables] };
}

/**
 * The most copies the table lists. A variable written on every boot keeps
 * hundreds; the latest are the ones worth reading.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.historyRows
 */
export const HISTORY_ROWS = 40;

/**
 * Every copy the store keeps of the variable, oldest first: where it is, what it
 * is now, how long its value is, and what it changed against the copy before. The
 * entry in focus is marked. Past `HISTORY_ROWS` the earliest copies are left out,
 * except the one in focus.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.historyTable
 */
function historyTable(
  history: NvramVariableHistory,
  focus: readonly number[],
  reader: ImageReader
): DetailTable {
  const versions = history.versions;
  const firstShown = Math.max(0, versions.length - HISTORY_ROWS);
  const isFocus = (version: NvramVariableVersion) =>
    version.entry.length === focus.length && version.entry.every((part, at) => part === focus[at]);
  const rows: DetailCell[][] = [];
  const targets: (DetailTableTarget | undefined)[] = [];
  if (firstShown > 0) {
    const focused = versions.findIndex(isFocus);
    if (focused >= 0 && focused < firstShown) {
      rows.push(historyRow(versions, focused, isFocus, reader));
      targets.push(nodeTarget(versions[focused]?.entry));
    }
    rows.push([
      cell("…"),
      cell(L("%1$@ earlier copies not shown", firstShown)),
      cell(""),
      cell(""),
      cell(""),
    ]);
    targets.push(undefined);
  }
  for (let index = firstShown; index < versions.length; index++) {
    rows.push(historyRow(versions, index, isFocus, reader));
    targets.push(nodeTarget(versions[index]?.entry));
  }
  // A click on a copy puts it in focus: its detail, and its bytes in the dump — the
  // way to a copy the tree leaves out.
  // help: panel.uefi.variable-history
  return {
    title: L("Variable history"),
    symbol: "clock.arrow.circlepath",
    columns: [
      L("Copy", { context: "variable" }),
      L("Address", { context: "variable" }),
      L("State"),
      L("Size"),
      L("Change"),
    ],
    rows,
    rowTargets: targets,
    linkColumn: 1,
  };
}

/** A click on the row puts the node in focus, where there is one. */
const nodeTarget = (path: readonly number[] | undefined): DetailTableTarget | undefined =>
  path === undefined ? undefined : { kind: "node", path };

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.historyRow */
function historyRow(
  versions: readonly NvramVariableVersion[],
  index: number,
  isFocus: (version: NvramVariableVersion) => boolean,
  reader: ImageReader
): DetailCell[] {
  const version = versions[index] as NvramVariableVersion;
  const number = `${index + 1}`;
  const state =
    version.state === "current"
      ? L("Current")
      : version.state === "superseded"
        ? L("Superseded")
        : L("Deleted", { context: "variable" });
  const previous = versions[index - 1];
  const change = previous === undefined ? undefined : variableChange(previous, version, reader);
  return [
    cell(isFocus(version) ? `▸ ${number}` : number),
    cell(hex(version.offset)),
    cell(state),
    cell(`${version.value.end - version.value.start}`),
    cell(change === undefined ? "—" : changeText(change)),
  ];
}

/**
 * What a copy changed: its size, if that moved, and where its bytes differ —
 * offsets into the value, the first few runs of them.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.changeText
 */
function changeText(change: NvramVariableChange): string {
  if (isNoChange(change)) return L("No change");
  const parts: string[] = [];
  if (change.oldSize !== change.newSize) {
    parts.push(L("size %1$@ → %2$@", change.oldSize, change.newSize));
  }
  if (change.changed.length > 0) {
    const runs = change.changed
      .slice(0, 4)
      .map((run) =>
        run.end - run.start === 1 ? `+${hex(run.start)}` : `+${hex(run.start)}–${hex(run.end - 1)}`
      );
    if (change.changed.length > 4) runs.push("…");
    parts.push(L("changed bytes: %1$@, at %2$@", changedBytes(change), runs.join(", ")));
  }
  return parts.join("; ");
}

/**
 * A raw section (type `0x19`): the only kind whose bytes are a text block
 * rather than code that happens to contain the words.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.isRawSection
 */
function isRawSection(node: UEFINode): boolean {
  return node.kind === "section" && node.subtype === 0x19;
}

function buildDetailRows(
  node: UEFINode,
  image: UEFIImage,
  reader: ImageReader,
  repairs: readonly ChecksumRepair[]
): NodeDetail {
  const fields = [
    ...commonFields(node, image),
    ...headerFields(
      node,
      reader,
      repairs,
      node.kind === "file" ? volumeErasePolarityOf(node, image, reader) : undefined
    ),
  ];
  if (node.kind === "ecImage") fields.push(...ecImageFields(node, image, reader));
  const valueTables: DetailTable[] = [];
  if (node.kind === "vssEntry") {
    const variable = readVssEntryIn(node, image, reader);
    if (variable !== undefined) {
      fields.push(...vssFields(variable, reader));
      // The value, read as its type — by the name the entry carries, so a superseded
      // copy reads as the variable it was.
      const bytes = reader.bytes(variable.data);
      if (bytes !== undefined) {
        const value = readNvramValue(
          decodedVssName(variable, reader) ?? "",
          variable.vendorGuid,
          variable.attributes,
          bytes
        );
        fields.push(...nvramValueFields(value, bytes));
        const signatures = nvramSignaturesTable(value);
        if (signatures !== undefined) valueTables.push(signatures);
      }
    }
  }
  // An NVAR entry's body is its value; a link's is one a later entry replaced, and it
  // reads as what it was.
  if (node.kind === "nvarEntry" && node.name.length > 0) {
    const bytes = reader.bytes(node.body);
    if (bytes !== undefined) {
      const value = readNvramValue(node.name, node.guid, nvarValueAttributes(node, reader), bytes);
      fields.push(...nvramValueFields(value, bytes));
      const signatures = nvramSignaturesTable(value);
      if (signatures !== undefined) valueTables.push(signatures);
    }
  }
  const topSwap = uefiTopSwapDetail(node, image);
  if (topSwap !== undefined) fields.push(field(L("Top Swap"), topSwap));
  const fill = nvramStoreFillOf(node, reader);
  if (fill !== undefined) fields.push(...fillFields(fill));
  const title = node.name.length === 0 ? kindLabel(node.kind) : node.name;

  // Every range that shares a byte with the node, once something has read them.
  const protectedBy =
    image.protectedRanges === undefined
      ? []
      : rangesTouchingNode(image.protectedRanges, node, image);
  const protection: { fields: DetailField[]; tables: DetailTable[] } =
    protectedBy.length === 0
      ? { fields: [], tables: [] }
      : {
          fields: [field(L("Protection"), protectionCaveat())],
          tables: [protectedByTable(protectedBy)],
        };
  fields.push(...protection.fields);
  const tables: DetailTable[] = [...valueTables, ...protection.tables];
  const cell = (text: string): DetailCell => ({ text, tone: "plain" });

  // An update for more than one processor lists the others in a table of its
  // own, which reads as the grid it is.
  if (node.kind === "microcode") {
    const extended = readMicrocodeHeader(node.header.start, reader)?.extendedTable;
    if (extended === undefined || extended.signatures.length === 0) {
      return { title, fields, tables };
    }
    return {
      title,
      fields,
      tables: [
        ...tables,
        {
          title: L("Extended signatures"),
          symbol: "cpu",
          columns: [L("CPUID"), L("Processor"), L("Platforms"), L("Checksum")],
          rows: extended.signatures.map((signature) => [
            cell(microcodeCpuid(signature.processorSignature)),
            cell(microcodeProcessorText(signature.processorSignature)),
            cell(microcodePlatformsText(signature.platformIDs)),
            cell(hex(signature.checksum)),
          ]),
        },
      ],
    };
  }

  // The node's own bytes, where they are short enough to be searched: a body
  // longer than the bound is not read at all.
  const bodyBytes =
    node.body.end - node.body.start <= searchLimit ? reader.bytes(node.body) : undefined;

  // The BIOS ID string, taken apart where it follows Intel's layout.
  if (bodyBytes !== undefined && isRawSection(node)) {
    const id = readBIOSIdentifier(bodyBytes);
    if (id !== undefined) {
      const rows: DetailCell[][] = [[cell(L("BIOS ID")), cell(id.text)]];
      for (const [label, value] of [
        [L("Board"), id.board],
        [L("OEM"), id.oem],
        [L("Major version"), id.majorVersion],
        [L("Minor version"), id.minorVersion],
        [L("Build date"), id.buildDate],
      ] as const) {
        if (value !== undefined) rows.push([cell(label), cell(value)]);
      }
      tables.push({
        title: L("BIOS ID"),
        symbol: "number",
        columns: [L("Field"), L("Value")],
        rows,
      });
    }
  }

  // The text block Apple's firmware carries about its own build, whether it is
  // a file of its own or left in the padding the BIOS region opens with.
  if (bodyBytes !== undefined && (isRawSection(node) || node.kind === "padding")) {
    const info = readAppleROMInformation(bodyBytes);
    if (info !== undefined) {
      tables.push({
        title: L("Apple ROM information"),
        symbol: "info.circle",
        columns: [L("Field"), L("Value")],
        rows: info.entries.map((entry) => [cell(entry.key), cell(entry.value)]),
      });
    }
  }

  // A descriptor says more about itself than a header's worth of fields, and
  // four of the things it says are grids.
  if (node.kind !== "flashDescriptor") return { title, fields, tables };
  const descriptor = readDescriptorInfo(node.header.start, reader);
  if (descriptor === undefined) return { title, fields, tables };
  return {
    title,
    fields: [...fields, ...descriptorFields(descriptor, image.size)],
    tables: [...tables, ...descriptorTables(descriptor, image.size)],
  };
}

// MARK: - Protected ranges

/**
 * What the image cannot say: the Boot Guard profile is in the PCH's fuses, not
 * in the BIOS region.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.protectionCaveat
 */
export const protectionCaveat = (): string =>
  L(
    "Whether Boot Guard is enforced is set in the chipset's fuses, not in this image: the marks say what an edit would break if it is. Vendor hashes are checked by the firmware itself."
  );

/**
 * Every range that shares a byte with the node: what it is, where it is, where
 * the list naming it is, and what hashing it found.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.protectedByTable
 */
function protectedByTable(ranges: readonly ProtectedRange[]): DetailTable {
  return {
    title: L("Protected by"),
    symbol: "lock.shield",
    columns: [L("Range"), L("Kind"), L("Listed at"), L("Hash")],
    rows: ranges.map((range) => [
      {
        text:
          range.range === undefined
            ? L("Not placed")
            : `${hex(range.range.start)}–${hex(range.range.end)}`,
        tone: "plain" as const,
      },
      { text: protectedRangeKindName(range.kind), tone: "plain" as const },
      { text: hex(range.source.start), tone: "plain" as const },
      verdictCell(range),
    ]),
  };
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.verdictCell */
function verdictCell(range: ProtectedRange): DetailCell {
  const algorithms = range.digests.map((one) => tcgHashName(one.algorithm)).join(", ");
  switch (range.verdict.kind) {
    case "matches":
      return { text: L("%1$@ matches", algorithms), tone: "yes" };
    case "mismatch":
      // An IBB mismatch is not a verdict yet.
      return {
        text: isIbbKind(range.kind)
          ? L("%1$@ differs (unconfirmed)", algorithms)
          : L("%1$@ differs", algorithms),
        tone: "no",
      };
    case "unsupported":
      return { text: L("%1$@ not computed", tcgHashName(range.verdict.algorithm)), tone: "plain" };
    case "unchecked":
      return { text: L("Not checked"), tone: "plain" };
  }
}

// MARK: - The fields every node has

function commonFields(node: UEFINode, image: UEFIImage): DetailField[] {
  const fields: DetailField[] = [field(L("Kind"), kindLabel(node.kind))];
  if (node.subtype !== undefined) fields.push(field(L("Type"), typeText(node)));
  if (node.guid !== undefined) fields.push(field("GUID", guidDetailText(node.guid)));
  // Inside a compressed section the ranges below are offsets into what it
  // decompresses to, and this says which section that is.
  const outermost = outermostSection(node.space);
  if (outermost !== undefined) {
    const found = image.innermostNodeContaining(outermost);
    const section =
      found !== undefined && found.header.start === outermost
        ? found.name
        : L("Compressed section");
    let text = L("%1$@ at %2$@", section, hex(outermost));
    if (node.space.length > 1) {
      text = L("%1$@, %2$@ compressed sections deep", text, node.space.length);
    }
    fields.push(field(L("Decompressed from"), text));
  }
  fields.push(field(L("Header"), rangeText(node.header)));
  fields.push(field(L("Body"), rangeText(node.body)));
  if (node.tail.end > node.tail.start) fields.push(field(L("Tail"), rangeText(node.tail)));
  const range = nodeRange(node);
  fields.push(field(L("Total"), rangeText(range)));

  const flags: string[] = [];
  if (node.isFixed) flags.push("fixed");
  if (isNodeCompressed(node)) flags.push("compressed");
  if (node.isErased) flags.push("erased");
  if (flags.length > 0) fields.push(field(L("Flags"), flags.join(", ")));

  // A compressed node's address means nothing — the decompressor puts it
  // wherever it likes — so the one thing worth showing is skipped there.
  if (!isNodeCompressed(node)) {
    const address = image.addressForOffset(range.start);
    if (address !== undefined) fields.push(field(L("Address"), hex(address)));
  }
  return fields;
}

// MARK: - What the node's header adds

function headerFields(
  node: UEFINode,
  reader: ImageReader,
  repairs: readonly ChecksumRepair[],
  volumeErasePolarity: boolean | undefined
): DetailField[] {
  const h = node.header.start;
  const fields: DetailField[] = [];
  const add = (label: string, value: number | undefined, text: (value: number) => string) => {
    if (value !== undefined) fields.push(field(label, text(value)));
  };

  switch (node.kind) {
    case "volume": {
      add("Length", reader.uint64(h + 0x20), sizeText);
      add("Signature", reader.uint32(h + 0x28), hex);
      add("Attributes", reader.uint32(h + 0x2c), (value) =>
        bits(value, [[0x0000_0800, "Erase polarity"]])
      );
      add("Header length", reader.uint16(h + 0x30), sizeText);
      const checksum = reader.uint16(h + 0x32);
      if (checksum !== undefined) {
        fields.push(checksumRow(L("Checksum"), checksum, 4, repairs, h + 0x32));
      }
      add("Ext. header", reader.uint16(h + 0x34), hex);
      add(L("Revision"), reader.uint8(h + 0x37), (value) => `${value}`);
      break;
    }

    case "file": {
      // The name GUID is the common "GUID" field and the type the common "Type"
      // field; what the header adds is the rest.
      add("Attributes", reader.uint8(h + 0x13), (value) =>
        bits(value, [
          [0x01, "Tail / large"],
          [0x04, "Fixed"],
          [0x40, L("Checksum")],
        ])
      );
      // A large file keeps its size in a 64-bit field after the base header and
      // leaves the three-byte one at zero.
      const size = reader.uint24(h + 0x14);
      if (size !== undefined && size !== 0) fields.push(field(L("Size"), sizeText(size)));
      else add(L("Size"), reader.uint64(h + 0x18), sizeText);
      // A state that marks the header invalid says so, and the sums are shown
      // unchecked rather than valid: the file owes none (§5.5).
      const state = reader.uint8(h + 0x17);
      const markedInvalid = state !== undefined && marksHeaderInvalid(state, volumeErasePolarity);
      if (state !== undefined) {
        const text = bits(state, [[0x80, "Erase polarity"]]);
        fields.push(
          markedInvalid
            ? tonedField("State", L("%1$@ — header marked invalid", text), "caution")
            : field("State", text)
        );
      }
      const headerChecksum = reader.uint8(h + 0x10);
      if (headerChecksum !== undefined) {
        fields.push(
          markedInvalid
            ? field("Header checksum", L("%1$@ (not checked)", hex(headerChecksum)))
            : checksumRow("Header checksum", headerChecksum, 2, repairs, h + 0x10)
        );
      }
      const bodyChecksum = reader.uint8(h + 0x11);
      if (bodyChecksum !== undefined) {
        fields.push(
          markedInvalid
            ? field("Body checksum", L("%1$@ (not checked)", hex(bodyChecksum)))
            : checksumRow("Body checksum", bodyChecksum, 2, repairs, h + 0x11)
        );
      }
      break;
    }

    case "section": {
      // An extended-size section leaves the three-byte field at the marker and
      // keeps the real size in 32 bits.
      const size = reader.uint24(h);
      if (size === 0xff_ffff) add(L("Size"), reader.uint32(h + 0x04), sizeText);
      else add(L("Size"), size, sizeText);
      break;
    }

    case "microcode": {
      // The header type and the loader revision are constants of a valid Intel
      // microcode, read straight off the bytes. The rest is the reading the FIT
      // panel gives the microcode an entry points at (`microcodeFields`), so the
      // two say it in the same words — with the checksum's verdict this panel's
      // own: the repairs.
      add("Header type", reader.uint32(h), hex);
      const header = readMicrocodeHeader(h, reader);
      if (header !== undefined) {
        add("Loader revision", reader.uint32(h + 0x14), hex);
        const repair = repairs.find((one) => one.offset === h + 0x10);
        fields.push(
          // The engine's own field carries a flag; the detail carries a tone.
          ...microcodeFields(
            header,
            repair === undefined,
            repair === undefined ? undefined : littleEndian(repair.bytes)
          ).map((one) => field(one.label, one.value, one.isProblem))
        );
      }
      break;
    }

    // A header with nothing to check it by: what it says, and the CPUID spelled out
    // the way AMD's patch files are named.
    case "amdMicrocode": {
      const patch = readAMDMicrocode(h, node.body.end, reader);
      if (patch === undefined) break;
      fields.push(field("Date", amdMicrocodeDate(patch)));
      fields.push(
        field(
          "CPUID",
          amdCpuID(patch.processorSignature).toString(16).toUpperCase().padStart(8, "0")
        )
      );
      fields.push(field("Processor signature", hex(patch.processorSignature)));
      fields.push(field("Revision", hex(patch.updateRevision)));
      fields.push(field("Loader ID", hex(patch.loaderID)));
      if (patch.northBridgeVendor !== 0 || patch.northBridgeDevice !== 0) {
        fields.push(
          field("North bridge", `${hex(patch.northBridgeVendor)}:${hex(patch.northBridgeDevice)}`)
        );
      }
      if (patch.southBridgeVendor !== 0 || patch.southBridgeDevice !== 0) {
        fields.push(
          field("South bridge", `${hex(patch.southBridgeVendor)}:${hex(patch.southBridgeDevice)}`)
        );
      }
      fields.push(field("BIOS API revision", hex(patch.biosAPIRevision)));
      fields.push(field("Load control", hex(patch.loadControl)));
      break;
    }

    case "capsule":
      add("Header size", reader.uint32(h + 0x10), sizeText);
      add(L("Flags"), reader.uint32(h + 0x14), hex);
      add("Image size", reader.uint32(h + 0x18), sizeText);
      break;

    case "intelImage": {
      // The image node is the whole file, and its bytes open with the descriptor
      // whose map says how many chips, regions, masters and straps the board
      // has. The first three are stored minus one; the two strap counts are not.
      const map0 = reader.uint32(h + 0x14);
      if (map0 !== undefined) {
        fields.push(field("Flash chips", `${((map0 >>> 8) & 0x3) + 1}`));
        fields.push(field("Regions", `${((map0 >>> 24) & 0x7) + 1}`));
      }
      const map1 = reader.uint32(h + 0x18);
      if (map1 !== undefined) {
        fields.push(field("Masters", `${((map1 >>> 8) & 0x3) + 1}`));
        fields.push(field("PCH straps", `${(map1 >>> 24) & 0xff}`));
      }
      add("PROC straps", reader.uint32(h + 0x1c), (map2) => `${(map2 >>> 8) & 0xff}`);
      break;
    }

    case "flashDescriptor":
      add("Signature", reader.uint32(h + 0x10), hex);
      add("FLMAP", reader.uint32(h + 0x14), hex);
      add(L("Version"), reader.uint32(h + 0x20), hex);
      break;

    case "region": {
      // The descriptor's table keeps base and limit in 4 KiB units.
      const range = nodeRange(node);
      fields.push(field("Base (4 KiB)", hex(Math.floor(range.start / 0x1000))));
      if (range.end > 0) {
        fields.push(field("Limit (4 KiB)", hex(Math.floor((range.end - 1) / 0x1000))));
      }
      break;
    }

    case "vssStore":
      add("Format", reader.uint8(h + 8), hex);
      add("State", reader.uint8(h + 9), hex);
      add("Reserved", reader.uint16(h + 10), hex);
      add("Reserved1", reader.uint32(h + 12), hex);
      break;

    case "vss2Store":
      // The same four fields, after the 16-byte store GUID and size.
      add("Format", reader.uint8(h + 20), hex);
      add("State", reader.uint8(h + 21), hex);
      add("Reserved", reader.uint16(h + 22), hex);
      add("Reserved1", reader.uint32(h + 24), hex);
      break;

    case "ftwStore":
      add("State", reader.uint8(h + 20), hex);
      add("Header CRC32", reader.uint32(h + 16), hex);
      break;

    case "sysFStore": {
      add(L("Unknown"), reader.uint8(h + 4), hex);
      add("Unknown1", reader.uint32(h + 5), hex);
      // The store's CRC32 is its final four bytes, over everything before them.
      const end = nodeRange(node).end;
      if (end >= h + 4) {
        const stored = reader.uint32(end - 4);
        const bytes = reader.bytesAt(h, end - 4 - h);
        if (stored !== undefined && bytes !== undefined) {
          const computed = crc32(bytes);
          fields.push(
            field(
              "CRC32",
              checksumText({
                value: stored,
                valid: computed === stored,
                expected: computed,
                digits: 8,
              })
            )
          );
        }
      }
      break;
    }

    case "flashDeviceMapStore": {
      // `INSYDE_FLASH_DEVICE_MAP_HEADER`.
      add(L("Size"), reader.uint32(h + 4), sizeText);
      add("Data offset", reader.uint32(h + 8), hex);
      add("Entry size", reader.uint32(h + 12), sizeText);
      add("Entry format", reader.uint8(h + 16), hex);
      add(L("Revision"), reader.uint8(h + 17), hex);
      add(L("Extensions"), reader.uint8(h + 18), (value) => `${value}`);
      const stored = reader.uint8(h + 19);
      const header = reader.bytes({ start: h, end: h + 0x1c });
      if (stored !== undefined && header !== undefined) {
        const expected = (0x100 - ((sum8(header) - stored) & 0xff)) & 0xff;
        fields.push(
          field(
            L("Checksum"),
            expected === stored
              ? `${hex(stored)}, valid`
              : `${hex(stored)}, should be ${hex(expected)}`
          )
        );
      }
      add("Flash device base address", reader.uint64(h + 20), hex);
      break;
    }

    case "flashDeviceMapEntry": {
      // The region type GUID is the common "GUID" field.
      const regionId = reader.bytes({ start: h + 16, end: h + 32 });
      if (regionId !== undefined) fields.push(field("Region ID", hexBytes(regionId)));
      add("Region offset", reader.uint64(h + 32), hex);
      add("Region size", reader.uint64(h + 40), hex);
      const attributes = reader.uint32(h + 48);
      if (attributes !== undefined) {
        const words: string[] = [];
        if ((attributes & 0x1) !== 0) words.push("modifiable");
        if ((attributes & 0x2) !== 0) words.push("ignored");
        fields.push(
          field(
            "Attributes",
            words.length === 0 ? hex(attributes) : `${hex(attributes)} (${words.join(", ")})`
          )
        );
      }
      const hash = reader.bytes({ start: h + 52, end: h + 84 });
      if (hash !== undefined) fields.push(field(L("Hash"), hexBytes(hash)));
      break;
    }

    case "flashMapStore":
      add("Entries", reader.uint16(h + 10), (value) => `${value}`);
      add("Reserved", reader.uint32(h + 12), hex);
      break;

    case "flashMapEntry":
      add("Data type", reader.uint16(h + 16), hex);
      add("Entry type", reader.uint16(h + 18), hex);
      add(L("Size"), reader.uint32(h + 28), sizeText);
      add("Offset", reader.uint32(h + 32), hex);
      add("Physical address", reader.uint64(h + 20), hex);
      break;

    case "evsaStore": {
      add("Attributes", reader.uint32(h + 8), hex);
      add("Reserved", reader.uint32(h + 16), hex);
      const checksum = evsaChecksum(h + 1, node.header.end, reader);
      if (checksum !== undefined) fields.push(field(L("Checksum"), checksumText(checksum)));
      break;
    }

    case "vssEntry":
      // Read in `buildDetailRows`, which knows the store and so the header's form.
      break;

    case "evsaEntry": {
      // What the header adds depends on the entry's kind.
      switch (node.subtype) {
        case Sub.guidEvsaEntry:
          add("GuidId", reader.uint16(h + 4), hex);
          break;
        case Sub.nameEvsaEntry:
          add("VarId", reader.uint16(h + 4), hex);
          break;
        default:
          add("VarId", reader.uint16(h + 6), hex);
          add("GuidId", reader.uint16(h + 4), hex);
          add("Attributes", reader.uint32(h + 8), (value) => bits(value, EVSA_ATTRIBUTE_BITS));
      }
      const checksum = evsaChecksum(h + 1, nodeRange(node).end, reader);
      if (checksum !== undefined) fields.push(field(L("Checksum"), checksumText(checksum)));
      break;
    }

    case "nvarEntry":
      fields.push(...nvarFields(node, reader));
      break;

    // Every DVAR field is stored as its complement; these are the values.
    case "dvarStore": {
      const flags = reader.uint8(h + 8);
      if (flags !== undefined) fields.push(field("Store flags", hex(0xff - flags)));
      break;
    }

    case "dvarEntry":
      fields.push(...dvarFields(node, reader));
      break;

    case "nvarGuidStore":
      fields.push(
        field("GUIDs", `${Math.floor((node.body.end - node.body.start) / NVAR.guidSize)}`)
      );
      break;

    case "slicData":
      switch (node.subtype) {
        case Sub.pubkeySlicData:
          add("Key type", reader.uint8(h + 8), hex);
          add(L("Version"), reader.uint8(h + 9), hex);
          add("Algorithm", reader.uint32(h + 12), hex);
          add("Bit length", reader.uint32(h + 20), hex);
          add("Exponent", reader.uint32(h + 24), hex);
          break;
        case Sub.markerSlicData: {
          add(L("Version"), reader.uint32(h + 8), hex);
          const oemId = reader.bytesAt(h + 12, 6);
          if (oemId !== undefined) fields.push(field("OEM ID", asciiText(oemId)));
          const tableId = reader.bytesAt(h + 18, 8);
          if (tableId !== undefined) fields.push(field("OEM table ID", asciiText(tableId)));
          // The parser only accepts the known flag, so its word is the value.
          const flag = reader.uint64Bits(h + 26);
          if (flag !== undefined) {
            fields.push(
              field(
                "Windows flag",
                flag === 0x2053_574f_444e_4957n ? "WINDOWS" : `0x${flag.toString(16).toUpperCase()}`
              )
            );
          }
          add("SLIC version", reader.uint32(h + 34), hex);
          break;
        }
      }
      break;

    // Read as leaves in the reference: nothing to add to the common fields.
    case "fdcStore":
    case "cmdbStore":
    case "sysFEntry":
    case "uefiImage":
    case "freeSpace":
    case "nonUEFIData":
    case "startupApData":
      break;

    // Padding the parser named for the ITE image it opens on lists every image.
    case "padding":
      // With a row per image, the rows say it.
      if (isECFirmwarePadding(node) && !node.children.some((child) => child.kind === "ecImage")) {
        fields.push(...iteFields(node, reader));
      }
      break;

    // A map region has no header: the map says where it is and what type it is,
    // and the type is the common "GUID" field. What the region holds is read
    // where its type is understood.
    case "flashDeviceMapRegion": {
      if (node.guid !== undefined && guidEquals(node.guid, FlashDeviceMap.biosVersionDataTable)) {
        const table = readInsydeBvdt(node.body, reader);
        if (table?.biosVersion !== undefined) {
          fields.push(field("BIOS version", table.biosVersion));
        }
        if (table?.productName !== undefined) {
          fields.push(field("Product name", table.productName));
        }
        if (table?.kernelVersion !== undefined) {
          fields.push(field("Kernel version", table.kernelVersion));
        }
        if (table?.releaseDate !== undefined) {
          fields.push(field("Release date", table.releaseDate));
        }
        if (table?.compilerVersion !== undefined) {
          fields.push(field("Compiler", compilerText(table.compilerVersion)));
        }
        // The board's identity to a capsule update, and the version it would be
        // compared with.
        if (table?.esrtClass !== undefined) {
          fields.push(field("ESRT firmware class", guidText(table.esrtClass)));
        }
        if (table?.esrtVersion !== undefined) {
          fields.push(field("ESRT version", hex(table.esrtVersion)));
        }
      }
      if (
        node.guid !== undefined &&
        guidEquals(node.guid, FlashDeviceMap.ecFirmware) &&
        !node.children.some((child) => child.kind === "ecImage")
      ) {
        fields.push(...iteFields(node, reader));
      }
      break;
    }

    // Read in `buildNodeDetail`, which has the block the image sits in.
    case "ecImage":
      break;

    // Read again: the node keeps only its name.
    case "picture": {
      const picture = readPicture(node.body.start, node.body.end, reader, true);
      if (picture === undefined) break;
      fields.push(
        field(
          L("Format"),
          picture.variant === undefined
            ? pictureFormatName(picture.format)
            : `${pictureFormatName(picture.format)} (${picture.variant})`
        )
      );
      fields.push(field(L("Picture size"), `${picture.width} × ${picture.height}`));
      // An animation says how long it is; the panel plays it.
      if (picture.frames !== undefined && picture.frames > 1) {
        fields.push(field(L("Frames"), `${picture.frames}`));
      }
      // A BMP whose header asks for more than its section holds: the rows past the
      // end are missing from the image.
      if (picture.declaredLength !== undefined) {
        fields.push(
          field(
            L("Declared size"),
            L("%1$@ — the section ends earlier", sizeText(picture.declaredLength)),
            true
          )
        );
      }
      break;
    }

    // Read again, as a picture is.
    case "sound": {
      const sound = readSound(node.body.start, node.body.end, reader);
      if (sound === undefined) break;
      fields.push(field(L("Format"), `WAV (${soundEncodingName(sound)})`));
      fields.push(field(L("Sample rate"), L("%1$@ Hz", `${sound.sampleRate}`)));
      fields.push(field(L("Bits per sample"), `${sound.bitsPerSample}`));
      fields.push(field(L("Channels"), `${sound.channels}`));
      const duration = soundDuration(sound);
      if (duration !== undefined) {
        // Tenths, with the separator the language writes: the translation, not the
        // browser's region, decides it.
        const tenths = Math.round(duration * 10);
        fields.push(
          field(L("Duration"), L("%1$@.%2$@ s", `${Math.floor(tenths / 10)}`, `${tenths % 10}`))
        );
      }
      break;
    }

    // What UEFITool's FIT tab says of the structure, in the header's own words:
    // the fields are Intel's names, and stay in them.
    case "fitComponent": {
      const kind = node.subtype === undefined ? undefined : fitComponentKindOf(node.subtype);
      const header =
        kind === undefined ? undefined : readFITComponentHeader(kind, node.body.start, reader);
      if (header === undefined) break;
      switch (header.kind) {
        case "table":
          fields.push(field("Entries", `${header.rows}`));
          break;
        case "acm":
          fields.push(
            field("Module subtype", acmSubtypeName(header.subtype) ?? hex(header.subtype))
          );
          fields.push(field("Header version", hex(header.headerVersion)));
          fields.push(field("Chipset ID", hex(header.chipsetID)));
          fields.push(field(L("Date"), header.date));
          fields.push(field("ACM SVN", `${header.svn}`));
          break;
        case "keyManifest":
          fields.push(field("Version", hex(header.version)));
          fields.push(field("KM version", hex(header.kmVersion)));
          fields.push(field("KM SVN", `${header.svn}`));
          fields.push(field("KM ID", hex(header.id)));
          break;
        case "bootPolicy":
          fields.push(field("Version", hex(header.version)));
          fields.push(field("BPM revision", `${header.revision}`));
          fields.push(field("BP SVN", `${header.svn}`));
          fields.push(field("ACM SVN", `${header.acmSVN}`));
          break;
      }
      break;
    }
  }
  return fields;
}

/**
 * What an EC image row adds: who made it, what it says it is, how long it is, and
 * which earlier image in the block it copies. Read again from the block the image
 * sits in, since a copy is told by the images before it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.ecImageFields
 */
function ecImageFields(node: UEFINode, image: UEFIImage, reader: ImageReader): DetailField[] {
  const block = node.id.length === 0 ? undefined : image.node(node.id.slice(0, -1));
  if (block === undefined) return [];
  const start = nodeRange(node).start;
  const found = allECImages(block.body, reader).find((one) => one.start === start);
  if (found === undefined) return [];
  const fields: DetailField[] = [];
  if (found.vendor.kind === "ite") {
    fields.push(field(L("Vendor"), "ITE"));
    fields.push(field("ITE identification", found.vendor.identification));
  } else {
    // Microchip's format, which says nothing of whose chip it is: the format is
    // named, the vendor is not.
    fields.push(field(L("Format"), "PHCM (Microchip MEC)"));
  }
  fields.push(field(L("Written"), sizeText(found.written)));
  if (found.copyOf !== undefined) fields.push(field(L("Copy of"), hex(found.copyOf)));
  return fields;
}

/**
 * One row per ITE image in the node: what it says it is, and where it starts.
 * The firmware's own words, so they read as written.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.iteFields
 */
function iteFields(node: UEFINode, reader: ImageReader): DetailField[] {
  return allITEFirmware(nodeRange(node), reader).map((image) =>
    field("ITE identification", `${image.identification} · ${hex(image.start)}`)
  );
}

// MARK: - How full a variable store is

/**
 * The panel's own reading of a store, so it translates: how much of it is
 * written, how much is left, and what its entries still count for.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.fillFields
 */
function fillFields(fill: NvramStoreFill): DetailField[] {
  return [
    field(L("In use"), `${sizeText(fillUsed(fill))} · ${fillPercentUsed(fill)}\u00a0%`),
    field(L("Free space"), sizeText(fill.free)),
    field(L("Current entries"), `${fill.current}`),
    field(L("Superseded entries"), `${fill.superseded}`),
    field(L("Deleted entries"), `${fill.deleted}`),
  ];
}

// MARK: - What a flash descriptor adds

/**
 * The rows a descriptor has beyond its header: the vector it opens with, the
 * chipset its layout is, what the straps say where they are read — the bit that
 * soft-disables the ME, the GPR0 range, the eSPI clock — and what its component
 * section says about the chips —
 * how large, how fast, and which opcodes the chipset will not send them. Where
 * the regions lie, and what the masters may touch, are grids, and are in
 * `descriptorTables`.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.descriptorFields
 */
function descriptorFields(descriptor: DescriptorInfo, imageSize: number): DetailField[] {
  const fields: DetailField[] = [];
  if (descriptor.reservedVector.length > 0) {
    fields.push(field("Reserved vector", hexBytes(descriptor.reservedVector)));
  }
  // Told from the layout, not stated; a layout the rules do not know is read as
  // the nearest one, and says so.
  const series = generationSeries(descriptor.generation);
  const codeName = generationCodeName(descriptor.generation);
  let chipset = series === undefined ? codeName : L("%1$@ (%2$@ series)", codeName, series);
  if (!descriptor.isGenerationCertain) chipset = L("%1$@, assumed", chipset);
  fields.push(field(L("Chipset"), chipset));
  // The one strap bit with a settled meaning. Set, it is the reason an ME that is
  // otherwise whole does not run, so it reads as a state.
  const meDisable = descriptor.straps?.meDisable;
  if (meDisable !== undefined) {
    fields.push(
      tonedField(
        L("%1$@ bit", meDisable.name),
        meDisable.isSet ? L("Set — the ME is soft-disabled") : L("Not set", { context: "bit" }),
        meDisable.isSet ? "caution" : "standard"
      )
    );
  }
  // A range the chipset keeps the host from writing — coreboot puts the ME region
  // under it — is the other reason a region the masks open cannot be written from
  // the OS.
  const gpr0 = descriptor.straps?.gpr0;
  if (gpr0 !== undefined) {
    fields.push(
      tonedField("GPR0", gpr0Text(gpr0), isProtectedRangeOn(gpr0) ? "caution" : "standard")
    );
  }

  if (descriptor.component !== undefined) {
    fields.push(...componentFields(descriptor.component, imageSize));
  }
  const espi = descriptor.straps?.espiClock;
  if (espi !== undefined) {
    fields.push(
      field(
        L("eSPI clock"),
        espi.clock.megahertz === undefined
          ? L("Unknown (code %1$@)", espi.clock.code)
          : L("%1$@ MHz", espi.clock.megahertz.join("/"))
      )
    );
  }
  return fields;
}

/**
 * What the component section says about the chips.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.componentFields
 */
function componentFields(component: DescriptorComponent, imageSize: number): DetailField[] {
  const fields: DetailField[] = [];
  // The chips the image was laid out across, end to end. A dump of another
  // length is one chip of two, or a read of the wrong size.
  const sizes = component.chipSizes
    .map((size) => (size === undefined ? L("Reserved") : capacityText(size)))
    .join(" + ");
  const total = component.chipSizes.reduce<number>((sum, size) => sum + (size ?? 0), 0);
  const mismatch = !component.chipSizes.includes(undefined) && total !== imageSize;
  fields.push(
    field(
      L("Flash chip sizes"),
      mismatch ? L("%1$@ — the dump is %2$@", sizes, capacityText(imageSize)) : sizes,
      mismatch
    )
  );
  const first = component.chipSizes[0];
  if (component.chipSizes.length === 2 && first !== undefined) {
    fields.push(field(L("Second chip starts at"), hex(first)));
  }
  fields.push(field(L("Read ID and status clock"), clockText(component.readIDClock)));
  fields.push(field(L("Write and erase clock"), clockText(component.writeEraseClock)));
  fields.push(
    field(
      L("Fast read clock"),
      component.fastReadClock === undefined ? L("Off") : clockText(component.fastReadClock)
    )
  );
  fields.push(
    field(
      L("Forbidden opcodes"),
      component.invalidInstructions.length === 0
        ? L("None")
        : hexBytes(Uint8Array.from(component.invalidInstructions))
    )
  );
  return fields;
}

/**
 * A protected range as where it runs and what it refuses.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.gpr0Text
 */
function gpr0Text(range: DescriptorProtectedRange): string {
  const span = `${hex(range.start)} – ${hex(range.end)}`;
  if (range.readProtected && range.writeProtected) return L("%1$@: reads and writes refused", span);
  if (range.writeProtected) return L("%1$@: writes refused", span);
  if (range.readProtected) return L("%1$@: reads refused", span);
  return L("Off");
}

/**
 * A clock as the bench says it, or the code when the generation reserves it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.clockText
 */
function clockText(clock: DescriptorClock): string {
  if (clock.megahertz === undefined) return L("Reserved (code %1$@)", clock.code);
  return L("%1$@ MHz", clock.megahertz.join("/"));
}

/**
 * A chip's size in the unit it is sold by.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.capacityText
 */
function capacityText(bytes: number): string {
  if (bytes > 0 && bytes % 0x10_0000 === 0) return L("%1$@ MB", bytes / 0x10_0000);
  if (bytes > 0 && bytes % 0x400 === 0) return L("%1$@ KB", bytes / 0x400);
  return sizeText(bytes);
}

/**
 * The five grids: where each region lies, the masks each master carries, what
 * the BIOS master may do to each region, the flash chips this firmware was built to
 * drive, and the PCH strap words.
 *
 * The regions are in the tree as well, as this node's siblings — but the tree
 * shows where a region *is*, and this shows what the descriptor *says*, which is
 * the thing being checked when the two disagree.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.descriptorTables
 */
function descriptorTables(descriptor: DescriptorInfo, imageSize: number): DetailTable[] {
  const tables: DetailTable[] = [];
  // Its own region is this node.
  const regions = descriptor.regions.filter((region) => region.type !== "descriptor");
  if (regions.length > 0) {
    tables.push({
      title: L("Region table"),
      symbol: "square.split.2x2",
      columns: [L("Region"), L("Base"), L("Limit")],
      rows: regions.map((region) => [
        cell(regionLabel(region.type)),
        cell(hex(region.base)),
        cell(hex(region.limit)),
      ]),
    });
  }
  const mask = (value: number) =>
    `0x${value.toString(16).toUpperCase().padStart(descriptor.maskDigits, "0")}`;
  if (descriptor.masters.length > 0) {
    tables.push({
      title: L("Region access settings"),
      symbol: "key",
      columns: [L("Master"), L("Read"), L("Write")],
      rows: descriptor.masters.map((master) => [
        cell(master.name),
        cell(mask(master.read)),
        cell(mask(master.write)),
      ]),
    });
  }
  if (descriptor.biosAccess.length > 0) {
    tables.push({
      title: L("BIOS access table"),
      symbol: "lock.shield",
      columns: [L("Region"), L("Read"), L("Write")],
      rows: descriptor.biosAccess.map((access) => [
        cell(access.region),
        permission(access.read),
        permission(access.write),
      ]),
    });
  }
  if (descriptor.chips.length > 0) {
    const declared = descriptor.component?.chipSizes ?? [];
    const declaredSizes = declared.filter((one): one is number => one !== undefined);
    const smallest =
      declared.length === 1
        ? imageSize
        : declaredSizes.length > 0
          ? Math.min(...declaredSizes)
          : undefined;
    tables.push({
      title: L("Flash chips in VSCC table"),
      symbol: "cpu",
      columns: [L("JEDEC ID"), L("Chip"), L("Size"), L("Source")],
      rows: descriptor.chips.map((chip) => {
        // With one chip the dump is that chip's, so a smaller chip cannot be
        // the one it came from. With several the split is the descriptor's,
        // and a chip smaller than the smallest of them cannot stand in for
        // any of them.
        const bytes = chip.sizeKB === undefined ? undefined : chip.sizeKB << 10;
        const invalid = bytes !== undefined && smallest !== undefined && bytes < smallest;
        return [
          cell(chip.jedecId.toString(16).toUpperCase().padStart(6, "0")),
          cell(
            chip.name ??
              (chip.vendor === undefined ? L("Unknown") : L("Unknown (%1$@)", chip.vendor))
          ),
          { text: bytes === undefined ? "" : capacityText(bytes), tone: invalid ? "no" : "plain" },
          // Names of the projects the table was read from, as they call
          // themselves, in every language.
          cell(chip.source === undefined ? "" : SOURCE_NAMES[chip.source]),
        ];
      }),
    });
  }
  const straps = descriptor.straps;
  if (straps !== undefined) {
    // Numbers, not fields: the layout is the chipset's and next to none of it is
    // published (`UEFI_IMAGE_FORMAT.md` §2.6). Each row outlines its four bytes in the
    // dump, which is where two boards' straps are compared.
    const rows: DetailCell[][] = [];
    const targets: DetailTableTarget[] = [];
    straps.words.forEach((word, index) => {
      const name = `PCHSTRP${index}`;
      const address = straps.base + index * 4;
      let meaning = L("Unknown");
      if (straps.meDisable !== undefined && straps.meDisable.word === index) {
        meaning = L(
          "%1$@ in bit %2$@; the other bits unknown",
          straps.meDisable.name,
          `${straps.meDisable.bit}`
        );
      } else if (straps.espiClock?.word === index) {
        meaning = L("eSPI clock in bits 3–5; the other bits unknown");
      } else if (straps.gpr0?.word === index) {
        meaning = L("GPR0, the whole word");
      }
      rows.push([
        cell(name),
        cell(hex(address)),
        cell(`0x${word.toString(16).toUpperCase().padStart(8, "0")}`),
        cell(meaning),
      ]);
      targets.push({ kind: "range", start: address, end: address + 4, name });
    });
    tables.push({
      title: L("PCH straps"),
      symbol: "slider.horizontal.3",
      columns: [L("Strap"), L("Offset"), L("Value"), L("Meaning")],
      rows,
      rowTargets: targets,
      linkColumn: 1,
      // Seventy words and more, of which the fields above have already said what is
      // known: folded, it leaves the rest of the detail in view.
      startsFolded: true,
    });
  }
  return tables;
}

/** The project that named a VSCC chip, as it calls itself. */
const SOURCE_NAMES: Readonly<Record<DescriptorChipSource, string>> = {
  uefiTool: "UEFITool",
  linux: "Linux",
  flashrom: "flashrom",
};

// MARK: - NVRAM helpers

/** The VSS variable attribute bits, in the reference parser's words. */
const NVRAM_ATTRIBUTE_BITS: readonly (readonly [number, string])[] = [
  [0x0000_0001, "NonVolatile"],
  [0x0000_0002, "BootService"],
  [0x0000_0004, "Runtime"],
  [0x0000_0008, "HwErrorRecord"],
  [0x0000_0010, "AuthWrite"],
  [0x0000_0020, "TimeBasedAuthWrite"],
  [0x0000_0040, "AppendWrite"],
  [0x8000_0000, "AppleChecksum"],
];

/**
 * What an NVAR entry's header and extended header say (§9). The GUID is the
 * common "GUID" field — the parser found it, in the entry or in the store's
 * table, or took it from the chain for a later link.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.nvarFields
 */
function nvarFields(node: UEFINode, reader: ImageReader): DetailField[] {
  const h = node.header.start;
  const fields: DetailField[] = [];
  const attributes = reader.uint8(h + 9);
  if (attributes === undefined) return fields;
  fields.push(field("Attributes", bits(attributes, NVAR_ATTRIBUTE_BITS)));
  // `next` is relative to the entry; the row says where it lands.
  const next = reader.uint24(h + 6);
  if (next !== undefined && next !== NVAR.noNext) fields.push(field("Next entry", hex(h + next)));
  // An entry that names its GUID by index carries the index right after the
  // header — on a valid entry that is not a later link.
  if (
    (attributes & NVAR.valid) !== 0 &&
    (attributes & NVAR.dataOnly) === 0 &&
    (attributes & NVAR.localGuid) === 0
  ) {
    const index = reader.uint8(h + NVAR.headerSize);
    if (index !== undefined) fields.push(field("GUID index", `${index}`));
  }

  // The extended header is the entry's tail: its attributes first, then a
  // timestamp and a hash when the variable is time-authenticated, and the
  // checksum and the header's own size last.
  const tail = node.tail;
  const tailSize = tail.end - tail.start;
  const extended = tailSize >= NVAR.extendedHeaderMinimum ? reader.uint8(tail.start) : undefined;
  if (extended === undefined) return fields;
  fields.push(field("Extended attributes", bits(extended, NVAR_EXTENDED_ATTRIBUTE_BITS)));
  if ((extended & NVAR.extendedTimeBased) !== 0 && tailSize >= 1 + NVAR.timestampSize + 2) {
    const timestamp = reader.uint64(tail.start + 1);
    if (timestamp !== undefined) {
      fields.push(field("Timestamp", hex(timestamp)));
      const hashEnd = 1 + NVAR.timestampSize + NVAR.hashSize + 2;
      if ((attributes & NVAR.dataOnly) === 0 && tailSize >= hashEnd) {
        const hash = reader.bytesAt(tail.start + 1 + NVAR.timestampSize, NVAR.hashSize);
        if (hash !== undefined) {
          fields.push(
            field(
              "Hash",
              [...hash].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("")
            )
          );
        }
      }
    }
  }
  const checksum = nvarChecksumOf(node, reader);
  if (checksum !== undefined) {
    fields.push(
      field(
        L("Checksum"),
        checksumText({
          value: checksum.stored,
          valid: checksum.valid,
          expected: checksum.expected,
        })
      )
    );
  }
  return fields;
}

/** The NVAR attribute bits, in the reference parser's words. */
const NVAR_ATTRIBUTE_BITS: readonly (readonly [number, string])[] = [
  [NVAR.runtime, "Runtime"],
  [NVAR.asciiName, "AsciiName"],
  [NVAR.localGuid, "Guid"],
  [NVAR.dataOnly, "DataOnly"],
  [NVAR.extendedHeader, "ExtHeader"],
  [NVAR.hwErrorRecord, "HwErrorRecord"],
  [NVAR.authWrite, "AuthWrite"],
  [NVAR.valid, "Valid"],
];

/** The NVAR extended attribute bits; the others are unknown. */
const NVAR_EXTENDED_ATTRIBUTE_BITS: readonly (readonly [number, string])[] = [
  [NVAR.extendedChecksum, "Checksum"],
  [NVAR.extendedAuthWrite, "AuthWrite"],
  [NVAR.extendedTimeBased, "TimeBasedAuthWrite"],
];

/** The EVSA data-entry bits: the VSS words, with the extended-header bit. */
const EVSA_ATTRIBUTE_BITS: readonly (readonly [number, string])[] = [
  [0x0000_0001, "NonVolatile"],
  [0x0000_0002, "BootService"],
  [0x0000_0004, "Runtime"],
  [0x0000_0008, "HwErrorRecord"],
  [0x0000_0010, "AuthWrite"],
  [0x0000_0020, "TimeBasedAuthWrite"],
  [0x0000_0040, "AppendWrite"],
  [0x1000_0000, "ExtendedHeader"],
];

/**
 * An EVSA record checks itself the sum-to-zero way, from its stored checksum
 * byte to its end. When the sum is not zero, the byte that would make it zero is
 * `stored - sum` — what the row quotes.
 */
function evsaChecksum(
  checksumOffset: number,
  end: number,
  reader: ImageReader
): { value: number; valid: boolean; expected: number } | undefined {
  const stored = reader.uint8(checksumOffset);
  if (stored === undefined || end <= checksumOffset) return undefined;
  const sum = sum8Of({ start: checksumOffset, end }, reader);
  if (sum === undefined) return undefined;
  return { value: stored, valid: sum === 0, expected: (stored - sum) & 0xff };
}

/** Fixed-size bytes holding an ASCII word, up to the first zero. */
function asciiText(bytes: Uint8Array): string {
  const zero = bytes.indexOf(0);
  return new TextDecoder().decode(zero < 0 ? bytes : bytes.subarray(0, zero));
}

// MARK: - Text

/**
 * A checksum row whose validity the parse-time repairs decide: a repair at the
 * field's own offset says it is wrong and quotes what it should be.
 */
function checksumRow(
  label: string,
  stored: number,
  digits: number,
  repairs: readonly ChecksumRepair[],
  checksumOffset: number
): DetailField {
  const repair = repairs.find((one) => one.offset === checksumOffset);
  return field(
    label,
    checksumText({
      value: stored,
      valid: repair === undefined,
      expected: repair === undefined ? undefined : littleEndian(repair.bytes),
      digits,
    }),
    repair !== undefined
  );
}

function littleEndian(bytes: Uint8Array): number {
  let value = 0;
  for (let index = bytes.length - 1; index >= 0; index--) {
    value = value * 256 + (bytes[index] ?? 0);
  }
  return value;
}

/** The type byte, named by the kind that gives it a meaning. */
function typeText(node: UEFINode): string {
  const subtype = node.subtype;
  if (subtype === undefined) return "";
  switch (node.kind) {
    case "file":
      return fileTypeName(subtype);
    case "section":
      return sectionTypeName(subtype);
    case "volume":
      return `Revision ${subtype}`;
    case "region": {
      const type = FLASH_REGIONS[subtype];
      return type === undefined ? hex(subtype) : `${regionLabel(type)} · ${hex(subtype)}`;
    }
    case "intelImage":
    case "uefiImage":
    case "vssEntry":
    case "sysFEntry":
    case "evsaEntry":
    case "flashMapEntry":
    case "nvarEntry":
    case "dvarEntry":
    case "startupApData":
    case "slicData":
      return subtypeName(itemType(node), subtype) ?? hex(subtype);
    default:
      return hex(subtype);
  }
}

function guidDetailText(guid: EFIGUID): string {
  const known = nameOfGuid(guid);
  return known === undefined ? guidText(guid) : `${guidText(guid)} (${known})`;
}

/**
 * A byte length, in hex and in decimal — `0x800 (2048)` — and `Empty` for none,
 * the word that stands for that everywhere rather than a dash.
 */
/**
 * The header a VSS variable's form carries (`VSSVariable`): the state by its name, the
 * attributes, the sizes, and what the form adds — the authenticated form's count, time
 * stamp and key index, Apple's data CRC, Intel's total size. The vendor GUID is the
 * common "GUID" field.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFINodeDetail.swift#UEFIDetail.vssFields
 */
function vssFields(variable: VSSVariable, reader: ImageReader): DetailField[] {
  const states: Readonly<Record<number, string>> =
    variable.form === "intelLegacy"
      ? { 252: "Valid", 248: "Invalid" }
      : {
          127: "Header valid",
          63: "Added",
          62: "Added, in deleted transition",
          61: "Deleted",
          60: "Deleted",
        };
  const stateName = states[variable.state];
  const fields: DetailField[] = [
    field(
      "State",
      stateName === undefined ? hex(variable.state) : `${hex(variable.state)} (${stateName})`
    ),
    field("Reserved", hex(variable.reserved)),
    field("Attributes", bits(variable.attributes, NVRAM_ATTRIBUTE_BITS)),
  ];
  if (variable.totalSize !== undefined)
    fields.push(field("Total size", sizeText(variable.totalSize)));
  if (variable.monotonicCount !== undefined) {
    fields.push(field("Monotonic count", `${variable.monotonicCount}`));
  }
  if (variable.timestamp !== undefined) {
    fields.push(
      field(
        "Timestamp",
        isZeroTime(variable.timestamp)
          ? L("Not set")
          : (timeText(variable.timestamp) ?? L("Not a date"))
      )
    );
  }
  if (variable.publicKeyIndex !== undefined) {
    fields.push(field("Public key index", `${variable.publicKeyIndex}`));
  }
  if (variable.nameSize !== undefined) fields.push(field("Name size", sizeText(variable.nameSize)));
  if (variable.dataSize !== undefined) fields.push(field("Data size", sizeText(variable.dataSize)));
  const data = variable.dataCRC32 === undefined ? undefined : reader.bytes(variable.data);
  if (variable.dataCRC32 !== undefined && data !== undefined) {
    const computed = crc32(data);
    fields.push(
      field(
        "Data CRC32",
        checksumText({
          value: variable.dataCRC32,
          valid: computed === variable.dataCRC32,
          expected: computed,
          digits: 8,
        }),
        computed !== variable.dataCRC32
      )
    );
  }
  return fields;
}

function sizeText(bytes: number): string {
  return bytes === 0 ? L("Empty") : `${hex(bytes)} (${bytes})`;
}

/** Where the part starts and how long it is: `0x0 · 0x2000 (8192) bytes`. */
function rangeText(range: ImageRange): string {
  const count = range.end - range.start;
  return count <= 0 ? sizeText(0) : `${hex(range.start)} · ${sizeText(count)} bytes`;
}

/** The hex value, with the well-known bits named when they are set. */
function bits(value: number, names: readonly (readonly [number, string])[]): string {
  const set = names.filter(([bit]) => (value & bit) !== 0).map(([, name]) => name);
  return set.length === 0 ? hex(value) : `${hex(value)} (${set.join(", ")})`;
}

function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function hexBytes(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}
