import { describe, expect, it } from "vitest";
import { encodeUtf8 } from "@/core/text/utf";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { DELL_NAMESPACE, dellDriver } from "@/firmware/testing/testDellSetup";
import {
  compressionSection,
  image,
  section,
  sectionedFile,
  volume,
} from "@/firmware/testing/testImage";
import { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import {
  dellSettingsIn,
  PE32_SECTION,
  settingName,
  settingOption,
} from "@/firmware/uefi/dellSetupForms";
import { DVAR } from "@/firmware/uefi/dvarParser";
import { guidBytes, guidKey } from "@/firmware/uefi/efiGuid";
import { DEFAULT_LIMITS } from "@/firmware/uefi/parserState";
import { dvarSettingsOfTree, rootsOf, stampIds } from "@/firmware/uefi/treeMaterialization";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";

/** Ported from `DellSetupFormsTests.swift`: what Dell's Setup forms say a DVAR variable is. */

const at = (nameId: number) => `${guidKey(DELL_NAMESPACE)}|${nameId}`;

describe("Dell's Setup forms", () => {
  // A question is tied to the variable the opcode right after it names, and reads
  // as its page words it — keyword, prompt, help and page.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#DellSetupFormsTests.testAQuestionIsTiedToTheVariableTheOpcodeAfterItNames
  it("ties a question to the variable the opcode after it names", () => {
    const downgrade = dellSettingsIn(dellDriver()).get(at(0x535));

    expect(downgrade?.prompt).toBe("Allow BIOS Downgrade");
    expect(downgrade?.keyword).toBe("AllowBiosDowngrade");
    // The keyword names the row.
    expect(downgrade === undefined ? undefined : settingName(downgrade)).toBe("AllowBiosDowngrade");
    expect(downgrade?.help).toBe("Lets an older BIOS be flashed.");
    expect(downgrade?.form).toBe("Security");
    expect(downgrade?.kind).toBe("checkbox");
  });

  // A list's values are called what its options say; the keyword leaves out the
  // condition some carry after it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#DellSetupFormsTests.testAListsValuesAreItsOptions
  it("calls a list's values what its options say", () => {
    const mode = dellSettingsIn(dellDriver()).get(at(0x40));

    expect(mode?.kind).toBe("oneOf");
    expect(mode?.keyword).toBe("BootMode");
    expect(mode?.options.map((one) => one.text)).toEqual(["Legacy", "UEFI"]);
    expect(mode === undefined ? undefined : settingOption(mode, 1n)).toBe("UEFI");
    expect(mode === undefined ? "none" : settingOption(mode, 2n)).toBeUndefined();
  });

  // Dell's opcode after some other opcode is about that one, not about the question
  // before both.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#DellSetupFormsTests.testAnOpcodeAfterSomethingElseTiesNothing
  it("ties nothing to an opcode that follows something else", () => {
    const settings = dellSettingsIn(dellDriver());

    expect(settings.get(at(0x600))).toBeUndefined();
    expect(settings.size).toBe(2);
  });

  // Without keywords the prompt names the row.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#DellSetupFormsTests.testWithoutKeywordsThePromptNamesIt
  it("names a row by its prompt without keywords", () => {
    const driver = dellDriver();
    const tag = [...encodeUtf8("x-UEFI")];
    let found = -1;
    for (let index = 0; index + tag.length <= driver.length && found < 0; index++) {
      if (tag.every((byte, offset) => driver[index + offset] === byte)) found = index;
    }
    expect(found).toBeGreaterThanOrEqual(0);
    // A tag that is not printable is no package.
    driver[found] = 0x01;
    const downgrade = dellSettingsIn(driver).get(at(0x535));

    expect(downgrade?.keyword).toBeUndefined();
    expect(downgrade === undefined ? undefined : settingName(downgrade)).toBe(
      "Allow BIOS Downgrade"
    );
  });
});

/** A DVAR store with one stored entry declaring the namespace, as `DvarParserTests.store` builds it. */
function dvarStoreBytes(): number[] {
  const bytes = [0x44, 0x56, 0x41, 0x52];
  const sizeC = 0xffff_ffff - 0x100;
  for (let index = 0; index < 4; index++) bytes.push(Math.floor(sizeC / 2 ** (8 * index)) & 0xff);
  bytes.push(0xff - 0x83);
  bytes.push(
    0xff - DVAR.stored,
    0xff - (DVAR.flagNameId | DVAR.flagNamespaceGuid),
    0xff - DVAR.nameId8Size8,
    0xff - 0x07,
    0xff - 1
  );
  bytes.push(...guidBytes(DELL_NAMESPACE));
  bytes.push(0xff - 0x40, 0xff - 1, 1);
  while (bytes.length < 0x100) bytes.push(0xff);
  return bytes;
}

describe("the tree and Dell's Setup forms", () => {
  // A DVAR store beside a volume whose driver is in a compressed section: the
  // tree reads the forms off a copy of itself, and an entry is named by what its
  // question is.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#DellSetupFormsTests.testTheTreeReadsTheFormsOfAnImageWithADvarStore
  it("reads the forms of an image with a DVAR store", () => {
    const driver = sectionedFile({
      sections: [compressionSection(0, section({ type: PE32_SECTION, body: dellDriver() }))],
    });
    const bytes = Uint8Array.from([
      ...image({ volume: volume({ length: 0x1000, files: [driver] }) }),
      ...dvarStoreBytes(),
      ...new Array<number>(0x100).fill(0xff),
    ]);
    const entry = parseUefiImage(sourceOver(bytes)).allNodes.find(
      (node) => node.kind === "dvarEntry"
    );
    const reader = new ImageReader(sourceOver(bytes));
    const roots = stampIds(rootsOf(reader, DEFAULT_LIMITS).nodes, []);
    const catalogue = dvarSettingsOfTree(
      roots,
      bytes.length,
      reader,
      DEFAULT_LIMITS,
      new DecompressedBuffers()
    );

    const setting = entry === undefined ? undefined : catalogue.settingFor(entry);
    expect(setting === undefined ? undefined : settingName(setting)).toBe("BootMode");
    expect(catalogue.settings.size).toBe(2);
  });

  // No DVAR store, nothing to name: the catalogue is empty.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#DellSetupFormsTests.testAnImageWithoutAStoreHasNoSettings
  it("has no settings for an image without a store", () => {
    const driver = sectionedFile({
      sections: [section({ type: PE32_SECTION, body: dellDriver() })],
    });
    const bytes = image({ volume: volume({ length: 0x1000, files: [driver] }) });
    const reader = new ImageReader(sourceOver(bytes));
    const roots = stampIds(rootsOf(reader, DEFAULT_LIMITS).nodes, []);
    const catalogue = dvarSettingsOfTree(
      roots,
      bytes.length,
      reader,
      DEFAULT_LIMITS,
      new DecompressedBuffers()
    );

    expect(catalogue.isEmpty).toBe(true);
  });
});
