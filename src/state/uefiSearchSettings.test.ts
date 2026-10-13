import { describe, expect, it } from "vitest";
import { parseSearchState } from "@/state/uefiSearchSettings";

describe("the stored search", () => {
  /** @web-only localStorage holds the panel defaults */
  it("reads what was stored, as codes and text", () => {
    const state = parseSearchState('{"text":"Setup","type":66,"subtype":7,"isOpen":true}');
    expect(state).toEqual({
      query: { text: "Setup", type: 66, subtype: 7 },
      mode: "names",
      content: { text: "", wholeTree: true },
      isOpen: true,
      focusToken: 0,
    });
  });

  /** @web-only */
  it("drops a subtype the type has none for, and anything of another shape", () => {
    expect(parseSearchState('{"text":"a","type":65,"subtype":7}').query.subtype).toBeUndefined();
    expect(parseSearchState('{"text":3,"type":"x"}')).toEqual({
      query: { text: "", type: undefined, subtype: undefined },
      mode: "names",
      content: { text: "", wholeTree: true },
      isOpen: false,
      focusToken: 0,
    });
    expect(parseSearchState("not json").query.text).toBe("");
    expect(parseSearchState(null).isOpen).toBe(false);
  });

  // What the Contents search asks for is kept as text and a flag, "from the selection" stored so
  // that a bench that never touched the box searches the whole tree.
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFISearchSettings.swift#UEFISearchSettings.content
  it("reads the Contents search's mode, text and scope", () => {
    const state = parseSearchState(
      '{"mode":"contents","contentText":"GH51G","contentFromSelection":true}'
    );
    expect(state.mode).toBe("contents");
    expect(state.content).toEqual({ text: "GH51G", wholeTree: false });
    expect(parseSearchState('{"mode":"other"}').mode).toBe("names");
  });
});
