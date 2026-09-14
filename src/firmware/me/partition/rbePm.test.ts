import { describe, expect, it } from "vitest";
import { decodeRbePmMetadata } from "@/firmware/me/partition/rbePm";

/** The `pm` / `rbe` metadata table. Ported from upstream's `RBEPMMetadataDecodeTests`. */

interface Spec {
  readonly stride: number;
  readonly extended: boolean;
  readonly hashOffset: number;
  readonly hashLength: number;
}

const RBEPM_SPECS = {
  r1: { stride: 0x48, extended: true, hashOffset: 0x28, hashLength: 0x20 },
  r2: { stride: 0x30, extended: false, hashOffset: 0x10, hashLength: 0x20 },
  r3: { stride: 0x58, extended: true, hashOffset: 0x28, hashLength: 0x30 },
  r4: { stride: 0x40, extended: false, hashOffset: 0x10, hashLength: 0x30 },
} as const satisfies Record<string, Spec>;

/** `rows` contiguous entries; a row may override its vendor id. */
function rbePmTable(spec: Spec, rows: readonly { vendorID?: number }[]): Uint8Array {
  const bytes = new Uint8Array(spec.stride * rows.length);
  const view = new DataView(bytes.buffer);
  rows.forEach((row, index) => {
    const base = index * spec.stride;
    view.setUint32(base, 0x0102_0304 + index, true);
    view.setUint16(base + 0x04, 0x1234 + index, true);
    view.setUint16(base + 0x06, row.vendorID ?? 0x8086, true);
    view.setUint32(base + 0x08, 0x0002_0000, true);
    view.setUint32(base + 0x0c, 0x0001_8000, true);
    if (spec.extended) {
      view.setUint32(base + 0x10, 0x4000, true);
      view.setUint32(base + 0x14, 0x20000, true);
      view.setUint32(base + 0x18, 0x1000, true);
      view.setUint32(base + 0x1c, 0x2000, true);
    }
    for (let i = 0; i < spec.hashLength; i++)
      bytes[base + spec.hashOffset + i] = (index + i + 1) & 0xff;
  });
  return bytes;
}

const THREE = [{}, {}, {}];
const ROW0_HASH = "201F1E1D1C1B1A191817161514131211100F0E0D0C0B0A090807060504030201";

describe("decodeRbePmMetadata", () => {
  it("decodes an R1 extended table", () => {
    const entries = decodeRbePmMetadata(rbePmTable(RBEPM_SPECS.r1, THREE));
    expect(entries?.map((one) => one.variant)).toEqual(["r1", "r1", "r1"]);
    expect(entries?.map((one) => one.deviceID)).toEqual([0x1234, 0x1235, 0x1236]);
    expect(entries?.[0]).toEqual({
      variant: "r1",
      unknown0: 0x0102_0304,
      deviceID: 0x1234,
      vendorID: 0x8086,
      sizeUncompressed: 0x20000,
      sizeCompressed: 0x18000,
      bssSize: 0x4000,
      codeSizeUncompressed: 0x20000,
      codeBaseAddress: 0x1000,
      mainThreadEntry: 0x2000,
      unknown1: 0,
      unknown2: 0,
      hash: ROW0_HASH,
    });
  });

  it("decodes an R2 compact table", () => {
    const entries = decodeRbePmMetadata(rbePmTable(RBEPM_SPECS.r2, THREE));
    expect(entries?.map((one) => one.variant)).toEqual(["r2", "r2", "r2"]);
    const row = entries?.[0];
    expect(row?.deviceID).toBe(0x1234);
    expect(row?.sizeCompressed).toBe(0x18000);
    expect(row?.bssSize).toBeUndefined();
    expect(row?.codeSizeUncompressed).toBeUndefined();
    expect(row?.mainThreadEntry).toBeUndefined();
    expect(row?.hash).toBe(ROW0_HASH);
  });

  it("decodes an R3 extended SHA-384 table", () => {
    const row = decodeRbePmMetadata(rbePmTable(RBEPM_SPECS.r3, THREE))?.[0];
    expect(row?.variant).toBe("r3");
    expect(row?.bssSize).toBe(0x4000);
    expect(row?.hash).toHaveLength(96);
    expect(row?.hash.slice(0, 2)).toBe("30");
    expect(row?.hash.slice(-2)).toBe("01");
  });

  it("decodes an R4 compact SHA-384 table", () => {
    const row = decodeRbePmMetadata(rbePmTable(RBEPM_SPECS.r4, THREE))?.[0];
    expect(row?.variant).toBe("r4");
    expect(row?.bssSize).toBeUndefined();
    expect(row?.hash).toHaveLength(96);
    expect(row?.hash.slice(0, 2)).toBe("30");
  });

  it("picks the layout by the spacing", () => {
    for (const variant of ["r1", "r2", "r3", "r4"] as const) {
      expect(decodeRbePmMetadata(rbePmTable(RBEPM_SPECS[variant], THREE))?.[0]?.variant).toBe(
        variant
      );
    }
  });

  it("stops at a row whose vendor is not Intel", () => {
    const entries = decodeRbePmMetadata(
      rbePmTable(RBEPM_SPECS.r1, [{}, {}, {}, { vendorID: 0x9999 }])
    );
    expect(entries?.map((one) => one.deviceID)).toEqual([0x1234, 0x1235, 0x1236]);
  });

  it("finds a table inside a larger body", () => {
    const table = rbePmTable(RBEPM_SPECS.r1, THREE);
    const body = new Uint8Array(0x40 + table.length).fill(0xaa);
    body.set(table, 0x40);
    const entries = decodeRbePmMetadata(body);
    expect(entries).toHaveLength(3);
    expect(entries?.[0]?.deviceID).toBe(0x1234);
    expect(entries?.[0]?.variant).toBe("r1");
  });

  it("finds nothing without three spaced vendor ids", () => {
    expect(decodeRbePmMetadata(rbePmTable(RBEPM_SPECS.r2, [{}, {}]))).toBeUndefined();
    expect(decodeRbePmMetadata(new Uint8Array(0x200))).toBeUndefined();
    expect(decodeRbePmMetadata(new Uint8Array(0x200).fill(0x55))).toBeUndefined();
    expect(decodeRbePmMetadata(new Uint8Array(0x20))).toBeUndefined();
  });
});
