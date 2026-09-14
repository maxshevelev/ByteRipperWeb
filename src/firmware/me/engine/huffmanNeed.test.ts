import { describe, expect, it } from "vitest";
import { analyzeMeRegion } from "@/firmware/me/engine/analyzer";
import {
  hasHuffmanModuleToValidate,
  huffmanDictionariesWanted,
  metAttributes,
} from "@/firmware/me/engine/huffmanNeed";
import type { CodePartition, CPDModuleRow } from "@/firmware/me/models/firmwareAnalysis";
import type { CPDExtension } from "@/firmware/me/partition/extensions";

/** When an analysis would read more with `Huffman.dat` in hand. */

const attributes = (compression: number, encryption = 0): CPDExtension => ({
  tag: 0x0a,
  size: 0x18,
  offset: 0,
  moduleAttributes: {
    compression,
    encryption,
    uncompressedSize: 0x2000,
    compressedSize: 0x800,
    deviceID: 0,
    vendorID: 0x8086,
    moduleHash: "",
  },
});

const module = (
  name: string,
  isHuffman: boolean,
  extensions?: readonly CPDExtension[]
): CPDModuleRow => ({
  name,
  offset: 0,
  size: 0x800,
  isHuffman,
  ...(extensions === undefined ? {} : { extensions }),
});

const partition = (modules: readonly CPDModuleRow[]): CodePartition => ({
  name: "FTPR",
  offset: 0,
  headerVersion: 1,
  headerLength: 0x10,
  numModules: modules.length,
  checksumValid: true,
  modules,
  extensions: [],
});

/** A real, empty analysis to lay a partition and an identity over. */
const bare = analyzeMeRegion({ bytes: new Uint8Array(0x40) });

describe("metAttributes", () => {
  it("reads the attributes a module's .met companion gives it", () => {
    const cp = partition([module("kernel", true), module("kernel.met", false, [attributes(1)])]);
    expect(metAttributes(cp, "kernel")?.compression).toBe(1);
    expect(metAttributes(cp, "bup")).toBeUndefined();
  });
});

describe("hasHuffmanModuleToValidate", () => {
  it("needs a Huffman module whose .met says Huffman and no encryption", () => {
    expect(
      hasHuffmanModuleToValidate(
        partition([module("kernel", true), module("kernel.met", false, [attributes(1)])])
      )
    ).toBe(true);
    expect(
      hasHuffmanModuleToValidate(
        partition([module("kernel", true), module("kernel.met", false, [attributes(2)])])
      )
    ).toBe(false);
    expect(
      hasHuffmanModuleToValidate(
        partition([module("kernel", true), module("kernel.met", false, [attributes(1, 1)])])
      )
    ).toBe(false);
    expect(hasHuffmanModuleToValidate(partition([module("kernel", true)]))).toBe(false);
  });
});

describe("huffmanDictionariesWanted", () => {
  it("wants them for a Huffman pm or rbe module, identified or not", () => {
    expect(
      huffmanDictionariesWanted({ ...bare, codePartition: partition([module("pm", true)]) })
    ).toBe(true);
    expect(
      huffmanDictionariesWanted({ ...bare, codePartition: partition([module("rbe", false)]) })
    ).toBe(false);
  });

  it("wants them for a module to check only once the firmware is identified", () => {
    const cp = partition([module("kernel", true), module("kernel.met", false, [attributes(1)])]);
    expect(huffmanDictionariesWanted({ ...bare, codePartition: cp })).toBe(false);
    expect(huffmanDictionariesWanted({ ...bare, variant: "CSME", codePartition: cp })).toBe(true);
  });

  it("wants nothing without a code partition", () => {
    expect(huffmanDictionariesWanted(bare)).toBe(false);
  });
});
