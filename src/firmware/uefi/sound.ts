import { L } from "@/core/localization/localization";
import type { ImageReader } from "@/firmware/imageReader";
import type { Parser } from "@/firmware/uefi/parserState";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * A sound kept in a firmware image: a WAV file, as ASUS keeps the sound its boards play
 * on POST — the whole body of a Freeform file, where a body of sections would be
 * (`UEFI_IMAGE_FORMAT.md` §9).
 *
 * Recognised by its opening and taken only when its chunks read through to the format
 * chunk and the data, which is also where its length and what it plays come from.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound
 */
export interface Sound {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.range */
  readonly range: { readonly start: number; readonly end: number };
  /** The format chunk's `wFormatTag`: `1` is PCM. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.encoding */
  readonly encoding: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.channels */
  readonly channels: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.sampleRate */
  readonly sampleRate: number;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.bitsPerSample */
  readonly bitsPerSample: number;
  /** The data chunk's length, in bytes. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.dataLength */
  readonly dataLength: number;
  /** Bytes per second, as the format chunk states it. */
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.byteRate */
  readonly byteRate: number;
}

/**
 * The encodings a firmware's WAV is likely to use, by the names RIFF gives them; any
 * other keeps its number.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.encodingName
 */
export function soundEncodingName(sound: Sound): string {
  switch (sound.encoding) {
    case 0x0001:
      return "PCM";
    case 0x0002:
      return "ADPCM";
    case 0x0003:
      return "IEEE float";
    case 0x0006:
      return "A-law";
    case 0x0007:
      return "µ-law";
    case 0x0011:
      return "IMA ADPCM";
    case 0xfffe:
      return "Extensible";
    default:
      return `0x${sound.encoding.toString(16).toUpperCase().padStart(4, "0")}`;
  }
}

/**
 * How long it plays, in seconds; nothing when the format chunk states no rate.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.duration
 */
export const soundDuration = (sound: Sound): number | undefined =>
  sound.byteRate === 0 ? undefined : sound.dataLength / sound.byteRate;

/**
 * The format and the sample rate, in the words of the language running.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.name
 */
export function soundName(sound: Sound): string {
  switch (sound.channels) {
    case 1:
      return L("WAV, %1$@ Hz, mono", `${sound.sampleRate}`);
    case 2:
      return L("WAV, %1$@ Hz, stereo", `${sound.sampleRate}`);
    default:
      return L("WAV, %1$@ Hz, %2$@ channels", `${sound.sampleRate}`, `${sound.channels}`);
  }
}

// RIFF's chunk ids, as the scan reads a dword.
/** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.riff */
const RIFF = 0x46464952; // "RIFF"
/** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.wave */
const WAVE = 0x45564157; // "WAVE"
/** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.format */
const FORMAT = 0x20746d66; // "fmt "
/** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.data */
const DATA = 0x61746164; // "data"
/** @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.maxChunks */
const MAX_CHUNKS = 64;

/**
 * The WAV file starting at `start` and ending at or before `limit`, or nothing when what
 * is there is not one: a RIFF header naming `WAVE`, a size that fits, and a format chunk
 * and a data chunk among the chunks it holds.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Sound.read
 */
export function readSound(start: number, limit: number, reader: ImageReader): Sound | undefined {
  if (reader.uint32(start) !== RIFF || reader.uint32(start + 8) !== WAVE) return undefined;
  const riffSize = reader.uint32(start + 4);
  if (riffSize === undefined || riffSize < 4) return undefined;
  // A chunk's data is padded to an even length, and so is the file. A RIFF size claiming
  // more than is there ends the file where the bytes do: the G733PYV's says four bytes
  // more than its file holds, its data chunk whole before them.
  const end = Math.min(start + 8 + riffSize + (riffSize & 1), limit, reader.count);
  if (end < start + 12) return undefined;

  let format:
    | { encoding: number; channels: number; rate: number; byteRate: number; bits: number }
    | undefined;
  let dataLength: number | undefined;
  let at = start + 12;
  for (let chunk = 0; chunk < MAX_CHUNKS && at + 8 <= end; chunk++) {
    const id = reader.uint32(at);
    const size = reader.uint32(at + 4);
    if (id === undefined || size === undefined) return undefined;
    const body = at + 8;
    if (body + size > end) return undefined;
    if (id === FORMAT && size >= 16) {
      const encoding = reader.uint16(body);
      const channels = reader.uint16(body + 2);
      const rate = reader.uint32(body + 4);
      const byteRate = reader.uint32(body + 8);
      const bits = reader.uint16(body + 14);
      if (
        encoding !== undefined &&
        channels !== undefined &&
        rate !== undefined &&
        byteRate !== undefined &&
        bits !== undefined
      ) {
        format = { encoding, channels, rate, byteRate, bits };
      }
    } else if (id === DATA) {
      dataLength = size;
    }
    at = body + size + (size & 1);
  }
  if (
    format === undefined ||
    dataLength === undefined ||
    format.channels === 0 ||
    format.rate === 0
  ) {
    return undefined;
  }
  return {
    range: { start, end },
    encoding: format.encoding,
    channels: format.channels,
    sampleRate: format.rate,
    bitsPerSample: format.bits,
    dataLength,
    byteRate: format.byteRate,
  };
}

/**
 * A sound at `offset`, as a row of its own; nothing when there is none.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/Sound.swift#Parser.parseSound
 */
export function parseSound(parser: Parser, offset: number, limit: number): UEFINode | undefined {
  const sound = readSound(offset, limit, parser.reader);
  if (sound === undefined) return undefined;
  return makeNode({
    kind: "sound",
    name: soundName(sound),
    header: { start: sound.range.start, end: sound.range.start },
    body: sound.range,
  });
}
