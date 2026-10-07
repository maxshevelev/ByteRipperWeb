import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import * as N from "@/firmware/testing/testNvram";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { isBZip2Variable, unpackedPartName } from "@/tools/uefi/uefiPresenter";

/**
 * Apple's device overrides are text inside a bzip2 stream; the detail unpacks them into a row a
 * rule, and the row offers the text as a part of its own.
 */

/** Two rules, through `bzip2`. */
const STREAM = Uint8Array.from(
  "425a683931415926535908fd786100000fdf804030116600023e26db0aaae59c002000750d48f5007a81a00036a3d20d12311a1a00d1a0069a21ab331a405d168066c611d26150891d52bf217f01ce1aa06e4b560f7bb9cab67128c48c9cac40f1a84d9a1ea5d0998e4a0183138ec7d1856a924bc0926c503f17724538509008fd7861".match(
    /../g
  ) ?? [],
  (pair) => Number.parseInt(pair, 16)
);

function built() {
  const bytes = N.nvramVolume({
    stores: [N.sysfStore({ variables: [N.sysfVariable({ name: "overrides", data: STREAM })] })],
  });
  const image = parseUefiImage(sourceOver(bytes));
  const node = image.allNodes.find((one) => one.kind === "sysFEntry" && one.name === "overrides");
  if (node === undefined) throw new Error("no overrides variable");
  return { image, node, reader: new ImageReader(sourceOver(bytes)) };
}

describe("a device overrides variable", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIToolTests.swift#UEFIDetailTests.testAnOverridesVariableIsReadAsRules
  it("is read as rules in the details", () => {
    const { image, node, reader } = built();
    const detail = buildNodeDetail(node, image, reader, []);

    expect(detail.fields.find((one) => one.label === "Rules")?.value).toBe("2");
    const table = detail.tables.find((one) => one.title === "Device overrides");
    expect(table?.columns).toEqual(["Action", "Applies to", "Device or properties"]);
    expect(table?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["ADD_DEVICE", "Every device", '[class="USBPort",location="rear-right"]'],
      ["REMOVE_DEVICE", 'class="Sensor"', '(class="Sensor"&location="ALSL")'],
    ]);
  });

  // @web-only the presenter functions are tested here, where upstream tests them through the flow test
  it("is told by its kind and name, and opens as a decompressed text", () => {
    const { node } = built();
    expect(isBZip2Variable(node)).toBe(true);
    expect(isBZip2Variable({ kind: "sysFEntry", name: "other" })).toBe(false);
    expect(isBZip2Variable({ kind: "section", name: "overrides" })).toBe(false);
    expect(unpackedPartName(node, "mac.rom")).toBe("mac_overrides decompressed.txt");
  });
});
