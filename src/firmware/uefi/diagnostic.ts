import { type ByteSpace, outermostSection } from "@/firmware/uefi/byteSpace";
import { type EFIGUID, guidText } from "@/firmware/uefi/efiGuid";

/**
 * Something wrong with the image, reported rather than thrown.
 *
 * A dump off a real flash chip almost always has one structure that does not
 * match the specification, so a parser that throws on the first one parses
 * nothing anyone owns. Every level here collects and carries on, and what it
 * collects is the interesting half of the output: the reason to open a tool on
 * an image is usually that something in it is already wrong.
 *
 * A diagnostic locates itself by offset and not by node id, because it is
 * raised while the node is still being built — and an offset is the better
 * answer anyway: the tree turns it back into a node, and the dump can put the
 * caret on it.
 */

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.Severity */
export type Severity =
  /** The value is wrong but the parse went on. */
  | "warning"
  /** Parsing this level stopped here. */
  | "error";

/**
 * The structure being read when the trouble showed up.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.Structure
 */
export type Structure =
  | "capsuleHeader"
  | "flashDescriptor"
  | "volumeHeader"
  | "volumeExtendedHeader"
  | "volumeBody"
  | "fileHeader"
  | "fileBody"
  | "sectionHeader"
  | "sectionBody"
  | "microcodeHeader"
  | "resetVector"
  /** An NVRAM store: the VSS / VSS2 / FTW and the rest of an NVRAM volume. */
  | "nvramStore"
  /** The Insyde H2O flash device map, and its entries. */
  | "flashDeviceMap";

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.Kind */
export type DiagnosticKind =
  /** The image ends before the structure does. */
  | { readonly kind: "truncated"; readonly structure: Structure }
  /** A size field of zero, which would loop forever if believed. */
  | { readonly kind: "zeroSize"; readonly structure: Structure }
  | {
      readonly kind: "checksumMismatch";
      readonly structure: Structure;
      readonly stored: number;
      readonly computed: number;
    }
  | {
      readonly kind: "sizeMismatch";
      readonly structure: Structure;
      readonly stored: number;
      readonly computed: number;
    }
  /**
   * A volume whose file-system GUID is not one we parse; its body is kept whole
   * rather than read as FFS.
   */
  | { readonly kind: "unknownFileSystem"; readonly guid: EFIGUID }
  | { readonly kind: "unknownType"; readonly structure: Structure; readonly code: number }
  /** A tree deep enough to be a loop rather than an image. */
  | { readonly kind: "recursionLimit" }
  /**
   * A Volume Top File was found but cannot anchor the image — it ends past the
   * top of the address space. Not having one at all is no diagnostic: a partial
   * dump of a BIOS region or an EC has no VTF and is not defective for it.
   */
  | { readonly kind: "addressesUnknown" }
  /** Two flash regions covering the same bytes: a descriptor nobody can trust. */
  | { readonly kind: "overlappingRegions" }
  /**
   * A compressed section this parser decodes did not decode: the data ended
   * first, or is not the algorithm's. The section is kept whole.
   */
  | {
      readonly kind: "decompressionFailed";
      readonly algorithm: string;
      readonly truncated: boolean;
    }
  /**
   * A compressed section declares more than the parser's limits let a parse
   * allocate. Kept whole, never allocated.
   */
  | { readonly kind: "decompressedTooLarge"; readonly algorithm: string; readonly declared: number }
  /** A compression section's `UncompressedLength` is not the size that came out of it. */
  | {
      readonly kind: "decompressedSizeMismatch";
      readonly stored: number;
      readonly computed: number;
    }
  /** A compressed GUID-defined section without `PROCESSING_REQUIRED` in its attributes. */
  | { readonly kind: "processingRequiredNotSet" }
  /** A structure of a revision later than any this parser reads; it is skipped. */
  | { readonly kind: "unknownRevision"; readonly structure: Structure; readonly revision: number }
  /**
   * A flash device map whose entries are of a size or format nobody has
   * described; the store is kept whole.
   */
  | {
      readonly kind: "unknownFlashDeviceMapEntries";
      readonly size: number;
      readonly format: number;
    };

/**
 * Where a diagnostic raised inside a compressed section really is: an offset in
 * the buffer that section decompresses to.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.InnerLocation
 */
export interface InnerLocation {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.InnerLocation.space */
  readonly space: ByteSpace;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.InnerLocation.offset */
  readonly offset: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic */
export interface UEFIDiagnostic {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.kind */
  readonly detail: DiagnosticKind;
  /**
   * Where in the image, absolute. For a diagnostic raised inside a compressed
   * section, the outermost compressed section's header — the bytes of the file
   * that hold the trouble, and the most the dump can show.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.offset
   */
  readonly offset: number;
  /**
   * Where inside, when the trouble is in a decompressed buffer.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.inside
   */
  readonly inside?: InnerLocation | undefined;
}

/**
 * This diagnostic — raised at an offset in `space` by a parser that only knew
 * the buffer it was reading — located the way every diagnostic is: at bytes of
 * the file, with the offset inside kept.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.located
 */
export function locatedIn(diagnostic: UEFIDiagnostic, space: ByteSpace): UEFIDiagnostic {
  const outermost = outermostSection(space);
  if (outermost === undefined) return diagnostic;
  return {
    detail: diagnostic.detail,
    offset: outermost,
    inside: { space, offset: diagnostic.offset },
  };
}

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.Kind.severity
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.severity
 */
export function severityOf(detail: DiagnosticKind): Severity {
  switch (detail.kind) {
    case "truncated":
    case "zeroSize":
    case "recursionLimit":
      return "error";
    default:
      return "warning";
  }
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.Structure.label */
const LABELS: Readonly<Record<Structure, string>> = {
  capsuleHeader: "capsule header",
  flashDescriptor: "flash descriptor",
  volumeHeader: "volume header",
  volumeExtendedHeader: "volume extended header",
  volumeBody: "volume body",
  fileHeader: "file header",
  fileBody: "file body",
  sectionHeader: "section header",
  sectionBody: "section body",
  microcodeHeader: "microcode header",
  resetVector: "reset vector",
  nvramStore: "NVRAM store",
  flashDeviceMap: "flash device map",
};

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

/**
 * One line, for the tool's own list.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.message
 */
export function diagnosticMessage(diagnostic: UEFIDiagnostic): string {
  const inside = diagnostic.inside;
  const message = kindMessage(diagnostic.detail);
  return inside === undefined
    ? message
    : `${message} (at ${hex(inside.offset)} in what the compressed section at ` +
        `${hex(diagnostic.offset)} decompresses to)`;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.kindMessage */
function kindMessage(detail: DiagnosticKind): string {
  switch (detail.kind) {
    case "truncated":
      return `${LABELS[detail.structure]} runs past the end of the image`;
    case "zeroSize":
      return `${LABELS[detail.structure]} has a size of zero`;
    case "checksumMismatch":
      return `${LABELS[detail.structure]} checksum is ${hex(detail.stored)}, computed ${hex(
        detail.computed
      )}`;
    case "sizeMismatch":
      return `${LABELS[detail.structure]} size is ${hex(detail.stored)}, computed ${hex(
        detail.computed
      )}`;
    case "unknownFileSystem":
      return `unknown volume file system ${guidText(detail.guid)}`;
    case "unknownType":
      return `unknown ${LABELS[detail.structure]} type ${hex(detail.code)}`;
    case "recursionLimit":
      return "nesting is too deep to be an image";
    case "addressesUnknown":
      return "the volume top file ends past the top of the address space";
    case "overlappingRegions":
      return "this flash region overlaps the one before it";
    case "decompressionFailed":
      return detail.truncated
        ? `${detail.algorithm} data ends before it has decompressed`
        : `${detail.algorithm} data does not decompress`;
    case "decompressedTooLarge":
      return (
        `${detail.algorithm} data says it decompresses to ${hex(detail.declared)} bytes, ` +
        "more than a parse allocates"
      );
    case "decompressedSizeMismatch":
      return (
        `compressed section says it decompresses to ${hex(detail.stored)} bytes, ` +
        `it came to ${hex(detail.computed)}`
      );
    case "processingRequiredNotSet":
      return "compressed GUID-defined section does not have PROCESSING_REQUIRED set";
    case "unknownRevision":
      return `${LABELS[detail.structure]} revision ${hex(detail.revision)} is later than any this parser reads`;
    case "unknownFlashDeviceMapEntries":
      return (
        `Insyde flash device map entries of ${hex(detail.size)} bytes in format ` +
        `${hex(detail.format)} are of no known layout`
      );
  }
}
