/**
 * UEFITool's classification of an image element.
 *
 * GENERATED from `common/types.h` and `common/types.cpp` of
 * github.com/LongSoft/UEFITool, branch `new_engine`, by way of upstream's own
 * `UEFITypes.swift`. Do not edit the tables by hand: a hand edit is a fork from
 * the classification the rest of the tool reads from.
 *
 * The Type and Subtype the structure tree shows for a node are UEFITool's, not
 * ours, so the tree reads the way UEFITool's does. The tables are baked into
 * the build rather than fetched at run time: they are small, they are the
 * classification the whole panel leans on, and a firmware bench should not need
 * the network to say what a BIOS region is.
 */

/**
 * The item-type codes, `Root = 0x3C` and counting.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Item
 */
export const ItemType = {
  root: 0x3c,
  capsule: 0x3d,
  image: 0x3e,
  region: 0x3f,
  padding: 0x40,
  volume: 0x41,
  file: 0x42,
  section: 0x43,
  freeSpace: 0x44,
  vssStore: 0x45,
  vss2Store: 0x46,
  ftwStore: 0x47,
  fdcStore: 0x48,
  sysFStore: 0x49,
  evsaStore: 0x4a,
  phoenixFlashMapStore: 0x4b,
  insydeFlashDeviceMapStore: 0x4c,
  dellDvarStore: 0x4d,
  cmdbStore: 0x4e,
  nvarGuidStore: 0x4f,
  nvarEntry: 0x50,
  vssEntry: 0x51,
  sysFEntry: 0x52,
  evsaEntry: 0x53,
  phoenixFlashMapEntry: 0x54,
  insydeFlashDeviceMapEntry: 0x55,
  dellDvarEntry: 0x56,
  intelMicrocode: 0x57,
  slicData: 0x58,
  ifwiHeader: 0x59,
  ifwiPartition: 0x5a,
  fptStore: 0x5b,
  fptEntry: 0x5c,
  fptPartition: 0x5d,
  bpdtStore: 0x5e,
  bpdtEntry: 0x5f,
  bpdtPartition: 0x60,
  cpdStore: 0x61,
  cpdEntry: 0x62,
  cpdPartition: 0x63,
  cpdExtension: 0x64,
  cpdSpiEntry: 0x65,
  startupApDataEntry: 0x66,
  directoryTable: 0x67,
  directoryTableEntry: 0x68,
  amdMicrocode: 0x69,
} as const;

export type ItemTypeCode = (typeof ItemType)[keyof typeof ItemType];

/**
 * The subtype codes, grouped in source by the item type that gives them meaning.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub
 */
export const Sub = {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.aptioSignedCapsule */
  aptioSignedCapsule: 0x64,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.aptioUnsignedCapsule */
  aptioUnsignedCapsule: 0x65,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.uefiCapsule */
  uefiCapsule: 0x66,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.toshibaCapsule */
  toshibaCapsule: 0x67,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.manifestCpdPartition */
  manifestCpdPartition: 0xf0,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.metadataCpdPartition */
  metadataCpdPartition: 0xf1,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.keyCpdPartition */
  keyCpdPartition: 0xf2,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.codeCpdPartition */
  codeCpdPartition: 0xf3,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.pspDirectory */
  pspDirectory: 0x9b,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.comboDirectory */
  comboDirectory: 0x9c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.biosDirectory */
  biosDirectory: 0x9d,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.ishDirectory */
  ishDirectory: 0x9e,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.anyDirectory */
  anyDirectory: 0x9f,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.invalidDvarEntry */
  invalidDvarEntry: 0xb4,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.namespaceGuidDvarEntry */
  namespaceGuidDvarEntry: 0xb5,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.nameIdDvarEntry */
  nameIdDvarEntry: 0xb6,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.unknownDvarEntry */
  unknownDvarEntry: 0xb7,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.invalidEvsaEntry */
  invalidEvsaEntry: 0xa0,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.unknownEvsaEntry */
  unknownEvsaEntry: 0xa1,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.guidEvsaEntry */
  guidEvsaEntry: 0xa2,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.nameEvsaEntry */
  nameEvsaEntry: 0xa3,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.dataEvsaEntry */
  dataEvsaEntry: 0xa4,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.volumeFlashMapEntry */
  volumeFlashMapEntry: 0xaa,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.dataFlashMapEntry */
  dataFlashMapEntry: 0xab,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.unknownFlashMapEntry */
  unknownFlashMapEntry: 0xac,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.validFptEntry */
  validFptEntry: 0xdc,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.invalidFptEntry */
  invalidFptEntry: 0xdd,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.codeFptPartition */
  codeFptPartition: 0xe6,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.dataFptPartition */
  dataFptPartition: 0xe7,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.glutFptPartition */
  glutFptPartition: 0xe8,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.dataIfwiPartition */
  dataIfwiPartition: 0xd2,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.bootIfwiPartition */
  bootIfwiPartition: 0xd3,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.intelImage */
  intelImage: 0x5a,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.uefiImage */
  uefiImage: 0x5b,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.amdImage */
  amdImage: 0x5c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.intelMicrocode */
  intelMicrocode: 0xbe,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.amdMicrocode */
  amdMicrocode: 0xbf,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.invalidNvarEntry */
  invalidNvarEntry: 0x82,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.invalidLinkNvarEntry */
  invalidLinkNvarEntry: 0x83,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.linkNvarEntry */
  linkNvarEntry: 0x84,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.dataNvarEntry */
  dataNvarEntry: 0x85,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.fullNvarEntry */
  fullNvarEntry: 0x86,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.zeroPadding */
  zeroPadding: 0x78,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.onePadding */
  onePadding: 0x79,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.dataPadding */
  dataPadding: 0x7a,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.descriptorRegion */
  descriptorRegion: 0x00,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.biosRegion */
  biosRegion: 0x01,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.meRegion */
  meRegion: 0x02,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.gbeRegion */
  gbeRegion: 0x03,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.pdrRegion */
  pdrRegion: 0x04,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.devExp1Region */
  devExp1Region: 0x05,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.bios2Region */
  bios2Region: 0x06,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.microcodeRegion */
  microcodeRegion: 0x07,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.ecRegion */
  ecRegion: 0x08,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.devExp2Region */
  devExp2Region: 0x09,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.ieRegion */
  ieRegion: 0x0a,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.tgbe1Region */
  tgbe1Region: 0x0b,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.tgbe2Region */
  tgbe2Region: 0x0c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.reserved1Region */
  reserved1Region: 0x0d,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.reserved2Region */
  reserved2Region: 0x0e,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.pttRegion */
  pttRegion: 0x0f,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.pspL1DirectoryRegion */
  pspL1DirectoryRegion: 0x10,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.pspL2DirectoryRegion */
  pspL2DirectoryRegion: 0x11,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.pspDirectoryFile */
  pspDirectoryFile: 0x12,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.pubkeySlicData */
  pubkeySlicData: 0xc8,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.markerSlicData */
  markerSlicData: 0xc9,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.x86128kStartupApDataEntry */
  x86128kStartupApDataEntry: 0xfa,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.invalidSysFEntry */
  invalidSysFEntry: 0x96,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.normalSysFEntry */
  normalSysFEntry: 0x97,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.unknownVolume */
  unknownVolume: 0x6e,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.ffs2Volume */
  ffs2Volume: 0x6f,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.ffs3Volume */
  ffs3Volume: 0x70,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.nvramVolume */
  nvramVolume: 0x71,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.appleMicrocodeVolume */
  appleMicrocodeVolume: 0x72,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.invalidVssEntry */
  invalidVssEntry: 0x8c,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.standardVssEntry */
  standardVssEntry: 0x8d,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.appleVssEntry */
  appleVssEntry: 0x8e,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.authVssEntry */
  authVssEntry: 0x8f,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.Sub.intelVssEntry */
  intelVssEntry: 0x90,
} as const;

/** `itemTypeToUString`, transcribed. */
const TYPE_NAMES: Readonly<Record<number, string>> = {
  60: "Root",
  61: "Capsule",
  62: "Image",
  63: "Region",
  64: "Padding",
  65: "Volume",
  66: "File",
  67: "Section",
  68: "Free space",
  69: "VSS store",
  70: "VSS2 store",
  71: "FTW store",
  72: "FDC store",
  73: "SysF store",
  74: "EVSA store",
  75: "FlashMap store",
  76: "FlashDeviceMap store",
  77: "DVAR store",
  78: "CMDB store",
  79: "NVAR GUID store",
  80: "NVAR entry",
  81: "VSS entry",
  82: "SysF entry",
  83: "EVSA entry",
  84: "FlashMap entry",
  85: "FlashDeviceMap entry",
  86: "DVAR entry",
  87: "Intel microcode",
  88: "SLIC data",
  89: "IFWI header",
  90: "IFWI partition",
  91: "FPT store",
  92: "FPT entry",
  93: "FPT partition",
  94: "BPDT store",
  95: "BPDT entry",
  96: "BPDT partition",
  97: "CPD store",
  98: "CPD entry",
  99: "CPD partition",
  100: "CPD extension",
  101: "CPD SPI entry",
  102: "Startup AP data",
  103: "Table",
  104: "Table entry",
  105: "AMD microcode",
};

/** `regionTypeToUString`, transcribed: the flash-descriptor region type. */
const REGION_NAMES: Readonly<Record<number, string>> = {
  0: "Descriptor",
  1: "BIOS",
  2: "ME",
  3: "GbE",
  4: "PDR",
  5: "DevExp1",
  6: "BIOS2",
  7: "Microcode",
  8: "EC",
  9: "DevExp2",
  10: "IE",
  11: "10GbE1",
  12: "10GbE2",
  13: "Reserved1",
  14: "Reserved2",
  15: "PTT",
  16: "PSP directory",
  17: "PSP L2 directory",
  18: "PSP file",
};

/**
 * `itemSubtypeToUString`, transcribed and keyed by item type. Region is folded
 * in from `regionTypeToUString`; File and Section are absent on purpose, named
 * by the FFS and section type tables at run time.
 */
const SUBTYPE_NAMES: Readonly<Record<number, Readonly<Record<number, string>>>> = {
  61: { 100: "Aptio signed", 101: "Aptio unsigned", 102: "UEFI 2.0", 103: "Toshiba" },
  62: { 90: "Intel", 91: "UEFI", 92: "AMD" },
  63: {
    0: "Descriptor",
    1: "BIOS",
    2: "ME",
    3: "GbE",
    4: "PDR",
    5: "DevExp1",
    6: "BIOS2",
    7: "Microcode",
    8: "EC",
    9: "DevExp2",
    10: "IE",
    11: "10GbE1",
    12: "10GbE2",
    13: "Reserved1",
    14: "Reserved2",
    15: "PTT",
    16: "PSP directory",
    17: "PSP L2 directory",
    18: "PSP file",
  },
  64: { 120: "Empty (00h)", 121: "Empty (FFh)", 122: "Non-empty" },
  65: { 110: "Unknown", 111: "FFSv2", 112: "FFSv3", 113: "NVRAM", 114: "Apple microcode" },
  80: { 130: "Invalid", 131: "Invalid link", 132: "Link", 133: "Data", 134: "Full" },
  81: { 140: "Invalid", 141: "Standard", 142: "Apple", 143: "Auth", 144: "Intel" },
  82: { 150: "Invalid", 151: "Normal" },
  83: { 160: "Invalid", 161: "Unknown", 162: "GUID", 163: "Name", 164: "Data" },
  84: { 170: "Volume", 171: "Data", 172: "Unknown" },
  86: { 180: "Invalid", 181: "NamespaceGuid", 182: "NameId", 183: "Unknown" },
  90: { 210: "Data", 211: "Boot" },
  92: { 220: "Valid", 221: "Invalid" },
  93: { 230: "Code", 231: "Data", 232: "GLUT" },
  99: { 240: "Manifest", 241: "Metadata", 242: "Key", 243: "Code" },
  102: { 250: "X86 128K" },
  103: { 155: "PSP table", 156: "Combo table", 157: "BIOS table", 158: "ISH table" },
};

const unknown = (code: number) => `Unknown ${code.toString(16).toUpperCase().padStart(2, "0")}h`;

/**
 * The word for an item-type code. An unknown code keeps its number.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.typeName
 */
export function typeName(type: number): string {
  return TYPE_NAMES[type] ?? unknown(type);
}

/**
 * The word for a flash-descriptor region type. Unknown keeps its number.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.regionName
 */
export function regionName(type: number): string {
  return REGION_NAMES[type] ?? unknown(type);
}

/**
 * The word for a subtype, given the item type that owns it. Nothing where the
 * type has no named subtypes — File and Section delegate to the FFS and section
 * type tables, which a caller names itself.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypes.swift#UEFITypes.subtypeName
 */
export function subtypeName(type: number, subtype: number): string | undefined {
  return SUBTYPE_NAMES[type]?.[subtype];
}
