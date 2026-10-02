import { describe, expect, it } from "vitest";
import { DELL_NAMESPACE, dellDriver } from "@/firmware/testing/testDellSetup";
import { dellSettingsIn, settingName, settingOption } from "@/firmware/uefi/dellSetupForms";
import { guidKey } from "@/firmware/uefi/efiGuid";

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
    const tag = [...new TextEncoder().encode("x-UEFI")];
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
