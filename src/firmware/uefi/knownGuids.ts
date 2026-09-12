import { type EFIGUID, guid, guidEquals, guidKey } from "@/firmware/uefi/efiGuid";

/**
 * The tables that turn sixteen bytes into a meaning.
 *
 * Half of this format is a lookup: a volume's file system, a file's identity, a
 * section's compression algorithm are all GUIDs, and the same GUID means the
 * same thing in every image on earth. Kept in one file because that is how it
 * stays checkable against the format notes — a GUID in the wrong table is a bug
 * no test of ours would otherwise catch.
 */

export const FFS_V1 = guid("7A9354D9-0468-444A-81CE-0BF617D890DF");
export const FFS_V2 = guid("8C8CE578-8A3D-4F1C-9935-896185C32DD3");
export const FFS_V3 = guid("5473C07A-3DCB-4DCA-BD6F-1E9689E7349A");

/** Every GUID vendors use for what is, byte for byte, an FFSv2 volume. */
export const FFS_V2_FILE_SYSTEMS: readonly EFIGUID[] = [
  FFS_V2,
  guid("04ADEEAD-61FF-4D31-B6BA-64F8BF901F5A"), // Apple immutable
  guid("BD001B8C-6A71-487B-A14F-0C2A2DCF7A5D"), // Apple authentication
  guid("AD3FFFFF-D28B-44C4-9F13-9EA98A97F9F0"), // Intel
  guid("D6A1CD70-4B33-4994-A6EA-375F2CCC5437"), // Intel 2
  guid("4F494156-AED6-4D64-A537-B8A5557BCEEC"), // Sony
  guid("372B56DF-CC9F-4817-AB97-0A10A92CEAA5"), // HP
];

/**
 * A volume's file system decides how its body is read. A volume whose GUID is
 * not here keeps its body whole.
 */
export function ffsVersionOfFileSystem(candidate: EFIGUID): number | undefined {
  if (guidEquals(candidate, FFS_V1)) return 1;
  if (FFS_V2_FILE_SYSTEMS.some((one) => guidEquals(one, candidate))) return 2;
  if (guidEquals(candidate, FFS_V3)) return 3;
  return undefined;
}

/**
 * The Volume Top File, which the second pass cannot do without: the last byte
 * of the last one is mapped at `0xFFFFFFFF`, and that is the only thing in an
 * image that ties an offset to an address.
 */
export const VOLUME_TOP_FILE = guid("1BA0062E-C779-4582-8566-336AE8F78F09");

/**
 * AMD keeps its microcode in FFS files rather than in a run of its own, and
 * these two GUIDs are the only thing that says so — Intel's is recognised by
 * its header, AMD's is not.
 */
export const AMD_MICROCODE = guid("DE3E049C-A218-4891-8658-5FC0FA84C788");
export const AMD_COMPRESSED_RAW_FILE = guid("20BC8AC9-94D1-4208-AB28-5D673FD73487");

/**
 * Names for the volumes, files and sections worth naming. Everything else is
 * shown by its type, which is more useful than a GUID nobody knows.
 */
export function nameOfGuid(candidate: EFIGUID): string | undefined {
  return NAMES.get(guidKey(candidate));
}

const NAMES = new Map<string, string>(
  (
    [
      [FFS_V1, "FFSv1"],
      [FFS_V2, "FFSv2"],
      [FFS_V3, "FFSv3"],
      [guid("04ADEEAD-61FF-4D31-B6BA-64F8BF901F5A"), "Apple immutable FV"],
      [guid("BD001B8C-6A71-487B-A14F-0C2A2DCF7A5D"), "Apple authentication FV"],
      [guid("153D2197-29BD-44DC-AC59-887F70E41A6B"), "Apple microcode FV"],
      [guid("AD3FFFFF-D28B-44C4-9F13-9EA98A97F9F0"), "Intel FS"],
      [guid("D6A1CD70-4B33-4994-A6EA-375F2CCC5437"), "Intel FS 2"],
      [guid("4F494156-AED6-4D64-A537-B8A5557BCEEC"), "Sony FS"],
      [guid("372B56DF-CC9F-4817-AB97-0A10A92CEAA5"), "HP FS"],
      [guid("FFF12B8D-7696-4C8B-A985-2747075B4F50"), "NVRAM store"],
      [guid("00504624-8A59-4EEB-BD0F-6B36E96128E0"), "NVRAM additional store"],

      [VOLUME_TOP_FILE, "Volume Top File"],
      [guid("D6A2CB7F-6A18-4E2F-B43B-9920A733700A"), "DXE Core"],
      [guid("5AE3F37E-4EAE-41AE-8240-35465B5E81EB"), "AMI DXE Core"],
      [guid("1B45CC0A-156A-428A-AF62-49864DA0E6E6"), "PEI apriori"],
      [guid("FC510EE7-FFDC-11D4-BD41-0080C73C8881"), "DXE apriori"],
      [guid("E4536585-7909-4A60-B5C6-ECDEA6EBFB54"), "AMI padding file"],
      [guid("389CC6F2-1EA8-467B-AB8A-78E769AE2A15"), "Phoenix vendor hash file"],
      [guid("CBC91F44-A4BC-4A5B-8696-703451D0B053"), "AMI vendor hash file"],
      [AMD_COMPRESSED_RAW_FILE, "AMD compressed raw file"],
      [AMD_MICROCODE, "AMD microcode"],
    ] as const
  ).map(([one, name]) => [guidKey(one), name])
);

/**
 * What a GUID-defined section's GUID says about its body.
 *
 * `transformsBody` is the only part the parser acts on: a body that has been
 * compressed or signed is not a run of sections any more, so it is kept whole.
 * CRC32 is the interesting exception — it only checks the data, so what is
 * inside is still there to read.
 */
export interface GuidedSection {
  readonly name: string;
  readonly transformsBody: boolean;
}

export function guidedSection(candidate: EFIGUID): GuidedSection | undefined {
  return GUIDED_SECTIONS.get(guidKey(candidate));
}

const GUIDED_SECTIONS = new Map<string, GuidedSection>(
  (
    [
      ["FC1BCDB0-7D31-49AA-936A-A4600D9DD083", "CRC32", false],
      ["A31280AD-481E-41B6-95E8-127F4C984779", "Tiano", true],
      ["EE4E5898-3914-4259-9D6E-DC7BD79403CF", "LZMA", true],
      ["0ED85E23-F253-413F-A03C-901987B04397", "LZMA (HP)", true],
      ["BD9921EA-ED91-404A-8B2F-B4D724747C8C", "LZMA (Microsoft)", true],
      ["D42AE6BD-1352-4BFB-909A-CA72A6EAE889", "LZMA with x86 filter", true],
      ["1D301FE9-BE79-4353-91C2-D23BC959AE0C", "GZip", true],
      ["CE3233F5-2CD6-4D87-9152-4A238BB6D1C4", "Zlib (AMD)", true],
      ["991EFAC0-E260-416B-A4B8-3B153072B804", "Zlib (AMD, second)", true],
      ["3D532050-5CDA-4FD0-879E-0F7F630D5AFB", "Brotli", true],
      ["0F9D89E8-9259-4F76-A5AF-0C89E34023DF", "Signed contents", true],
    ] as const
  ).map(([text, name, transformsBody]) => [guidKey(guid(text)), { name, transformsBody }])
);
