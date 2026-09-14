import { u16, u32 } from "@/firmware/me/bytes";
import type { RBEPMMetadata, RBEPMVariant } from "@/firmware/me/models/independentFacts";

/**
 * The FTPR `pm` / RBEP `rbe` module's metadata table — upstream
 * `get_rbe_pm_met`, over the module's decompressed body.
 *
 * The table is a run of rows each opening with `Unknown0`, a device id and
 * Intel's vendor id 0x8086. It is found by three consecutive `86 80` vendor ids at
 * one spacing, and which spacing matches picks the struct, tried in upstream's
 * order: R1 (0x48, SHA-256, extended), R2 (0x30, SHA-256), R3 (0x58, SHA-384,
 * extended), R4 (0x40, SHA-384). From the first row, every contiguous row whose
 * vendor id is again 0x8086 is taken.
 *
 * Ported from `Packages/MEFirmware/Partition/RBEPM.swift`.
 */

interface Layout {
  readonly variant: RBEPMVariant;
  readonly stride: number;
  /** The bytes between one vendor id's `80` and the next one's `86`. */
  readonly gap: number;
  readonly hashOffset: number;
  readonly hashLength: number;
  readonly extended: boolean;
}

const LAYOUTS: readonly Layout[] = [
  { variant: "r1", stride: 0x48, gap: 70, hashOffset: 0x28, hashLength: 0x20, extended: true },
  { variant: "r2", stride: 0x30, gap: 46, hashOffset: 0x10, hashLength: 0x20, extended: false },
  { variant: "r3", stride: 0x58, gap: 86, hashOffset: 0x28, hashLength: 0x30, extended: true },
  { variant: "r4", stride: 0x40, gap: 62, hashOffset: 0x10, hashLength: 0x30, extended: false },
];

/** The table's rows, or nothing when none of the four spacings matches. */
export function decodeRbePmMetadata(body: Uint8Array): RBEPMMetadata[] | undefined {
  for (const layout of LAYOUTS) {
    const first = firstEntry(layout, body);
    if (first === undefined) continue;
    const entries: RBEPMMetadata[] = [];
    for (
      let row = first;
      row + layout.stride <= body.length && body[row + 6] === 0x86 && body[row + 7] === 0x80;
      row += layout.stride
    ) {
      entries.push(decodeEntry(body, row, layout));
    }
    return entries.length === 0 ? undefined : entries;
  }
  return undefined;
}

/** The first vendor id with two more at the layout's spacing; its row starts six bytes earlier. */
function firstEntry(layout: Layout, body: Uint8Array): number | undefined {
  const patternEnd = 6 + 2 * layout.gap;
  if (body.length < patternEnd) return undefined;
  const vendorAt = (at: number) => body[at] === 0x86 && body[at + 1] === 0x80;
  for (let at = 6; at <= body.length - patternEnd; at++) {
    if (vendorAt(at) && vendorAt(at + layout.gap + 2) && vendorAt(at + 2 * layout.gap + 4)) {
      return at - 6;
    }
  }
  return undefined;
}

function decodeEntry(body: Uint8Array, base: number, layout: Layout): RBEPMMetadata {
  const extended = (offset: number) => (layout.extended ? u32(body, base + offset) : undefined);
  // The digest read as one little-endian integer: its bytes, reversed, in hex.
  let hash = "";
  for (let index = layout.hashLength - 1; index >= 0; index--) {
    hash += (body[base + layout.hashOffset + index] ?? 0)
      .toString(16)
      .toUpperCase()
      .padStart(2, "0");
  }
  return {
    variant: layout.variant,
    unknown0: u32(body, base),
    deviceID: u16(body, base + 0x04),
    vendorID: u16(body, base + 0x06),
    sizeUncompressed: u32(body, base + 0x08),
    sizeCompressed: u32(body, base + 0x0c),
    bssSize: extended(0x10),
    codeSizeUncompressed: extended(0x14),
    codeBaseAddress: extended(0x18),
    mainThreadEntry: extended(0x1c),
    unknown1: extended(0x20),
    unknown2: extended(0x24),
    hash,
  };
}
