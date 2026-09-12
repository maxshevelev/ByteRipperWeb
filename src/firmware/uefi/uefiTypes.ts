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

/** The item-type codes, `Root = 0x3C` and counting. */
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

/** The subtype codes, grouped in source by the item type that gives them meaning. */
export const Sub = {
  aptioSignedCapsule: 0x64,
  aptioUnsignedCapsule: 0x65,
  uefiCapsule: 0x66,
  toshibaCapsule: 0x67,
  manifestCpdPartition: 0xf0,
  metadataCpdPartition: 0xf1,
  keyCpdPartition: 0xf2,
  codeCpdPartition: 0xf3,
  pspDirectory: 0x9b,
  comboDirectory: 0x9c,
  biosDirectory: 0x9d,
  ishDirectory: 0x9e,
  anyDirectory: 0x9f,
  invalidDvarEntry: 0xb4,
  namespaceGuidDvarEntry: 0xb5,
  nameIdDvarEntry: 0xb6,
  unknownDvarEntry: 0xb7,
  invalidEvsaEntry: 0xa0,
  unknownEvsaEntry: 0xa1,
  guidEvsaEntry: 0xa2,
  nameEvsaEntry: 0xa3,
  dataEvsaEntry: 0xa4,
  volumeFlashMapEntry: 0xaa,
  dataFlashMapEntry: 0xab,
  unknownFlashMapEntry: 0xac,
  validFptEntry: 0xdc,
  invalidFptEntry: 0xdd,
  codeFptPartition: 0xe6,
  dataFptPartition: 0xe7,
  glutFptPartition: 0xe8,
  dataIfwiPartition: 0xd2,
  bootIfwiPartition: 0xd3,
  intelImage: 0x5a,
  uefiImage: 0x5b,
  amdImage: 0x5c,
  intelMicrocode: 0xbe,
  amdMicrocode: 0xbf,
  invalidNvarEntry: 0x82,
  invalidLinkNvarEntry: 0x83,
  linkNvarEntry: 0x84,
  dataNvarEntry: 0x85,
  fullNvarEntry: 0x86,
  zeroPadding: 0x78,
  onePadding: 0x79,
  dataPadding: 0x7a,
  descriptorRegion: 0x00,
  biosRegion: 0x01,
  meRegion: 0x02,
  gbeRegion: 0x03,
  pdrRegion: 0x04,
  devExp1Region: 0x05,
  bios2Region: 0x06,
  microcodeRegion: 0x07,
  ecRegion: 0x08,
  devExp2Region: 0x09,
  ieRegion: 0x0a,
  tgbe1Region: 0x0b,
  tgbe2Region: 0x0c,
  reserved1Region: 0x0d,
  reserved2Region: 0x0e,
  pttRegion: 0x0f,
  pspL1DirectoryRegion: 0x10,
  pspL2DirectoryRegion: 0x11,
  pspDirectoryFile: 0x12,
  pubkeySlicData: 0xc8,
  markerSlicData: 0xc9,
  x86128kStartupApDataEntry: 0xfa,
  invalidSysFEntry: 0x96,
  normalSysFEntry: 0x97,
  unknownVolume: 0x6e,
  ffs2Volume: 0x6f,
  ffs3Volume: 0x70,
  nvramVolume: 0x71,
  appleMicrocodeVolume: 0x72,
  invalidVssEntry: 0x8c,
  standardVssEntry: 0x8d,
  appleVssEntry: 0x8e,
  authVssEntry: 0x8f,
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

/** The word for an item-type code. An unknown code keeps its number. */
export function typeName(type: number): string {
  return TYPE_NAMES[type] ?? unknown(type);
}

/** The word for a flash-descriptor region type. Unknown keeps its number. */
export function regionName(type: number): string {
  return REGION_NAMES[type] ?? unknown(type);
}

/**
 * The word for a subtype, given the item type that owns it. Nothing where the
 * type has no named subtypes — File and Section delegate to the FFS and section
 * type tables, which a caller names itself.
 */
export function subtypeName(type: number, subtype: number): string | undefined {
  return SUBTYPE_NAMES[type]?.[subtype];
}
