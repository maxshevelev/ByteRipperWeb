import { describe, expect, it } from "vitest";
import { hex, sha384 } from "@/firmware/me/crypto/digest";
import { lzmaValidationIssues, rbeMetadataHashes } from "@/firmware/me/engine/analyzer";
import type { CodePartition } from "@/firmware/me/models/firmwareAnalysis";

/**
 * A module check's issue names the module it is about, so a panel can put it on
 * that module's row; an issue about the image names none. Ported from upstream's
 * `ModuleIssueTests.swift`.
 */

const u32 = (value: number) => [0, 1, 2, 3].map((index) => (value >>> (8 * index)) & 0xff);
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

describe("an issue about a module", () => {
  // An LZMA module whose `.met` says it runs past the region: the check cannot
  // verify it, and says which module.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ModuleIssueTests.swift#ModuleIssueTests.testAnLZMACheckNamesItsModule
  it("names its module when the LZMA check raises it", () => {
    const partition: CodePartition = {
      name: "FTPR",
      offset: 0,
      headerVersion: 2,
      headerLength: 0x14,
      numModules: 2,
      checksumValid: true,
      extensions: [],
      modules: [
        { name: "kernel", offset: 0x100, isHuffman: false, size: 0x2000 },
        {
          name: "kernel.met",
          offset: 0x80,
          isHuffman: false,
          size: 0x60,
          extensions: [
            {
              tag: 0x0a,
              size: 0x60,
              offset: 0x80,
              moduleAttributes: {
                compression: 2,
                encryption: 0,
                uncompressedSize: 0x2000,
                compressedSize: 0x1000,
                deviceID: 0,
                vendorID: 0x8086,
                moduleHash: "",
              },
            },
          ],
        },
      ],
    };

    const issues = lzmaValidationIssues(partition, new Uint8Array(0x800), 0);

    expect(issues.map((one) => one.id)).toEqual([19]);
    expect(issues[0]?.module).toBe("kernel");
  });
});

describe("the RBEP partitions' metadata tables", () => {
  // A `$CPD` named RBEP with one uncompressed `rbe` module holding three R4 rows
  // (0x40 each, VEN_ID 0x8086 at +6, a SHA-384 at +0x10). A row's hash reads as
  // the digest of what it was taken over, and nothing else is listed.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ModuleIssueTests.swift#ModuleIssueTests.testTheRBEPTablesHashesAreRead
  it("reads the hashes an RBEP partition's rbe table lists", () => {
    const digests = [0, 1, 2].map((index) => sha384(Uint8Array.from(ascii(`module ${index}`))));
    const body: number[] = [];
    digests.forEach((digest, index) => {
      body.push(...u32(0), index, 0, 0x86, 0x80, ...u32(0x1000), ...u32(0x800));
      // Stored little-endian, read as one integer.
      body.push(...[...digest].reverse());
    });

    const region = [...ascii("$CPD"), ...u32(1), 2, 1, 0x14, 0, ...ascii("RBEP"), ...u32(0)];
    region.push(...ascii("rbe"), ...new Array<number>(9).fill(0));
    region.push(...u32(0x40), ...u32(body.length), ...u32(0));
    region.push(...new Array<number>(0x40 - region.length).fill(0));
    region.push(...body, ...new Array<number>(0x40).fill(0));

    const hashes = rbeMetadataHashes(
      [0],
      Uint8Array.from(region),
      0,
      "csme15",
      { variant: "CSME", major: 15, minor: 0 },
      undefined
    );

    expect(hashes).toEqual(digests.map((digest) => hex(digest)));
  });
});
