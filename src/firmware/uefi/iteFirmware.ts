import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { guidEquals } from "@/firmware/uefi/efiGuid";
import { FlashDeviceMap } from "@/firmware/uefi/flashDeviceMapFormat";
import type { Parser } from "@/firmware/uefi/parserState";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * The identification an ITE embedded controller's firmware carries near its start
 * (`UEFI_IMAGE_FORMAT.md` §9): a signature block and the string after it, such as
 * `ITE8380-EC-V1.43`.
 *
 * No datasheet describes it. The layout is what seven dumps agree on: at `+0x40`
 * (the 8051 parts) or `+0x80`, six `A5` bytes, two bytes that vary,
 * `85 12 5A 5A AA`, one byte that varies, `55 55`; then up to sixteen bytes of
 * text. What the string names is what the firmware's author wrote into it — the
 * chip the image was built for, which is not always the chip on the board.
 *
 * Public because the details panel shows it beside the name.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware
 */
export interface ITEFirmware {
  /**
   * The string, as written, with trailing spaces and NULs dropped.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.identification
   */
  readonly identification: string;
  /**
   * Where the image starts: the identification is read relative to it.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.start
   */
  readonly start: number;
  /**
   * Where the signature block starts, relative to the image.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.signatureOffset
   */
  readonly signatureOffset: number;
}

/**
 * The start of the name a padding row gets when it opens on an ITE image, which
 * the help lookup keys on as well.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.paddingNamePrefix
 */
export const ITE_PADDING_NAME_PREFIX = "EC firmware (";

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.candidates */
const CANDIDATES = [0x40, 0x80] as const;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.blockSize */
const BLOCK_SIZE = 0x10;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.identificationSize */
const IDENTIFICATION_SIZE = 0x10;

/**
 * The identification of an image starting at `start`, or nothing when no
 * signature block is where one would be.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.read
 */
export function readITEFirmware(
  start: number,
  limit: number,
  reader: ImageReader
): ITEFirmware | undefined {
  for (const offset of CANDIDATES) {
    const at = start + offset;
    if (at + BLOCK_SIZE + IDENTIFICATION_SIZE > limit) continue;
    const block = reader.bytesAt(at, BLOCK_SIZE);
    if (block === undefined || !isSignature(block)) continue;
    const text = reader.bytesAt(at + BLOCK_SIZE, IDENTIFICATION_SIZE);
    if (text === undefined) continue;
    const printable = text.findIndex((byte) => byte < 0x20 || byte >= 0x7f);
    const run = printable < 0 ? text : text.subarray(0, printable);
    const identification = String.fromCharCode(...run).trim();
    if (identification === "") continue;
    return { identification, start, signatureOffset: offset };
  }
  return undefined;
}

/**
 * Every ITE image in `range`, at each 4 KiB boundary — a region can hold more
 * than one: an EC image and a second controller's, or two copies.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.all
 */
export function allITEFirmware(range: ImageRange, reader: ImageReader): ITEFirmware[] {
  const found: ITEFirmware[] = [];
  for (let start = range.start; start < range.end; start += 0x1000) {
    const image = readITEFirmware(start, range.end, reader);
    if (image !== undefined) found.push(image);
  }
  return found;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#ITEFirmware.isSignature */
function isSignature(block: Uint8Array): boolean {
  const rest = [0x85, 0x12, 0x5a, 0x5a, 0xaa];
  return (
    block.length === BLOCK_SIZE &&
    block.subarray(0, 6).every((byte) => byte === 0xa5) &&
    rest.every((byte, index) => block[8 + index] === byte) &&
    block[14] === 0x55 &&
    block[15] === 0x55
  );
}

/**
 * `nodes` with every stretch of padding — or EC Firmware region — that opens on
 * an ITE image named by the identification it carries
 * (`UEFI_IMAGE_FORMAT.md` §9). The bytes stay what they were; only the name says
 * what they look like.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/ITEFirmware.swift#Parser.namingECFirmware
 */
export function namingECFirmware(parser: Parser, nodes: readonly UEFINode[]): UEFINode[] {
  return nodes.map((node) => {
    const candidate =
      (node.kind === "padding" && !node.isErased) ||
      (node.kind === "flashDeviceMapRegion" &&
        node.guid !== undefined &&
        guidEquals(node.guid, FlashDeviceMap.ecFirmware));
    if (!candidate) return node;
    const range = nodeRange(node);
    const firmware = readITEFirmware(range.start, range.end, parser.reader);
    if (firmware === undefined) return node;
    return {
      ...node,
      name:
        node.kind === "padding"
          ? `${ITE_PADDING_NAME_PREFIX}${firmware.identification})`
          : `${node.name} (${firmware.identification})`,
    };
  });
}
