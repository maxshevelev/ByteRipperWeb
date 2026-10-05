import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { guidEquals } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapFormat";
import { readITEFirmware } from "@/firmware/uefi/iteFirmware";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * An embedded controller's firmware image, recognised by what it carries
 * (`UEFI_IMAGE_FORMAT.md` §9): an ITE image by the signature block and
 * identification near its start (`ITEFirmware`), any other by the `PHCM` header it
 * opens with — the format Microchip's MEC boot ROM reads, which does not say whose
 * chip the image is for.
 *
 * A block that holds EC firmware often holds more than one image — a second
 * controller's, a copy for recovery — each on a 4 KiB boundary. Nothing in either
 * format that is known says how long an image is. An image whose bytes begin with
 * the whole of an earlier one is a copy of it and as long as it — which keeps what
 * follows the last copy, a Dell EC region's log, out of it; any other image runs
 * to its last written byte before the next one. An erased run inside does not end
 * it: an ITE image keeps data at the end of its slot, past 40 KiB of erased bytes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage
 */
export interface ECImage {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.vendor */
  readonly vendor: ECVendor;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.start */
  readonly start: number;
  /**
   * How long the image is: to its last written byte, or the length of the earlier
   * image it copies.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.written
   */
  readonly written: number;
  /**
   * Where the earlier image this one copies byte for byte starts.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.copyOf
   */
  readonly copyOf?: number | undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.Vendor */
export type ECVendor =
  /** The identification the image carries, such as `ITE8380-EC-V1.43`. */
  | { readonly kind: "ite"; readonly identification: string }
  /**
   * A `PHCM` header: Microchip's MEC format, but not only Microchip's chips' — a
   * board can carry one whose two controllers are both ITE's. No string in the
   * image names the chip or the version, and the header's fields are not decoded.
   */
  | { readonly kind: "phcm" };

/**
 * What the image says it is, in the image's own words where it has any.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.name
 */
export const ecImageName = (image: ECImage): string =>
  image.vendor.kind === "ite" ? image.vendor.identification : "PHCM image";

/**
 * Whether the image is ITE's: the one vendor told by a signature long enough to be
 * believed away from a block's start.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.isITE
 */
const isITE = (image: ECImage): boolean => image.vendor.kind === "ite";

/** `PHCM`, `MCHP` reversed: the header Microchip's MEC boot ROM reads. */
// @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.phcmSignature
const PHCM_SIGNATURE = 0x4d43_4850;
// @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.step
const STEP = 0x1000;

const sameVendor = (left: ECVendor, right: ECVendor): boolean =>
  left.kind === right.kind &&
  (left.kind !== "ite" || left.identification === (right as typeof left).identification);

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.image */
function vendorAt(start: number, limit: number, reader: ImageReader): ECVendor | undefined {
  if (reader.uint32(start) === PHCM_SIGNATURE) return { kind: "phcm" };
  const ite = readITEFirmware(start, limit, reader);
  return ite === undefined ? undefined : { kind: "ite", identification: ite.identification };
}

/**
 * Every image in `range`, at each 4 KiB boundary, each running to its last written
 * byte before the next one starts.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.all
 */
export function allECImages(range: ImageRange, reader: ImageReader, emptyByte = 0xff): ECImage[] {
  const starts: { readonly at: number; readonly vendor: ECVendor }[] = [];
  for (let at = range.start; at < range.end; at += STEP) {
    const vendor = vendorAt(at, range.end, reader);
    if (vendor !== undefined) starts.push({ at, vendor });
  }
  const images: ECImage[] = [];
  starts.forEach((found, index) => {
    const end = starts[index + 1]?.at ?? range.end;
    const written = lastWritten({ start: found.at, end }, reader, emptyByte) - found.at;
    const original = copiedFrom(found.vendor, found.at, written, images, reader);
    images.push(
      original === undefined
        ? { vendor: found.vendor, start: found.at, written }
        : {
            vendor: found.vendor,
            start: found.at,
            written: original.written,
            copyOf: original.start,
          }
    );
  });
  return images;
}

/**
 * The image's bytes, as far as written: what a copy is told by.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.range
 */
export const ecImageRange = (image: ECImage): ImageRange => ({
  start: image.start,
  end: image.start + image.written,
});

/**
 * The end of the last byte in `range` that is not `emptyByte`, or the range's start
 * when every byte is.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.lastWritten
 */
function lastWritten(range: ImageRange, reader: ImageReader, emptyByte: number): number {
  let end = range.end;
  while (end > range.start) {
    const start = end - Math.min(STEP, end - range.start);
    const bytes = reader.bytesAt(start, end - start);
    if (bytes === undefined) return end;
    const last = bytes.findLastIndex((byte) => byte !== emptyByte);
    if (last >= 0) return start + last + 1;
    end = start;
  }
  return range.start;
}

/**
 * The earlier image whose whole bytes this one begins with, if any — of the same
 * vendor, and no longer than what this one has written.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.copied
 */
function copiedFrom(
  vendor: ECVendor,
  start: number,
  written: number,
  earlier: readonly ECImage[],
  reader: ImageReader
): ECImage | undefined {
  return earlier.find((original) => {
    if (!sameVendor(original.vendor, vendor) || original.written === 0) return false;
    if (original.written > written) return false;
    const mine = reader.bytesAt(start, original.written);
    const theirs = reader.bytes(ecImageRange(original));
    return (
      mine !== undefined &&
      theirs !== undefined &&
      mine.length === theirs.length &&
      mine.every((byte, index) => byte === theirs[index])
    );
  });
}

/**
 * The node subtype an EC image row carries when it is a copy of an earlier image
 * in the same block. Not UEFITool's — it classifies these bytes as padding — so it
 * is free to say this.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.copySubtype
 */
export const EC_COPY_SUBTYPE = 1;

const roundedUp = (size: number): number => Math.ceil(size / STEP) * STEP;

/**
 * The name padding gets when it holds EC firmware — with the image's name after it
 * when it holds one, alone when its rows name the images.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.paddingName
 */
export const EC_PADDING_NAME = "EC firmware";

/**
 * Whether `node` is padding the parser named for the EC firmware in it, which the
 * panel's help and details key on.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#ECImage.isECFirmwarePadding
 */
export const isECFirmwarePadding = (node: {
  readonly kind: string;
  readonly name?: string | undefined;
}): boolean =>
  node.kind === "padding" &&
  node.name !== undefined &&
  (node.name === EC_PADDING_NAME || node.name.startsWith(`${EC_PADDING_NAME} (`));

/**
 * `node` — padding, an EC Firmware region of the flash device map, or the
 * descriptor's EC region — read as the EC firmware it holds
 * (`UEFI_IMAGE_FORMAT.md` §9). One image at its start names it; more than that
 * gives it a row per image, each named by its own, and padding for what lies
 * between them, and the block keeps a name of its own. Nothing when no image is
 * there.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#Parser.readingECFirmware
 */
export function readingECFirmware(
  parser: Parser,
  node: UEFINode,
  emptyByte: number
): UEFINode | undefined {
  const images = allECImages(node.body, parser.reader, emptyByte);
  const first = images[0];
  if (first === undefined) return undefined;
  // Padding names only what opens it: an image further in is a guess about the
  // bytes before it, and is a row inside it instead (`cuttingECFirmware`).
  if (node.kind === "padding" && first.start !== node.body.start) return undefined;
  const read: UEFINode = { ...node };
  const base = node.kind === "padding" ? EC_PADDING_NAME : node.name;
  // One image at the start: the block is that image, and says which and how long
  // it is. A region of the flash device map is as long as its entry says — the
  // firmware's own statement of its slot, erased tail and all; anything else is
  // measured as a row would be. With several images the entry is the region's size
  // and no one image's, so the rows below are measured by their bytes.
  if (images.length <= 1 && first.start === node.body.start) {
    read.name = `${base} (${ecImageName(first)})`;
    read.namedImageLength =
      node.kind === "flashDeviceMapRegion"
        ? node.body.end - node.body.start
        : Math.min(roundedUp(Math.max(first.written, 1)), node.body.end - node.body.start);
    return read;
  }
  // Several: each row names its own, and the block names none of them.
  read.name = base;

  const children: UEFINode[] = [];
  let at = node.body.start;
  images.forEach((image, index) => {
    children.push(...parser.padding(at, image.start, emptyByte));
    const next = images[index + 1]?.start ?? node.body.end;
    const end = Math.min(image.start + roundedUp(Math.max(image.written, 1)), next);
    children.push(
      makeNode({
        kind: "ecImage",
        subtype: image.copyOf === undefined ? undefined : EC_COPY_SUBTYPE,
        name: ecImageName(image),
        header: { start: image.start, end: image.start },
        body: { start: image.start, end },
        isFixed: true,
      })
    );
    at = end;
  });
  children.push(...parser.padding(at, node.body.end, emptyByte));
  read.children = children;
  return read;
}

/**
 * `nodes` with the padding and the EC Firmware map regions that hold EC firmware
 * read as it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#Parser.readingECFirmware
 */
export function readingECFirmwareIn(
  parser: Parser,
  nodes: readonly UEFINode[],
  emptyByte: number
): UEFINode[] {
  return nodes.map((node): UEFINode => {
    if (
      node.kind === "flashDeviceMapRegion" &&
      node.guid !== undefined &&
      guidEquals(node.guid, FlashDeviceMap.ecFirmware)
    ) {
      return readingECFirmware(parser, node, emptyByte) ?? node;
    }
    if (node.kind !== "padding") return node;
    // Padding a table has already read rows into: the EC firmware is looked for
    // among them, not over them.
    if (node.children.length > 0) {
      return { ...node, children: readingECFirmwareIn(parser, node.children, emptyByte) };
    }
    if (node.isErased) return node;
    return (
      readingECFirmware(parser, node, emptyByte) ??
      cuttingECFirmware(parser, node, emptyByte) ??
      node
    );
  });
}

/**
 * Padding that holds an ITE image further in than its start, with the image as a
 * row inside it: the padding before, the EC firmware, the padding after. The
 * padding stays what the structures around it made it, and keeps its name — the EC
 * firmware is one part of it, and what else it holds is read into rows beside it.
 * An AMD board's first padding is like this — the PSP's directories and their
 * blobs, then the EC image, with nothing to announce any of them to the raw-area
 * scan. The image's row is named the way padding opening on one is, and ends where
 * the last image's bytes do. Only ITE's signature is trusted this far from a start:
 * a `PHCM` dword is four bytes, which data turns up. Nothing when there is no ITE
 * image inside.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ECFirmware.swift#Parser.cuttingECFirmware
 */
export function cuttingECFirmware(
  parser: Parser,
  node: UEFINode,
  emptyByte: number
): UEFINode | undefined {
  const images = allECImages(node.body, parser.reader, emptyByte).filter(isITE);
  const first = images[0];
  const last = images[images.length - 1];
  if (first === undefined || last === undefined || first.start <= node.body.start) {
    return undefined;
  }
  const end = Math.min(last.start + roundedUp(Math.max(last.written, 1)), node.body.end);
  const block = parser.padding(first.start, end, emptyByte)[0];
  const named = block === undefined ? undefined : readingECFirmware(parser, block, emptyByte);
  if (named === undefined) return undefined;
  return {
    ...node,
    children: [
      ...parser.padding(node.body.start, first.start, emptyByte),
      named,
      ...parser.padding(end, node.body.end, emptyByte),
    ],
  };
}
