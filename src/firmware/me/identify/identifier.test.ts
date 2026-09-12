import { describe, expect, it } from "vitest";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import {
  familyForVariant,
  identify,
  preKeyOverride,
  SHARED_ME_KEY_HASH,
} from "@/firmware/me/identify/identifier";
import { parseFirstManifest } from "@/firmware/me/layout/manifest";
import {
  csmeDatabaseText,
  FIXTURE_KEY_HASH,
  FIXTURE_SIGNATURE_HASH,
  UNKNOWN_SIGNATURE_HASH,
  unrelatedDatabaseText,
} from "@/firmware/me/testing/testDatabase";
import { manifest, type TestManifest } from "@/firmware/me/testing/testMe";

/** Turning a manifest and the database into an identity. */

function identityOf(
  databaseText: string,
  options: {
    readonly manifest?: TestManifest;
    readonly hasRomBypass?: boolean;
    readonly moduleNames?: readonly string[];
  } = {}
) {
  const found = parseFirstManifest(manifest(options.manifest ?? {}));
  if (found === undefined) throw new Error("the fixture should decode");
  return identify({
    manifest: found,
    database: MEADatabase.parse(databaseText),
    hasRomBypass: options.hasRomBypass ?? false,
    moduleNames: options.moduleNames ?? [],
  });
}

describe("identify", () => {
  it("names the family, the version and the database row", () => {
    const identity = identityOf(csmeDatabaseText());

    expect(identity.family).toBe("csme");
    expect(identity.variant).toBe("CSME");
    expect(identity).toMatchObject({ major: 15, minor: 40, hotfix: 37, build: 3121 });
    expect(identity.meMajor).toBe(15);
    expect(identity.meMinor).toBe(40);
    expect(identity.securityVersion).toBe("3");
    expect(identity.release).toBe("production");
    expect(identity.databaseName).toBe(
      `15.40.37.3121_SVR_LP_C_SPI_PRD_EXTR_${FIXTURE_SIGNATURE_HASH}`
    );
    expect(identity.identified).toBe(true);
  });

  it("brings the database's stepping through", () => {
    const identity = identityOf(csmeDatabaseText());

    expect(identity.chipsetStepping).toBe("C");
    // The next cell of that row is a release rather than a mitigation token,
    // so nothing is claimed about power-down mitigation.
    expect(identity.powerDownMitigation).toBeUndefined();
  });

  it("corrects a wrongly production-signed key to pre-production", () => {
    // The manifest's own flag says production; the database's list says the
    // key is a pre-production one, and the list wins.
    expect(identityOf(csmeDatabaseText({ preKeys: [FIXTURE_KEY_HASH] })).release).toBe(
      "preProduction"
    );
  });

  it("reads the debug flag as pre-production", () => {
    expect(identityOf(csmeDatabaseText(), { manifest: { flags: 0x8000_0001 } }).release).toBe(
      "preProduction"
    );
  });

  it("lets a ROM-Bypass partition beat both", () => {
    expect(identityOf(csmeDatabaseText(), { hasRomBypass: true }).release).toBe("romBypass");
  });

  it("says unknown for a key the database does not list", () => {
    const identity = identityOf(unrelatedDatabaseText(), {
      manifest: {
        key: Uint8Array.from({ length: 0x100 }, (_, index) => (0x33 + index) & 0xff),
        signature: Uint8Array.from({ length: 0x100 }, (_, index) => (0xcc - index) & 0xff),
      },
    });

    expect(identity.family).toBe("unknown");
    expect(identity.variant).toBe("");
    expect(identity.identified).toBe(false);
    // The version is still a fact read from the manifest, whatever the
    // database does or does not know about the key.
    expect(identity.major).toBe(15);
  });

  it("names a family with no row for the firmware itself", () => {
    // The key resolves but no row carries its signature hash: a build newer
    // than the database, which is a different thing from an unknown engine.
    const identity = identityOf(csmeDatabaseText({ signature: UNKNOWN_SIGNATURE_HASH }));

    expect(identity.family).toBe("csme");
    expect(identity.identified).toBe(true);
    expect(identity.databaseName).toBeUndefined();
  });

  it("falls back to the modules of the firmware's own directory", () => {
    // This is what recognises the stitched independent firmware, whose keys the
    // database does not list at all.
    const identity = identityOf(unrelatedDatabaseText(), {
      manifest: { major: 150, meMajor: 15, meMinor: 0 },
      moduleNames: ["PMCC000"],
    });

    expect(identity.variant).toBe("PMCTGP");
    expect(identity.family).toBe("pmc");
    expect(identity.identified).toBe(true);
  });

  it("reads an erased security version as nothing at all", () => {
    // Zero is a version like any other and every stitched firmware has one;
    // only the erased word says nothing.
    expect(identityOf(csmeDatabaseText(), { manifest: { svn: 0 } }).securityVersion).toBe("0");
    expect(
      identityOf(csmeDatabaseText(), { manifest: { svn: 0xffff_ffff } }).securityVersion
    ).toBeUndefined();
  });
});

describe("preKeyOverride", () => {
  it("splits the one shared key by the firmware's major", () => {
    // One key, two families, and the version is the only thing telling them
    // apart.
    expect(preKeyOverride(SHARED_ME_KEY_HASH, 7)).toBe("ME");
    expect(preKeyOverride(SHARED_ME_KEY_HASH, 10)).toBe("ME");
    expect(preKeyOverride(SHARED_ME_KEY_HASH, 1)).toBe("TXE");
    expect(preKeyOverride(SHARED_ME_KEY_HASH, 11)).toBeUndefined(); // a CSME
    expect(preKeyOverride("other", 7)).toBeUndefined();
  });
});

describe("familyForVariant", () => {
  it("maps the named families", () => {
    expect(familyForVariant("CSME")).toBe("csme");
    expect(familyForVariant("CSSPS")).toBe("cssps");
    expect(familyForVariant("GSC")).toBe("gsc");
  });

  it("maps the per-platform tokens by their prefix", () => {
    // There are dozens of these and their prefix is the family.
    expect(familyForVariant("PMCTGP")).toBe("pmc");
    expect(familyForVariant("PCHCADP")).toBe("pchc");
    expect(familyForVariant("PHYPTGP")).toBe("phy");
    expect(familyForVariant("OROMDG2")).toBe("orom");
  });

  it("maps what it does not know to unknown", () => {
    expect(familyForVariant("TBD")).toBe("unknown");
    expect(familyForVariant("")).toBe("unknown");
  });
});
