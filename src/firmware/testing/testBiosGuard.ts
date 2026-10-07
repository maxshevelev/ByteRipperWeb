import { BinaryWriter } from "@/firmware/testing/testImage";

/** One line of a test update's table: what it is called, its switch, and its blocks' data. */
export interface BiosGuardLine {
  readonly key: string;
  readonly name: string;
  readonly blocks: readonly Uint8Array[];
}

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

/**
 * A file laid out as ASUS's `X1704VAPF.306` is: header, table, blocks with a short script and
 * an RSA-2048 signature unless asked otherwise, and whatever the vendor appends after them.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/BIOSGuardUpdateTests.swift#BIOSGuardUpdateTests.file
 */
export function biosGuardFile(
  lines: readonly BiosGuardLine[],
  options: {
    readonly platform?: string;
    readonly signature?: number;
    readonly signed?: boolean;
    readonly tail?: Uint8Array;
  } = {}
): Uint8Array {
  const { platform = "RAPTORLAKE", signature = 0x20c, signed = true, tail } = options;
  let text = "AMI_BIOS_GUARD_FLASH_CONFIGURATIONSII00010000\r\n";
  for (const line of lines) text += `1 ${line.key} ${line.blocks.length} ;${line.name}\r\n`;
  const w = new BinaryWriter();
  w.u32(0x11 + text.length)
    .u32(0xd814)
    .raw(ascii("_AMIPFAT"))
    .u8(0x63)
    .raw(ascii(text));
  for (const data of lines.flatMap((line) => line.blocks)) {
    const id = ascii(platform);
    w.u16(2)
      .u16(0)
      .raw(id)
      .fill(16 - id.length, 0);
    w.u32(signed ? 0x0d : 0x0c)
      .u16(2)
      .u16(0)
      .u32(0x20)
      .u32(data.length)
      .u32(0x57000)
      .u32(0xffff_ffff)
      .u32(0);
    w.fill(0x20, 0x51).raw(data);
    if (signed)
      w.u32(1)
        .u32(1)
        .fill(signature - 8, 0xa5);
  }
  if (tail !== undefined) w.raw(tail);
  return w.bytes;
}

export const block = (byte: number, count: number): Uint8Array => new Uint8Array(count).fill(byte);
