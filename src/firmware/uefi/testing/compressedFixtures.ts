/**
 * The compressed bodies the compressed-section tests open, in the layouts EDK2
 * writes: an LZMA stream behind its thirteen-byte header, and a Tiano or EFI 1.1
 * stream behind its compressed and original sizes.
 *
 * Generated once from the bodies this project's own `testing/testImage.ts`
 * builds — LZMA with Python's `lzma` module, LZMA with the x86 filter with
 * `FILTER_X86` before it, and Tiano and EFI 1.1 with EDK2's own compressor, the
 * one upstream vendors under `Sources/CTianoEncoder`. Upstream encodes these in
 * the test itself; the web edition decompresses only (GAPS.md G5), so the
 * streams are checked in and the bodies beside them say what has to come back
 * out.
 */

import * as Test from "@/firmware/testing/testImage";
import { BinaryWriter } from "@/firmware/testing/testImage";
import { alignUp } from "@/firmware/uefi/checksums";

/** A run of sections as a file body lays them out, four-byte aligned. */
export function sectionsBody(list: readonly Uint8Array[]): Uint8Array {
  const body = new BinaryWriter();
  for (const one of list) {
    body.pad(alignUp(body.count, 4) ?? body.count, 0xff);
    body.raw(one);
  }
  return body.bytes;
}

/** What most compressed sections hold: a driver's name and its image. */
export function driverBody(): Uint8Array {
  const image = new Uint8Array(40);
  image.set([0xe8, 0x10, 0x00, 0x00, 0x00]);
  image.fill(0xcc, 5);
  return sectionsBody([Test.nameSection("InnerDriver"), Test.section({ type: 0x10, body: image })]);
}

/** One name section: the smallest body a section walk can find something in. */
export const nameBody = (): Uint8Array => Test.nameSection("InnerDriver");

/** A section of a type nothing knows — a diagnostic raised inside a buffer. */
export const unknownTypeBody = (): Uint8Array =>
  sectionsBody([Test.section({ type: 0x1a, body: Uint8Array.from([1, 2, 3, 4]) })]);

/** The hex above as bytes. */
export function streamBytes(lines: readonly string[]): Uint8Array {
  const text = lines.join("");
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** LZMA, over the name section and a PE32 image, with a `call` in it for the x86 filter to undo. */
export const DRIVER_LZMA: readonly string[] = [
  "5d000001004800000000000000000e002f2b1d22fddd6253eb6d6074199481461701e81af5c845269f5bfc93cedc",
  "83ffffc9d70000",
];

/** LZMA with the x86 filter, over the name section and a PE32 image, with a `call` in it for the x86 filter to undo. */
export const DRIVER_LZMA_X86: readonly string[] = [
  "5d000001004800000000000000000e002f2b1d22fddd6253eb6d6074199481461701e81af5c84650e61bfc93cedc",
  "83ffffc9d70000",
];

/** TIANO, over the name section and a PE32 image, with a `call` in it for the x86 filter to undo. */
export const DRIVER_TIANO: readonly string[] = [
  "2f00000048000000001d4549b1a907ccc0e0e3240781c81e02060203241903c80fbd2088ada06c0f2697c1b215c9",
  "5e30b83759073f8000",
];

/** EFI11, over the name section and a PE32 image, with a `call` in it for the x86 filter to undo. */
export const DRIVER_EFI11: readonly string[] = [
  "2f00000048000000001d4549b1a907ccc0e0e3240781c81e02060203241903c80fbd20895b40d81e4d2f83642b92",
  "bc61706eb20e7f0000",
];

/** LZMA, over one name section — the smallest thing a section walk can find. */
export const NAME_LZMA: readonly string[] = [
  "5d000001001c00000000000000000e002f2b1d22fddd6253eb6d607419948146170236385bffffcbfa0000",
];

/** LZMA with the x86 filter, over one name section — the smallest thing a section walk can find. */
export const NAME_LZMA_X86: readonly string[] = [
  "5d000001001c00000000000000000e002f2b1d22fddd6253eb6d607419948146170236385bffffcbfa0000",
];

/** TIANO, over one name section — the smallest thing a section walk can find. */
export const NAME_TIANO: readonly string[] = [
  "210000001c00000000143d4db0c0ff8008d8268580e810a040c75ef0a1109c1a4c551a426cefd80000",
];

/** EFI11, over one name section — the smallest thing a section walk can find. */
export const NAME_EFI11: readonly string[] = [
  "200000001c00000000143d4db0c0ff8008d8268580e810a040c75ef14221383498aa3484d9dfb000",
];

/** LZMA, over one section of a type nothing knows, to raise a diagnostic inside a buffer. */
export const UNKNOWN_LZMA: readonly string[] = [
  "5d00000100080000000000000000040030cf79e94ba7a284cbffffd4f80000",
];

/** LZMA with the x86 filter, over one section of a type nothing knows, to raise a diagnostic inside a buffer. */
export const UNKNOWN_LZMA_X86: readonly string[] = [
  "5d00000100080000000000000000040030cf79e94ba7a284cbffffd4f80000",
];

/** TIANO, over one section of a type nothing knows, to raise a diagnostic inside a buffer. */
export const UNKNOWN_TIANO: readonly string[] = ["0e00000008000000000830414437840b80060e9ca000"];

/** EFI11, over one section of a type nothing knows, to raise a diagnostic inside a buffer. */
export const UNKNOWN_EFI11: readonly string[] = ["0e00000008000000000830414437840b80183a728000"];

/** LZMA, over a volume image holding an LZMA section — the nested case's outer body. */
export const NESTED_OUTER_LZMA: readonly string[] = [
  "5d000001000408000000000000000202512b19ef4eff569a69b623c61ffac16abd5a849cb31da8290150fadd6fe6",
  "fc33b6a4cd75a02ec260cb2f527d27d1be68e923ca451405999bc702ed59698e9f5d546a5be57d483601ecc54b81",
  "ac79a453101fb24ac6b0787ec0c100a6b1d4a0c38716121846f3e7fbc6abde9e7870fe2c643008cc459a549aab93",
  "21bc28c46f7062e4b8c59ffa5aca00",
];
