import { describe, expect, it } from "vitest";
import {
  allStrapMaps,
  type DescriptorStrapMap,
  fieldsInWord,
  isStrapSet,
  mipProcessorStrapMap,
  strapField,
  strapLocalName,
  strapWordGroup,
} from "@/firmware/uefi/strapMap";
import { requiredStrapMap } from "@/firmware/uefi/strapMapData";

/**
 * A strap word's group: the part of its fields' names they share, which is all the
 * tool says about what a word is.
 */
describe("a strap word's group", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapTests.swift#StrapMapGroupTests.testAWordIsNamedByWhatItsFieldsShare
  it("is what the word's fields share", () => {
    const map = requiredStrapMap("pch69");
    expect(strapWordGroup(map, 1)).toBe("GPCOM4_gpio_sstrap");
    expect(strapWordGroup(map, 13)).toBe("SPI");
    expect(strapWordGroup(map, 28)).toBe("CSME_CSE");
  });

  // Reserved fields are named after their place, and do not cut the group short.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapTests.swift#StrapMapGroupTests.testReservedFieldsAreLeftOut
  it("leaves reserved fields out", () => {
    // fproxy3_LT_Fit_Fallback, fproxy3_spare_softstrap, rsvd_000_8_31
    expect(strapWordGroup(requiredStrapMap("pch69"), 0)).toBe("fproxy3");
  });

  // One named field gives its block, not its own name again.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapTests.swift#StrapMapGroupTests.testAWordOfOneFieldGivesItsBlock
  it("is a lone field's block", () => {
    // SPI_GLOBAL_PROTECTED_RNG_DEF alone
    expect(strapWordGroup(requiredStrapMap("pch69"), 16)).toBe("SPI");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapTests.swift#StrapMapGroupTests.testNamesWithNothingInCommonGiveNoGroup
  it("is nothing where the names share nothing", () => {
    const map: DescriptorStrapMap = {
      name: "test",
      words: 2,
      fields: [
        strapField("PCH_Strap_SPI_a", 0, 0, 0, { defaultValue: 0 }),
        strapField("PCH_Strap_DMI_b", 0, 1, 1, { defaultValue: 0 }),
        strapField("PCH_Strap_rsvd_004_0_31", 1, 0, 31, { defaultValue: 0 }),
      ],
    };
    expect(strapWordGroup(map, 0)).toBeUndefined();
    expect(strapWordGroup(map, 1)).toBeUndefined(); // a word of reserved bits has no block
    expect(strapWordGroup(map, 5)).toBeUndefined(); // nor a word the table does not have
  });

  // Every word of every table at hand: a group, where there is one, is a prefix of a
  // field of that word — never a name made up here.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapTests.swift#StrapMapGroupTests.testEveryGroupIsThePrefixOfAField
  it("is always the prefix of a field", () => {
    for (const map of allStrapMaps()) {
      for (let word = 0; word < map.words; word++) {
        const group = strapWordGroup(map, word);
        if (group === undefined) continue;
        expect(
          fieldsInWord(map, word).some((field) =>
            strapLocalName(field.name).startsWith(`${group}_`)
          ),
          `${map.name} word ${word}: ${group}`
        ).toBe(true);
      }
    }
  });

  // The MFIT CPU strap message's tables: the tool's labels and option words travel with
  // the fields, and no default is claimed — the documents state values per reference
  // platform, not a value the tool builds with.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/StrapMapTests.swift#StrapMapGroupTests.testTheMIPMessageTablesCarryLabelsAndNoDefault
  it("carries the MIP message's labels and no default", () => {
    const table = mipProcessorStrapMap(17) as DescriptorStrapMap;
    const hyperthreading = table.fields.find((field) => field.name === "CPU_Strap_SMT_Disable");
    expect(hyperthreading?.label).toBe("Disable Hyperthreading");
    expect(hyperthreading?.options).toEqual(
      new Map([
        [0, "No"],
        [1, "Yes"],
      ])
    );
    expect(hyperthreading?.defaultValue).toBeUndefined();
    expect(table.fields.every((field) => field.defaultValue === undefined)).toBe(true);
    if (hyperthreading !== undefined)
      expect(isStrapSet({ field: hyperthreading, value: 1 })).toBe(false);
    expect(mipProcessorStrapMap(6)).toBeUndefined();
    expect(mipProcessorStrapMap(20)).toBeDefined();
  });
});
