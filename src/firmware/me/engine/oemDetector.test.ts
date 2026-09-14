import { describe, expect, it } from "vitest";
import { oemCustomized } from "@/firmware/me/engine/oemDetector";
import type { FPTPartition, FPTResult } from "@/firmware/me/layout/fpt";
import type { BootPartition, CodePartition } from "@/firmware/me/models/firmwareAnalysis";

/**
 * Row 14's OEM Configuration. Ported from upstream's `OEMDetectorTests`: each
 * test drives one fact to one side with the exact bytes that fact reads, so a
 * false "Yes" from a misread placeholder cannot pass.
 */

const fpt = (partitions: readonly FPTPartition[]): FPTResult => ({
  headerVersion: 0x20,
  resolvedVersion: 0x20,
  fptStart: 0,
  fitMajor: 0,
  fitMinor: 0,
  fitHotfix: 0,
  fitBuild: 0,
  partitions,
  cseLayout: undefined,
});

const partition = (name: string, offset: number, size: number): FPTPartition => ({
  name,
  offset,
  size,
  flags: 0,
  empty: false,
});

const boot = (entries: BootPartition["entries"]): BootPartition => ({
  partitionName: "Boot 1",
  offset: 0x1000,
  version: 2,
  redundancy: true,
  checksumValid: true,
  fit: undefined,
  entries,
});

/**
 * A code partition at 0x2000 whose `oem.key` sits 0x800 into it — absolute
 * 0x2800, which with a base of 0x1000 is region offset 0x1800.
 */
const codePartition = (moduleOffset = 0x2800): CodePartition => ({
  name: "FTPR",
  offset: 0x2000,
  headerVersion: 1,
  headerLength: 0x10,
  numModules: 1,
  checksumValid: true,
  modules: [{ name: "oem.key", offset: moduleOffset, size: 0x100, isHuffman: false }],
  extensions: [],
});

/** The Intel placeholder key's opening sixteen bytes. */
function placeholder(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes[0] = 0xcb;
  bytes[1] = 0xbc;
  bytes.set(
    Uint8Array.from("$MN2", (one) => one.charCodeAt(0)),
    12
  );
  return bytes;
}

/** Zero-filled, so nothing trips the erased-head guard. */
const live = () => new Uint8Array(0x4000);

const detect = (options: Partial<Parameters<typeof oemCustomized>[0]>) =>
  oemCustomized({
    fpt: undefined,
    bootPartitions: undefined,
    codePartition: undefined,
    bytes: live(),
    baseOffset: 0,
    ...options,
  });

describe("the partition scan", () => {
  it("counts a non-empty UTOK in the $FPT", () => {
    expect(detect({ fpt: fpt([partition("UTOK", 0x1000, 0x100)]) })).toBe(true);
  });

  it("counts a real OEMP in the $FPT", () => {
    expect(detect({ fpt: fpt([partition("OEMP", 0x1000, 0x100)]) })).toBe(true);
  });

  it("does not count an OEMP that opens with the placeholder", () => {
    const bytes = live();
    bytes.set(placeholder(), 0x1000);
    expect(detect({ fpt: fpt([partition("OEMP", 0x1000, 0x100)]), bytes })).toBe(false);
  });

  it("does not count a UTOK whose head is erased", () => {
    expect(
      detect({
        fpt: fpt([partition("UTOK", 0x1000, 0x100)]),
        bytes: new Uint8Array(0x4000).fill(0xff),
      })
    ).toBe(false);
  });

  it("counts a UTOK inside a boot partition's table", () => {
    expect(
      detect({
        bootPartitions: [
          boot([{ name: "UTOK", type: 0, offset: 0x2000, size: 0x100, empty: false }]),
        ],
        baseOffset: 0x1000,
      })
    ).toBe(true);
  });
});

describe("the oem.key module", () => {
  it("counts a real key", () => {
    expect(detect({ codePartition: codePartition(), baseOffset: 0x1000 })).toBe(true);
  });

  it("does not count the placeholder key", () => {
    const bytes = live();
    bytes.set(placeholder(), 0x1800);
    expect(detect({ codePartition: codePartition(), bytes, baseOffset: 0x1000 })).toBe(false);
  });

  it("does not count a key whose body lies past the region", () => {
    expect(detect({ codePartition: codePartition(0xa000), baseOffset: 0x1000 })).toBe(false);
  });
});

describe("a stock image", () => {
  it("reads false with no OEM facts at all", () => {
    expect(detect({ fpt: fpt([]), bootPartitions: [] })).toBe(false);
  });
});
