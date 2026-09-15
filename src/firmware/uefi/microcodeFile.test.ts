import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import { sum32Of } from "@/firmware/uefi/checksums";
import {
  type MicrocodeHeader,
  microcodeFields,
  microcodePlatformsText,
  microcodeProcessorText,
  readMicrocodeHeader,
} from "@/firmware/uefi/microcodeParser";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange } from "@/firmware/uefi/uefiNode";

/** Ported from upstream's `MicrocodeFileTests.swift`. */

const readerOver = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));

function join(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, one) => total + one.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

const firstFile = (files: readonly Uint8Array[]) =>
  parseUefiImage(sourceOver(Test.volume({ length: 0x400, files }))).allNodes.find(
    (node) => node.kind === "file"
  );

// A raw FFS file holding Intel microcode reads as its images, the way the FIT
// sees them, rather than as one blob.
describe("a microcode store file", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/MicrocodeFileTests.swift#MicrocodeFileTests.testARawFileThatOpensOnMicrocodeIsReadAsItsImages
  it("reads as its images when it opens on microcode", () => {
    const images = join(
      Test.microcode({ revision: 0x1f }),
      Test.microcode({ signature: 0x0009_06ea, revision: 0xf0 })
    );
    const body = join(images, new Uint8Array(0x40).fill(0xff));
    const file = firstFile([Test.file({ body })]);
    const children = file?.children ?? [];

    expect(children.map((one) => one.kind)).toEqual(["microcode", "microcode", "padding"]);
    expect(children[0] === undefined ? -1 : nodeRange(children[0]).start).toBe(file?.body.start);
    expect(children[1]?.name).toBe("Microcode 906EA, revision F0");
    expect(children[2] === undefined ? -1 : nodeRange(children[2]).end).toBe(file?.body.end);
    // The empty slot after the run.
    expect(children[2]?.isErased).toBe(true);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/MicrocodeFileTests.swift#MicrocodeFileTests.testARawFileOfAnythingElseIsKeptWhole
  it("is kept whole when it holds anything else", () => {
    const body = join(Uint8Array.of(0x02, 0x00, 0x00, 0x00), new Uint8Array(0x40).fill(0xab));
    expect(firstFile([Test.file({ body })])?.children).toEqual([]);
  });
});

// What a microcode header says beyond its raw fields: the processor its
// signature names, the platforms its IDs select, and the extended signature
// table of an update for more than one processor.
describe("a microcode header's reading", () => {
  const value = (header: MicrocodeHeader | undefined, label: string) =>
    header === undefined
      ? undefined
      : microcodeFields(header).find((one) => one.label === label)?.value;

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/MicrocodeFileTests.swift#MicrocodeFieldsTests.testTheSignatureReadsAsFamilyModelAndStepping
  it("reads the signature as family, model and stepping", () => {
    expect(microcodeProcessorText(0x0008_06ea)).toBe("Family 0x6, model 0x8E, stepping 0xA");
    // An extended family is added to 0xF.
    expect(microcodeProcessorText(0x00a2_0f10)).toBe("Family 0x19, model 0x21, stepping 0x0");
    expect(microcodePlatformsText(0xc2)).toBe("1, 6, 7");
    expect(microcodePlatformsText(0)).toBe("None");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/MicrocodeFileTests.swift#MicrocodeFieldsTests.testAnUpdateWithNoExtendedTableSaysNothingOfOne
  it("says nothing of an extended table an update does not have", () => {
    const header = readMicrocodeHeader(0, readerOver(Test.microcode()));
    expect(header).toBeDefined();
    expect(header?.extendedTable).toBeUndefined();
    expect(value(header, "Extended signatures")).toBeUndefined();
    expect(value(header, "Processor")).toBe("Family 0x6, model 0x3A, stepping 0x9");
    expect(value(header, "Platforms")).toBe("0");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/MicrocodeFileTests.swift#MicrocodeFieldsTests.testTheExtendedSignatureTableIsReadAndChecked
  it("reads and checks the extended signature table", () => {
    const signatures: readonly (readonly [number, number])[] = [
      [0x0009_06ea, 0x02],
      [0x000a_0671, 0x08],
    ];
    const tableSize = 20 + 12 * signatures.length;
    const bytes = Test.microcode({
      signature: 0x0008_06ea,
      dataSize: 0x40,
      totalSize: 0x70 + tableSize,
    });
    const put = (dword: number, at: number) => {
      for (let index = 0; index < 4; index++) bytes[at + index] = (dword >>> (8 * index)) & 0xff;
    };
    const table = [signatures.length, 0, 0, 0, 0];
    for (const [signature, platforms] of signatures) table.push(signature, platforms, 0);
    for (const [index, dword] of table.entries()) put(dword, 0x70 + 4 * index);
    put((0 - table.reduce((sum, one) => (sum + one) >>> 0, 0)) >>> 0, 0x74);
    put(0, 0x10);
    put((0 - (sum32Of({ start: 0, end: bytes.length }, readerOver(bytes)) ?? 0)) >>> 0, 0x10);

    const header = readMicrocodeHeader(0, readerOver(bytes));
    const extended = header?.extendedTable;
    expect(extended?.count).toBe(2);
    expect(extended?.signatures.map((one) => one.processorSignature)).toEqual([
      0x0009_06ea, 0x000a_0671,
    ]);
    expect(extended?.signatures.map((one) => one.platformIDs)).toEqual([0x02, 0x08]);
    expect(extended?.checksumIsCorrect).toBe(true);
    expect(header?.checksumIsCorrect).toBe(true);
    expect(value(header, "Extended signatures")).toBe("906EA, A0671");
    expect(value(header, "Extended checksum")?.endsWith("(Valid)")).toBe(true);
    // The count and the room agree.
    expect(value(header, "Extended table")).toBeUndefined();

    put(3, 0x70);
    const broken = readMicrocodeHeader(0, readerOver(bytes))?.extendedTable;
    // Only what the image has room for.
    expect(broken?.signatures).toHaveLength(2);
    expect(broken?.checksumIsCorrect).toBe(false);
  });
});
