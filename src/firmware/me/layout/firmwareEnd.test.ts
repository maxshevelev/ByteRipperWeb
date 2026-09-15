import { describe, expect, it } from "vitest";
import { firmwareSize } from "@/firmware/me/layout/firmwareEnd";
import type { FPTPartition } from "@/firmware/me/layout/fpt";
import type { LayoutInfo, LayoutSlot } from "@/firmware/me/layout/ifwi";

/**
 * Row 18's Size — how far the firmware reaches from its `$FPT`, which is not how
 * big the buffer around it is. Ported from upstream's `FirmwareEndTests`; the
 * CSME 12 case is the real dump's own numbers.
 */

const part = (name: string, offset: number, size: number, empty = false): FPTPartition => ({
  name,
  offset,
  size,
  flags: 0,
  empty,
});

const slot = (name: string, offset: number, size: number, empty = false): LayoutSlot => ({
  name,
  offset,
  size,
  empty,
});

const layout = (base: number, slots: readonly LayoutSlot[]): LayoutInfo => ({
  base,
  version: 0x16,
  redundancy: false,
  checksumValid: undefined,
  slots,
});

function size(
  partitions: readonly FPTPartition[],
  fptStart: number,
  options: {
    readonly bytes?: Uint8Array;
    readonly cseLayout?: LayoutInfo;
    readonly hasFlashDescriptor?: boolean;
    readonly ignores4KAlignment?: boolean;
  } = {}
): number | undefined {
  return firmwareSize({
    bytes: options.bytes ?? new Uint8Array(0x8000).fill(0xff),
    partitions,
    fptStart,
    cseLayout: options.cseLayout,
    hasFlashDescriptor: options.hasFlashDescriptor ?? true,
    ignores4KAlignment: options.ignores4KAlignment ?? false,
  });
}

describe("the $FPT leg", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testTheLastStartingPartitionDecidesTheEnd
  it("measures to the end of the partition that starts last", () => {
    // FTPR reaches further, but MFS starts last: 0x3000 − 0x1000, already aligned.
    expect(size([part("FTPR", 0x1000, 0x5000), part("MFS", 0x2000, 0x1000)], 0x1000)).toBe(0x2000);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testAnUnalignedEndIsRoundedUp
  it("rounds an unaligned end up to the next 4 KiB", () => {
    expect(size([part("FTPR", 0x1000, 0x2800)], 0x1000)).toBe(0x3000);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testCSME16KeepsTheUnalignedEnd
  it("keeps a CSME 16 end unaligned", () => {
    expect(size([part("FTPR", 0x1000, 0x2800)], 0x1000, { ignores4KAlignment: true })).toBe(0x2800);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testAnErasedEntryDoesNotDecideTheEnd
  it("does not let an erased entry decide the end", () => {
    expect(
      size([part("FTPR", 0x1000, 0x2000), part("", 0xffff_ffff, 0xffff_ffff, true)], 0x1000)
    ).toBe(0x2000);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testALastPartitionWithoutASizeIsNotGuessed
  it("does not guess the end of a last partition with no size", () => {
    expect(size([part("FTPR", 0x1000, 0)], 0x1000)).toBeUndefined();
    expect(size([], 0x1000)).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testAnUnchartedPartitionPastTheLastEntryIsFound
  it("finds an uncharted partition past the last entry on an extracted region", () => {
    const bytes = new Uint8Array(0x8000).fill(0xff);
    bytes.set(
      Uint8Array.from("$CPD", (one) => one.charCodeAt(0)),
      0x3800
    );
    // Measured to 0x3800 — 0x2800 from the $FPT — and padded to the next 4 KiB.
    expect(size([part("FTPR", 0x1000, 0x2000)], 0x1000, { bytes, hasFlashDescriptor: false })).toBe(
      0x3000
    );
    // With a descriptor there is nothing uncharted to look for.
    expect(size([part("FTPR", 0x1000, 0x2000)], 0x1000, { bytes, hasFlashDescriptor: true })).toBe(
      0x2000
    );
  });
});

describe("the IFWI leg", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testTheCSME12OracleReproducesItsPrintedSize
  it("reproduces the CSME 12 dump's printed size", () => {
    const wholeFile = size(
      [
        part("PSVN", 0x002f00, 0x000100),
        part("UEP", 0x06e000, 0x002000),
        part("IVBP", 0x003000, 0x004000),
        part("MFS", 0x007000, 0x064000),
        part("UTOK", 0x06b000, 0x002000),
        part("HVMP", 0x002ec0, 0x00000c),
        part("FLOG", 0x06d000, 0x001000),
      ],
      0x2000,
      {
        cseLayout: layout(0x1000, [
          slot("Data", 0x002000, 0x06e000),
          slot("Boot 1", 0x070000, 0x103000),
          slot("Boot 2", 0x173000, 0x10a000),
          slot("Boot 3", 0x001000, 0, true),
          slot("Boot 4", 0x001000, 0, true),
          slot("Boot 5", 0x001000, 0, true),
        ]),
      }
    );
    expect(wholeFile).toBe(0x27c000);

    // The same firmware handed over as the ME region alone, every offset 0x1000
    // lower: the firmware is the same size.
    const region = size(
      [
        part("PSVN", 0x001f00, 0x000100),
        part("UEP", 0x06d000, 0x002000),
        part("IVBP", 0x002000, 0x004000),
        part("MFS", 0x006000, 0x064000),
        part("UTOK", 0x06a000, 0x002000),
        part("HVMP", 0x001ec0, 0x00000c),
        part("FLOG", 0x06c000, 0x001000),
      ],
      0x1000,
      {
        cseLayout: layout(0, [
          slot("Data", 0x001000, 0x06e000),
          slot("Boot 1", 0x06f000, 0x103000),
          slot("Boot 2", 0x172000, 0x10a000),
          slot("Boot 3", 0, 0, true),
          slot("Boot 4", 0, 0, true),
          slot("Boot 5", 0, 0, true),
        ]),
      }
    );
    expect(region).toBe(0x27c000);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testTheLargerOfTheFPTEndAndTheDataPartitionCounts
  it("takes the larger of the $FPT end and the Data partition", () => {
    const measured = size([part("FTPR", 0x1000, 0x1000)], 0x1000, {
      cseLayout: layout(0, [slot("Data", 0x1000, 0x8000), slot("Boot 1", 0x9000, 0x1000)]),
    });
    expect(measured).toBe(0x1000 + 0x8000 + 0x1000 - 0x1000);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/FirmwareEndTests.swift#FirmwareEndTests.testANestedPartitionIsNotCountedTwice
  it("counts a nested partition once", () => {
    const nested = size([part("FTPR", 0x1000, 0x1000)], 0x1000, {
      cseLayout: layout(0, [
        slot("Data", 0x1000, 0x2000),
        slot("Boot 1", 0x3000, 0x4000),
        // Inside Boot 1: its backup copy.
        slot("Boot 2", 0x3000, 0x2000),
      ]),
    });
    // Table 0x1000 + max(0x2000, 0x2000) + (0x4000 + 0x2000) − 0x2000 nested − 0x1000.
    expect(nested).toBe(0x6000);
  });
});
