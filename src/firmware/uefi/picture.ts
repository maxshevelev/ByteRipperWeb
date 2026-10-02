import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * A picture kept in a firmware image (`UEFI_IMAGE_FORMAT.md` §9): a JPEG, PNG, GIF
 * or BMP — the boot logo, the setup screen's icons, a vendor's splash. Found where
 * the raw-area scan meets one outside every volume, and as the body of a raw
 * section, where most of them are.
 *
 * Recognised by each format's own opening and taken only when its structure can be
 * read to its end, which is also what gives its length: a JPEG's segments to the
 * end marker, a PNG's chunks to `IEND`, a GIF's blocks to the trailer, a BMP's
 * header and the size it declares.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture
 */
export interface Picture {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.format */
  readonly format: PictureFormat;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.range */
  readonly range: ImageRange;
  /**
   * What the format says of itself beyond its name: `JFIF` or `Exif`, the GIF
   * version, a BMP's bits per pixel. Nothing for a PNG.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.variant
   */
  readonly variant?: string | undefined;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.width */
  readonly width: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.height */
  readonly height: number;
  /**
   * A BMP that declares more bytes than the space holding it has. Its range is what
   * there is; the bytes past it are missing from the image.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.declaredLength
   */
  readonly declaredLength?: number | undefined;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.Format */
export const PICTURE_FORMATS = { jpeg: 1, png: 2, gif: 3, bmp: 4 } as const;
export type PictureFormat = keyof typeof PICTURE_FORMATS;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.Format.init */
export function pictureFormatOf(type: number): PictureFormat | undefined {
  return (Object.keys(PICTURE_FORMATS) as PictureFormat[]).find(
    (format) => PICTURE_FORMATS[format] === type
  );
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.Format.name */
export const pictureFormatName = (format: PictureFormat): string => format.toUpperCase();

/**
 * What a file of this format is called, for a picture saved as one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.Format.fileExtension
 */
export const pictureFileExtension = (format: PictureFormat): string =>
  format === "jpeg" ? "jpg" : format;

/**
 * The format and the size in pixels, the same in every language.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.name
 */
export const pictureName = (picture: Picture): string =>
  `${pictureFormatName(picture.format)} ${picture.width}×${picture.height}`;

/**
 * How a format opens, as the scan reads a dword. A BMP opens with two bytes, `BM`,
 * and the next two are its size's.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.jfifSignature
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.exifSignature
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.pngSignature
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.gifSignature
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.bmpSignature
 */
export const PICTURE_SIGNATURES = {
  jfif: 0xe0ff_d8ff,
  exif: 0xe1ff_d8ff,
  png: 0x474e_5089,
  gif: 0x3846_4947,
  bmp: 0x4d42,
} as const;

/** Whether the dword the scan read opens a picture. */
export const opensPicture = (dword: number): boolean =>
  dword === PICTURE_SIGNATURES.jfif ||
  dword === PICTURE_SIGNATURES.exif ||
  dword === PICTURE_SIGNATURES.png ||
  dword === PICTURE_SIGNATURES.gif ||
  (dword & 0xffff) === PICTURE_SIGNATURES.bmp;

/** Larger than any picture a firmware keeps: a walk past it is not one. */
const LARGEST = 0x100_0000;
const LARGEST_SIDE = 0x4000;
const MAX_BLOCKS = 0x1_0000;
/** What every format's opening needs before anything else is read. */
const HEAD = 34;

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));
const matches = (bytes: Uint8Array, at: number, expected: readonly number[]): boolean =>
  expected.every((byte, index) => bytes[at + index] === byte);

const bigEndian16 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const bigEndian32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) * 0x100_0000 +
  (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
const littleEndian16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const littleEndian32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) +
  (bytes[at + 1] ?? 0) * 0x100 +
  (bytes[at + 2] ?? 0) * 0x1_0000 +
  (bytes[at + 3] ?? 0) * 0x100_0000;

/**
 * The picture starting at `start` and ending at or before `limit`, or nothing when
 * what is there is not a whole one. `allowingTruncation` takes a BMP whose declared
 * size runs past `limit` as far as `limit` — for the body of a raw section, which
 * is the picture whether or not it is whole.
 *
 * The opening of each format is checked on its first bytes before the rest is read:
 * a BMP announces itself in two, and a scan that read sixteen megabytes for each
 * `BM` it met in code would be reading the image over and over.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.read
 */
export function readPicture(
  start: number,
  limit: number,
  reader: ImageReader,
  allowingTruncation = false
): Picture | undefined {
  const end = Math.min(limit, start + LARGEST, reader.count);
  if (start + 16 > end) return undefined;
  const head = reader.bytesAt(start, Math.min(HEAD, end - start));
  if (head === undefined) return undefined;
  const available = end - start;

  let found: Picture | undefined;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    found = isJpegOpening(head) ? jpeg(reader.bytesAt(start, available)) : undefined;
  } else if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e) {
    found = isPngOpening(head) ? png(reader.bytesAt(start, available)) : undefined;
  } else if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
    found = isGifOpening(head) ? gif(reader.bytesAt(start, available)) : undefined;
  } else if (head[0] === 0x42 && head[1] === 0x4d) {
    found = bmp(head, available, allowingTruncation);
  }
  if (
    found === undefined ||
    found.width <= 0 ||
    found.height <= 0 ||
    found.width > LARGEST_SIDE ||
    found.height > LARGEST_SIDE
  ) {
    return undefined;
  }
  return {
    ...found,
    range: { start: start + found.range.start, end: start + found.range.end },
  };
}

// MARK: - JPEG

const jpegVariant = (bytes: Uint8Array): string | undefined => {
  if (bytes[3] === 0xe0 && matches(bytes, 6, [...ascii("JFIF"), 0])) return "JFIF";
  if (bytes[3] === 0xe1 && matches(bytes, 6, [...ascii("Exif"), 0])) return "Exif";
  return undefined;
};
const isJpegOpening = (head: Uint8Array): boolean =>
  head.length >= 11 && jpegVariant(head) !== undefined;

/**
 * `FF D8 FF`, then an `APP0` `JFIF` or an `APP1` `Exif` segment; the segments
 * walked to the end marker.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.jpeg
 */
function jpeg(bytes: Uint8Array | undefined): Picture | undefined {
  if (bytes === undefined) return undefined;
  const variant = jpegVariant(bytes);
  if (variant === undefined) return undefined;

  let size: { readonly width: number; readonly height: number } | undefined;
  let at = 2;
  for (let block = 0; block < MAX_BLOCKS; block++) {
    // A marker, after any number of fill bytes.
    if (at + 1 >= bytes.length || bytes[at] !== 0xff) return undefined;
    while (at + 1 < bytes.length && bytes[at + 1] === 0xff) at += 1;
    if (at + 1 >= bytes.length) return undefined;
    const marker = bytes[at + 1] as number;
    if (marker === 0xd9) {
      if (size === undefined) return undefined;
      return {
        format: "jpeg",
        range: { start: 0, end: at + 2 },
        variant,
        width: size.width,
        height: size.height,
      };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) return undefined;
    const length = bigEndian16(bytes, at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return undefined;
    // A start-of-frame segment: precision, then height and width.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      length >= 7
    ) {
      size = { width: bigEndian16(bytes, at + 7), height: bigEndian16(bytes, at + 5) };
    }
    at += 2 + length;
    // After a start of scan, the coded data runs to the next marker that is
    // neither a stuffed `FF 00` nor a restart.
    if (marker === 0xda) {
      while (at + 1 < bytes.length) {
        const next = bytes[at + 1] as number;
        if (bytes[at] === 0xff && next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) break;
        at += 1;
      }
    }
  }
  return undefined;
}

// MARK: - PNG

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPngOpening = (head: Uint8Array): boolean =>
  head.length >= 33 &&
  matches(head, 0, PNG_SIGNATURE) &&
  bigEndian32(head, 8) === 13 &&
  matches(head, 12, ascii("IHDR"));

/**
 * The eight-byte signature, `IHDR` first, then chunks — a big-endian length, a
 * type, the data and a CRC — to `IEND`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.png
 */
function png(bytes: Uint8Array | undefined): Picture | undefined {
  if (bytes === undefined || !isPngOpening(bytes)) return undefined;
  const width = bigEndian32(bytes, 16);
  const height = bigEndian32(bytes, 20);
  let at = 8;
  for (let block = 0; block < MAX_BLOCKS; block++) {
    if (at + 12 > bytes.length) return undefined;
    const length = bigEndian32(bytes, at);
    const isEnd = matches(bytes, at + 4, ascii("IEND"));
    if (length > bytes.length - at - 12) return undefined;
    at += 12 + length;
    if (isEnd) return { format: "png", range: { start: 0, end: at }, width, height };
  }
  return undefined;
}

// MARK: - GIF

const isGifOpening = (head: Uint8Array): boolean =>
  head.length >= 11 &&
  matches(head, 0, ascii("GIF8")) &&
  (head[4] === 0x37 || head[4] === 0x39) &&
  head[5] === 0x61;

/**
 * How many bytes the colour table a GIF's flags byte announces takes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.colourTable
 */
const colourTable = (flags: number): number =>
  (flags & 0x80) === 0 ? 0 : 3 << ((flags & 0x07) + 1);

/**
 * `GIF87a` or `GIF89a`, the screen descriptor and its colour table, then extensions
 * and images — each a run of sub-blocks ending in a zero — to the trailer.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.gif
 */
function gif(bytes: Uint8Array | undefined): Picture | undefined {
  if (bytes === undefined || !isGifOpening(bytes)) return undefined;
  const width = littleEndian16(bytes, 6);
  const height = littleEndian16(bytes, 8);
  let at = 13 + colourTable(bytes[10] ?? 0);

  /** Steps over sub-blocks up to and past their terminating zero. */
  const subBlocks = (): boolean => {
    while (at < bytes.length) {
      const size = bytes[at] as number;
      at += 1 + size;
      if (size === 0) return at <= bytes.length;
    }
    return false;
  };

  for (let block = 0; block < MAX_BLOCKS; block++) {
    if (at >= bytes.length) return undefined;
    switch (bytes[at]) {
      case 0x3b:
        return {
          format: "gif",
          range: { start: 0, end: at + 1 },
          variant: String.fromCharCode(...bytes.subarray(3, 6)),
          width,
          height,
        };
      case 0x21:
        at += 2;
        if (!subBlocks()) return undefined;
        break;
      case 0x2c:
        if (at + 10 >= bytes.length) return undefined;
        at += 10 + colourTable(bytes[at + 9] ?? 0) + 1; // the LZW code size
        if (!subBlocks()) return undefined;
        break;
      default:
        return undefined;
    }
  }
  return undefined;
}

// MARK: - BMP

/**
 * The file header — `BM`, the size, two reserved words, where the pixels start —
 * then a DIB header of a size Windows defines, one plane and a depth it allows; an
 * uncompressed one must hold the rows it says. Read off the first bytes alone: a
 * BMP's length is the one it declares.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Picture.bmp
 */
function bmp(
  head: Uint8Array,
  available: number,
  allowingTruncation: boolean
): Picture | undefined {
  if (head.length < 30) return undefined;
  const declared = littleEndian32(head, 2);
  const pixels = littleEndian32(head, 10);
  const dib = littleEndian32(head, 14);
  if (
    littleEndian32(head, 6) !== 0 ||
    ![12, 40, 52, 56, 64, 108, 124].includes(dib) ||
    pixels < 14 + dib ||
    pixels >= declared
  ) {
    return undefined;
  }
  let width: number;
  let height: number;
  let bits: number;
  let compression = 0;
  if (dib === 12) {
    width = littleEndian16(head, 18);
    height = littleEndian16(head, 20);
    if (littleEndian16(head, 22) !== 1) return undefined;
    bits = littleEndian16(head, 24);
  } else {
    if (head.length < 34) return undefined;
    const signedWidth = littleEndian32(head, 18) | 0;
    const signedHeight = littleEndian32(head, 22) | 0;
    if (
      signedWidth <= 0 ||
      signedHeight === 0 ||
      signedHeight === -0x8000_0000 ||
      littleEndian16(head, 26) !== 1
    ) {
      return undefined;
    }
    width = signedWidth;
    height = Math.abs(signedHeight);
    bits = littleEndian16(head, 28);
    compression = littleEndian32(head, 30);
  }
  if (![1, 2, 4, 8, 16, 24, 32].includes(bits) || compression > 6) return undefined;
  // Uncompressed rows are padded to four bytes: the size has to hold them.
  if (compression === 0) {
    const row = Math.floor((width * bits + 31) / 32) * 4;
    if (pixels + row * height > declared) return undefined;
  }
  const variant = `${bits}-bit`;
  if (declared <= available) {
    return { format: "bmp", range: { start: 0, end: declared }, variant, width, height };
  }
  if (!allowingTruncation || pixels >= available) return undefined;
  return {
    format: "bmp",
    range: { start: 0, end: available },
    variant,
    width,
    height,
    declaredLength: declared,
  };
}

/**
 * A picture, as the raw-area scan's element: padding to UEFITool, which does not
 * look for one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Parser.parsePicture
 */
export function parsePicture(parser: Parser, offset: number, limit: number): UEFINode | undefined {
  const picture = readPicture(offset, limit, parser.reader);
  return picture === undefined ? undefined : pictureNode(picture);
}

/**
 * A raw section's body read as the picture it starts with — the way nearly every
 * logo and icon is kept — and whatever follows it as padding; nothing when it does
 * not start with one.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Parser.pictureBody
 */
export function pictureBody(
  parser: Parser,
  body: ImageRange,
  emptyByte: number
): UEFINode[] | undefined {
  const picture = readPicture(body.start, body.end, parser.reader, true);
  if (picture === undefined) return undefined;
  return [pictureNode(picture), ...parser.padding(picture.range.end, body.end, emptyByte)];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/Picture.swift#Parser.pictureNode */
function pictureNode(picture: Picture): UEFINode {
  return makeNode({
    kind: "picture",
    subtype: PICTURE_FORMATS[picture.format],
    name: pictureName(picture),
    header: { start: picture.range.start, end: picture.range.start },
    body: picture.range,
  });
}
