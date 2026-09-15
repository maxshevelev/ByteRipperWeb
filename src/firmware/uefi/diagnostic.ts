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
  | "nvramStore";

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
  | { readonly kind: "overlappingRegions" };

/** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic */
export interface UEFIDiagnostic {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.kind */
  readonly detail: DiagnosticKind;
  /**
   * Where in the image, absolute.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.offset
   */
  readonly offset: number;
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
};

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

/**
 * One line, for the tool's own list.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFIDiagnostic.swift#UEFIDiagnostic.message
 */
export function diagnosticMessage(diagnostic: UEFIDiagnostic): string {
  const detail = diagnostic.detail;
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
  }
}
