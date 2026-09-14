import { describe, expect, it } from "vitest";
import { analyzeMeRegion } from "@/firmware/me/engine/analyzer";
import { cpdDirectory, fptRegion, manifest } from "@/firmware/me/testing/testMe";

/**
 * The analysis reaching the structures beside the engine. Ported from upstream's
 * `GSCInfoAnalyzerTests` and `RBEPMAnalyzerTests`.
 */

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0));
  let at = 0;
  for (const one of parts) {
    out.set(one, at);
    at += one.length;
  }
  return out;
}

/** A GSC INFO payload: revision, the image header, two IUP rows. */
function infoPayload(revision = 1): Uint8Array {
  const bytes = new Uint8Array(4 + 0x20 + 2 * 0x10);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, revision, true);
  bytes.set(
    Uint8Array.from("GSCF", (one) => one.charCodeAt(0)),
    4
  );
  view.setUint16(4 + 0x08, 5, true);
  for (const [index, name] of ["BP1", "BP2"].entries()) {
    bytes.set(
      Uint8Array.from(name, (one) => one.charCodeAt(0)),
      4 + 0x20 + index * 0x10
    );
  }
  return bytes;
}

/** An `$FPT` naming one INFO partition at 0x1000, and the payload there. */
const infoRegion = (payload: Uint8Array) =>
  concat(
    fptRegion({ entries: [{ name: "INFO", offset: 0x1000, size: payload.length }], size: 0x1000 }),
    payload
  );

describe("a GSC INFO partition", () => {
  it("is surfaced with no manifest and no database", () => {
    const result = analyzeMeRegion({ bytes: infoRegion(infoPayload()) });
    expect(result.regions.map((one) => one.name)).toEqual(["INFO"]);
    expect(result.gscInfo?.revisionValid).toBe(true);
    expect(result.gscInfo?.image.project).toBe("GSCF");
    expect(result.gscInfo?.iupPartitions).toHaveLength(2);
    expect(result.gscInfo?.offset).toBe(0x1000);
    expect(result.issues).toEqual([]);
  });

  it("warns about an unknown revision", () => {
    const result = analyzeMeRegion({ bytes: infoRegion(infoPayload(7)) });
    expect(result.gscInfo?.revisionValid).toBe(false);
    expect(
      result.issues.some(
        (one) => one.id === 12 && one.severity === "warning" && one.message.includes("revision 7")
      )
    ).toBe(true);
  });

  it("is absent without an INFO partition", () => {
    const bytes = concat(
      fptRegion({ entries: [{ name: "FTPR", offset: 0x1000, size: 0x100 }], size: 0x1000 }),
      new Uint8Array(0x100).fill(0xff)
    );
    expect(analyzeMeRegion({ bytes }).gscInfo).toBeUndefined();
  });
});

/** Three contiguous R1 metadata rows. */
function r1Table(): Uint8Array {
  const bytes = new Uint8Array(0x48 * 3);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 3; index++) {
    const base = index * 0x48;
    view.setUint32(base, 0x0102_0304 + index, true);
    view.setUint16(base + 0x04, 0x1234 + index, true);
    view.setUint16(base + 0x06, 0x8086, true);
    for (let i = 0; i < 0x20; i++) bytes[base + 0x28 + i] = (index + i + 1) & 0xff;
  }
  return bytes;
}

describe("the pm / rbe metadata table", () => {
  it("is read from an uncompressed pm module", () => {
    const body = r1Table();
    const one = manifest();
    const manifestBase = 0x10 + 2 * 0x18;
    const pmBase = manifestBase + one.length;
    const directory = cpdDirectory({
      name: "FTPR",
      modules: [
        { name: "$MN2", offset: manifestBase, size: one.length },
        { name: "pm", offset: pmBase, size: body.length },
      ],
    });

    const result = analyzeMeRegion({ bytes: concat(directory, one, body), baseOffset: 0x1000 });

    expect(result.codePartition?.modules.map((module) => module.name)).toEqual(["$MN2", "pm"]);
    const entries = result.rbePmMetadata ?? [];
    expect(entries).toHaveLength(3);
    expect(entries[0]?.variant).toBe("r1");
    expect(entries[0]?.deviceID).toBe(0x1234);
    expect(entries[0]?.vendorID).toBe(0x8086);
    expect(entries[2]?.hash).toHaveLength(64);
  });

  it("is absent without a pm or rbe module", () => {
    const one = manifest();
    const directory = cpdDirectory({ name: "FTPR", modules: [{ name: "$MN2" }] });
    const result = analyzeMeRegion({ bytes: concat(directory, one) });
    expect(result.codePartition?.modules.map((module) => module.name)).toEqual(["$MN2"]);
    expect(result.rbePmMetadata).toBeUndefined();
  });
});
