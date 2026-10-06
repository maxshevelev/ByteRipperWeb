import { describe, expect, it } from "vitest";
import { parseSearchState } from "@/state/uefiSearchSettings";

describe("the stored search", () => {
  /** @web-only localStorage holds the panel defaults */
  it("reads what was stored, as codes and text", () => {
    const state = parseSearchState('{"text":"Setup","type":66,"subtype":7,"isOpen":true}');
    expect(state).toEqual({ query: { text: "Setup", type: 66, subtype: 7 }, isOpen: true });
  });

  /** @web-only */
  it("drops a subtype the type has none for, and anything of another shape", () => {
    expect(parseSearchState('{"text":"a","type":65,"subtype":7}').query.subtype).toBeUndefined();
    expect(parseSearchState('{"text":3,"type":"x"}')).toEqual({
      query: { text: "", type: undefined, subtype: undefined },
      isOpen: false,
    });
    expect(parseSearchState("not json").query.text).toBe("");
    expect(parseSearchState(null).isOpen).toBe(false);
  });
});
