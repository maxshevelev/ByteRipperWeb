import { describe, expect, it } from "vitest";
import { readAppleOverrides, unpackedOverrides } from "@/firmware/uefi/appleOverrides";

/** Four rules of the kinds a MacBook's store holds, through `bzip2`. */
const STREAM = Uint8Array.from(
  "425a6839314159265359a52f443e000022df804030116644423f66dfaaafefde203000bab0854f53d4c4f44da08da1327a99a4da6a699300344d43126269e898834003d41a1a641914f54686869a34d1a069a03d403d27a42cd1a548a0566c3a9298074e08cb7fd442512908264221251151decb630733950849be563aa43f0a8142d2d6428fd35e4187a1828ea0ca98fb2338397d85e590c97146052a3c5654e6646f90d9382f0b487f32f08cd05bb6bad6833aa2396e5b23a5d87085ec0e7cf4b814d47ec322904ec27a2962c5c41f94b8e2a6b4c4d9d349d10c6b048e2ccd052d70203382c8bf8bb9229c28485297a21f00".match(
    /../g
  ) ?? [],
  (pair) => Number.parseInt(pair, 16)
);

describe("Apple's device overrides", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleOverridesTests.swift#AppleOverridesTests.testEachLineIsARuleWithItsThreeFields
  it("reads each line as a rule with its three fields", () => {
    const overrides = readAppleOverrides(STREAM);
    expect(overrides?.rules.map((rule) => rule.action)).toEqual([
      "ADD_DEVICE",
      "ADD_DEVICE",
      "SET_PROPERTY",
      "REMOVE_DEVICE",
    ]);
    expect(overrides?.rules[0]?.appliesTo).toBe("");
    expect(overrides?.rules[0]?.detail).toBe('[class="USBPort",location="rear-right",speed="480"]');
    expect(overrides?.rules[1]?.appliesTo).toBe('class="VideoController"&model="WHPRO"');
    expect(overrides?.rules[3]?.detail).toBe('(class="Sensor"&location="ALSL")');
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AppleOverridesTests.swift#AppleOverridesTests.testDataThatIsNotBzip2IsNotOverrides
  it("does not take data that is not bzip2 for overrides", () => {
    expect(
      readAppleOverrides(Uint8Array.from("ADD_DEVICE", (c) => c.charCodeAt(0)))
    ).toBeUndefined();
    expect(readAppleOverrides(new Uint8Array())).toBeUndefined();
    expect(unpackedOverrides(new Uint8Array())).toBeUndefined();
  });
});
