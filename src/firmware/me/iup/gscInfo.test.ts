import { describe, expect, it } from "vitest";
import { decodeGscInfo } from "@/firmware/me/iup/gscInfo";
import { gscVersionText } from "@/firmware/me/models/independentFacts";

/** The GSC INFO partition. Ported from upstream's `GSCInfoDecodeTests`. */

interface Params {
  revision: number;
  project: string;
  hotfix: number;
  build: number;
  gscMajor: number;
  gscMinor: number;
  gscHotfix: number;
  gscBuild: number;
  flags: number;
  fwType: number;
  fwSku: number;
  arbSvn: number;
  tcbSvn: number;
  vcn: number;
  iupNames: readonly string[];
}

const DEFAULTS: Params = {
  revision: 1,
  project: "GSCF",
  hotfix: 0,
  build: 17,
  gscMajor: 5,
  gscMinor: 1,
  gscHotfix: 0,
  gscBuild: 2049,
  flags: 0x0003,
  fwType: 0x02,
  fwSku: 0x00,
  arbSvn: 0x0b,
  tcbSvn: 3,
  vcn: 4,
  iupNames: ["BP1", "BP2"],
};

/** A revision word, the image header, then one row per name. */
function gscInfoPayload(overrides: Partial<Params> = {}): Uint8Array {
  const p = { ...DEFAULTS, ...overrides };
  const bytes = new Uint8Array(4 + 0x20 + p.iupNames.length * 0x10);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, p.revision, true);
  const fwi = 4;
  bytes.set(
    Uint8Array.from(p.project.slice(0, 4), (one) => one.charCodeAt(0)),
    fwi
  );
  view.setUint16(fwi + 0x04, p.hotfix, true);
  view.setUint16(fwi + 0x06, p.build, true);
  view.setUint16(fwi + 0x08, p.gscMajor, true);
  view.setUint16(fwi + 0x0a, p.gscMinor, true);
  view.setUint16(fwi + 0x0c, p.gscHotfix, true);
  view.setUint16(fwi + 0x0e, p.gscBuild, true);
  view.setUint16(fwi + 0x10, p.flags, true);
  bytes[fwi + 0x12] = p.fwType;
  bytes[fwi + 0x13] = p.fwSku;
  view.setUint32(fwi + 0x14, p.arbSvn, true);
  view.setUint32(fwi + 0x18, p.tcbSvn, true);
  view.setUint32(fwi + 0x1c, p.vcn, true);
  p.iupNames.forEach((name, index) => {
    const row = fwi + 0x20 + index * 0x10;
    bytes.set(
      Uint8Array.from(name.slice(0, 4), (one) => one.charCodeAt(0)),
      row
    );
    view.setUint16(row + 0x04, 0x0004, true);
    view.setUint16(row + 0x06, 0, true);
    view.setUint32(row + 0x08, index + 1, true);
    view.setUint32(row + 0x0c, index + 10, true);
  });
  return bytes;
}

describe("decodeGscInfo", () => {
  it("decodes the image header and the IUP rows", () => {
    const payload = gscInfoPayload();
    const info = decodeGscInfo(payload, 0, payload.length);
    expect(info?.revision).toBe(1);
    expect(info?.revisionValid).toBe(true);
    expect(info?.offset).toBe(0);
    expect(info?.image).toEqual({
      project: "GSCF",
      hotfix: 0,
      build: 17,
      gscMajor: 5,
      gscMinor: 1,
      gscHotfix: 0,
      gscBuild: 2049,
      flags: 0x0003,
      fwType: 0x02,
      fwSku: 0x00,
      arbSvn: 0x0b,
      tcbSvn: 3,
      vcn: 4,
    });
    expect(info === undefined ? undefined : gscVersionText(info.image)).toBe("5.1.0.2049");
    expect(info?.iupPartitions).toEqual([
      { name: "BP1", flags: 0x0004, reserved: 0, svn: 1, vcn: 10 },
      { name: "BP2", flags: 0x0004, reserved: 0, svn: 2, vcn: 11 },
    ]);
  });

  it("says N/A for a GSC major of zero", () => {
    const payload = gscInfoPayload({ gscMajor: 0 });
    const info = decodeGscInfo(payload, 0, payload.length);
    expect(info === undefined ? undefined : gscVersionText(info.image)).toBe("N/A");
  });

  it("flags a revision other than 1, and decodes anyway", () => {
    const payload = gscInfoPayload({ revision: 2 });
    const info = decodeGscInfo(payload, 0, payload.length);
    expect(info?.revision).toBe(2);
    expect(info?.revisionValid).toBe(false);
    expect(info?.iupPartitions).toHaveLength(2);
  });

  it("reports its base at the caller's offset", () => {
    const payload = gscInfoPayload();
    expect(decodeGscInfo(payload, 0, payload.length, 0x1000)?.offset).toBe(0x1000);
  });

  it("decodes inside a larger region", () => {
    const payload = gscInfoPayload();
    const region = new Uint8Array(0x40 + payload.length).fill(0xaa);
    region.set(payload, 0x40);
    const info = decodeGscInfo(region, 0x40, payload.length, 0x1000);
    expect(info?.offset).toBe(0x1000 + 0x40);
    expect(info?.image.project).toBe("GSCF");
    expect(info?.iupPartitions).toHaveLength(2);
  });

  it("is nothing too short or out of bounds", () => {
    expect(decodeGscInfo(new Uint8Array(4 + 0x10), 0, 4 + 0x10)).toBeUndefined();
    expect(decodeGscInfo(new Uint8Array(0x200), 0x200, 0x200)).toBeUndefined();
    expect(decodeGscInfo(new Uint8Array(0x200), 0x1f0, 0x200)).toBeUndefined();
  });
});
