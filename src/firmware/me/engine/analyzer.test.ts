import { describe, expect, it } from "vitest";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import { analyzeMeRegion } from "@/firmware/me/engine/analyzer";
import { CSME12_KEY, CSME12_PROTECTED, CSME12_SIG } from "@/firmware/me/testing/realManifests";
import {
  csmeDatabaseText,
  FIXTURE_KEY_HASH,
  FIXTURE_SIGNATURE_HASH,
  UNKNOWN_SIGNATURE_HASH,
  unrelatedDatabaseText,
} from "@/firmware/me/testing/testDatabase";
import {
  cpdDirectory,
  fptRegion,
  manifest,
  putU32,
  type TestManifest,
} from "@/firmware/me/testing/testMe";

/**
 * The analysis end to end — upstream's `IdentificationTests`, which drive the
 * whole pipeline rather than the identifier alone.
 */

/** A region carrying a `$FPT` and the manifest after it. */
function region(
  options: { readonly romBypass?: boolean; readonly manifest?: TestManifest } = {}
): Uint8Array {
  const table = fptRegion({
    entries:
      options.romBypass === true
        ? [{ name: "ROMB", offset: 0x10, size: 0x100, flags: 0x01 }]
        : [{ name: "FTPR", offset: 0x100, size: 0x400, flags: 0x01 }],
  });
  const one = manifest(options.manifest ?? {});
  const bytes = new Uint8Array(table.length + one.length);
  bytes.set(table);
  bytes.set(one, table.length);
  return bytes;
}

const analyze = (databaseText: string, bytes: Uint8Array, baseOffset = 0) =>
  analyzeMeRegion({ bytes, baseOffset, database: MEADatabase.parse(databaseText) });

describe("analyzeMeRegion", () => {
  it("names the family, version, release and database row", () => {
    const result = analyze(csmeDatabaseText(), region());

    expect(result.family).toBe("csme");
    expect(result.variant).toBe("CSME");
    expect(result.version).toMatchObject({ major: 15, minor: 40, hotfix: 37, build: 3121 });
    expect(result.version.meMajor).toBe(15);
    expect(result.version.meMinor).toBe(40);
    expect(result.securityVersion).toBe("3");
    expect(result.release).toBe("production");
    expect(result.databaseName).toBe(
      `15.40.37.3121_SVR_LP_C_SPI_PRD_EXTR_${FIXTURE_SIGNATURE_HASH}`
    );
    expect(result.issues).toEqual([]);
  });

  it("brings the database's stepping through to the analysis", () => {
    const result = analyze(csmeDatabaseText(), region());

    expect(result.chipsetStepping).toBe("C");
    expect(result.powerDownMitigation).toBeUndefined();
  });

  it("reports partitions at the caller's own offsets", () => {
    const result = analyze(csmeDatabaseText(), region(), 0x1000);

    expect(result.family).toBe("csme");
    expect(result.regions[0]?.offset).toBe(0x1000 + 0x100);
    expect(result.manifest?.offset).toBe(0x1000 + 0x40);
  });

  it("summarises the manifest it identified against", () => {
    const result = analyze(csmeDatabaseText(), region());

    expect(result.manifest).toMatchObject({
      tag: "$MN2",
      format: "r1",
      day: 24,
      month: 3,
      year: 2021,
      keyHash: FIXTURE_KEY_HASH,
      signatureHash: FIXTURE_SIGNATURE_HASH,
    });
  });

  it("corrects a wrongly production-signed key", () => {
    expect(analyze(csmeDatabaseText({ preKeys: [FIXTURE_KEY_HASH] }), region()).release).toBe(
      "preProduction"
    );
  });

  it("reads the debug flag as pre-production", () => {
    expect(analyze(csmeDatabaseText(), region({ manifest: { flags: 0x8000_0001 } })).release).toBe(
      "preProduction"
    );
  });

  it("lets a ROM-Bypass partition decide the release", () => {
    expect(analyze(csmeDatabaseText(), region({ romBypass: true })).release).toBe("romBypass");
  });

  it("notes a key the database does not list", () => {
    const result = analyze(
      unrelatedDatabaseText(),
      region({
        manifest: {
          key: Uint8Array.from({ length: 0x100 }, (_, index) => (0x33 + index) & 0xff),
          signature: Uint8Array.from({ length: 0x100 }, (_, index) => (0xcc - index) & 0xff),
        },
      })
    );

    expect(result.family).toBe("unknown");
    expect(result.variant).toBe("");
    // The version is still a fact read from the manifest.
    expect(result.version.major).toBe(15);
    expect(result.issues.map((one) => one.id)).toEqual([2]);
  });

  it("notes a recognised engine that is not in the database", () => {
    const result = analyze(csmeDatabaseText({ signature: UNKNOWN_SIGNATURE_HASH }), region());

    expect(result.family).toBe("csme");
    expect(result.databaseName).toBeUndefined();
    expect(result.issues.map((one) => one.id)).toEqual([3]);
  });

  it("notes a region with no partition table", () => {
    const result = analyzeMeRegion({ bytes: manifest() });

    expect(result.issues.map((one) => one.id)).toContain(1);
    expect(result.regions).toEqual([]);
  });

  it("answers a region with no manifest at all without a database", () => {
    // A structural parse needs nothing fetched, which is what keeps a plain
    // partition-table read working with no network.
    const result = analyzeMeRegion({
      bytes: fptRegion({ entries: [{ name: "FTPR", offset: 0x100, size: 0x400 }] }),
    });

    expect(result.family).toBe("unknown");
    expect(result.type).toBe("region");
    expect(result.manifest).toBeUndefined();
    expect(result.rsaSignatureValid).toBeUndefined();
    expect(result.regions).toHaveLength(1);
  });

  it("reads the directory that owns the manifest", () => {
    // The directory sits before the manifest, and the manifest names no owner:
    // finding it is a walk backwards.
    const directory = cpdDirectory({
      name: "FTPR",
      modules: [{ name: "$MN2" }, { name: "fwupdate" }],
    });
    const one = manifest();
    const bytes = new Uint8Array(directory.length + one.length);
    bytes.set(directory);
    bytes.set(one, directory.length);

    const result = analyzeMeRegion({ bytes, database: MEADatabase.parse(csmeDatabaseText()) });

    expect(result.codePartition?.name).toBe("FTPR");
    expect(result.codePartition?.modules.map((module) => module.name)).toEqual([
      "$MN2",
      "fwupdate",
    ]);
    expect(result.codePartition?.checksumValid).toBe(true);
  });

  it("says nothing about a signature it cannot check", () => {
    // The fixture's manifest declares no size, so it describes no protected
    // window and there is nothing to check the signature against. That is a
    // different answer from "invalid", and running the two together would call
    // every synthetic image corrupt.
    expect(analyze(csmeDatabaseText(), region()).rsaSignatureValid).toBeUndefined();
  });

  it("validates a real manifest's signature, and notices a changed byte", () => {
    // The fixture manifests cannot exercise this — their keys are not moduli —
    // so the check runs against a real one: its own key, signature and
    // protected window, laid out the way a manifest lays them out, with the
    // size fields that describe that window.
    const head = CSME12_PROTECTED.subarray(0, 0x80);
    const tail = CSME12_PROTECTED.subarray(0x80);
    const headerLength = 0x80 + CSME12_KEY.length + 4 + CSME12_SIG.length;
    const bytes = new Uint8Array(headerLength + tail.length);
    bytes.set(head);
    bytes.set(CSME12_KEY, 0x80);
    putU32(bytes, 0x80 + CSME12_KEY.length, 65537);
    bytes.set(CSME12_SIG, 0x80 + CSME12_KEY.length + 4);
    bytes.set(tail, headerLength);
    // The two size fields, in dwords, describing exactly that window.
    putU32(bytes, 0x04, headerLength / 4);
    putU32(bytes, 0x18, bytes.length / 4);

    expect(analyzeMeRegion({ bytes }).rsaSignatureValid).toBe(true);

    const tampered = Uint8Array.from(bytes);
    tampered[bytes.length - 1] = (tampered[bytes.length - 1] ?? 0) ^ 0x01;
    const broken = analyzeMeRegion({ bytes: tampered });
    expect(broken.rsaSignatureValid).toBe(false);
    expect(broken.issues.map((one) => one.id)).toContain(9);
  });
});
