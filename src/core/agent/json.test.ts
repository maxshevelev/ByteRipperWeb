import { describe, expect, it } from "vitest";
import { integerValue, jsonText, parseJson } from "@/core/agent/json";

/** Ported from `JSONValueTests.swift`. */
describe("JSON values", () => {
  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testEveryKindReadsBack
  it("reads every kind back", () => {
    expect(
      parseJson('{"a":null,"b":true,"c":12,"d":1.5,"e":"x","f":[1,"2"],"g":{"h":false}}')
    ).toEqual({ a: null, b: true, c: 12, d: 1.5, e: "x", f: [1, "2"], g: { h: false } });
  });

  // An address must come back as the integer it was, not as a double that prints with a fraction.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testAnIntegerStaysAnInteger
  it("keeps an integer an integer", () => {
    expect(parseJson("2044928")).toBe(2_044_928);
    expect(jsonText(2_044_928)).toBe("2044928");
    expect(jsonText(0xffff_ffff)).toBe("4294967295");
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testAWholeDoubleReadsAsAnInteger
  it("reads a whole double as an integer", () => {
    expect(integerValue(16.0)).toBe(16);
    expect(integerValue(16.5)).toBeUndefined();
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testABooleanIsNotANumber
  it("tells a boolean from a number", () => {
    expect(parseJson("true")).toBe(true);
    expect(parseJson("1")).toBe(1);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testKeysAreSortedSoTheSameAnswerIsTheSameBytes
  it("sorts keys so the same answer is the same bytes", () => {
    expect(jsonText({ zeta: 1, alpha: 2, mid: { b: 1, a: 2 } })).toBe(
      '{"alpha":2,"mid":{"a":2,"b":1},"zeta":1}'
    );
  });

  // One message, one line: a string's own newline must not end the line.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testANewlineInAStringIsEscaped
  it("escapes a newline in a string", () => {
    const text = jsonText("two\nlines");
    expect(text.includes("\n")).toBe(false);
    expect(text).toBe('"two\\nlines"');
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testSlashesAreNotEscaped
  it("does not escape slashes", () => {
    expect(jsonText("Window/Agent")).toBe('"Window/Agent"');
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testANonFiniteDoubleIsWrittenAsNull
  it("writes a non-finite number as null", () => {
    expect(jsonText(Number.NaN)).toBe("null");
    expect(jsonText([Number.POSITIVE_INFINITY])).toBe("[null]");
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/JSONValueTests.swift#JSONValueTests.testTextThatIsNotJSONThrows
  it("throws on text that is not JSON", () => {
    expect(() => parseJson("{not json")).toThrow();
    expect(() => parseJson("")).toThrow();
  });
});
