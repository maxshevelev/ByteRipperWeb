import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import stylesheet from "@/app/app.css?raw";
import { COMING_SOON, shown } from "@/tools/me/meaSummary";
import { SummaryView } from "@/tools/me/meTool";
import type { NodeDetail } from "@/tools/toolDetail";
import { field } from "@/tools/toolDetail";
import { ToolDetail } from "@/ui/toolPanel/ToolDetail";

/**
 * What the stylesheet says about selecting text: a class's own `user-select`,
 * for the rules that name one class and nothing else (and the two text fields by
 * element). Compound selectors are left out — none of them is about a detail.
 */
function userSelectRules(): Map<string, string> {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = new Map<string, string>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const value = /(?<!-)user-select:\s*(\w+)/.exec(match[2] ?? "")?.[1];
    if (value === undefined) continue;
    for (const selector of (match[1] ?? "").split(",").map((one: string) => one.trim())) {
      if (/^\.[\w-]+$/.test(selector)) rules.set(selector.slice(1), value);
    }
  }
  return rules;
}

/**
 * Every run of text in `html`, with whether the stylesheet lets it be selected:
 * the nearest ancestor whose class has a rule decides, and with none the body's
 * `none` does. Static markup is well formed, so a tag stack is enough.
 */
function selectability(html: string, rules: Map<string, string>): Map<string, string> {
  const found = new Map<string, string>();
  const stack: string[][] = [];
  for (const token of html.matchAll(/<(\/)?([a-zA-Z][\w-]*)([^>]*?)(\/)?>|([^<]+)/g)) {
    const [, closing, , attributes, selfClosing, text] = token;
    if (text !== undefined) {
      const decided = [...stack]
        .reverse()
        .flat()
        .find((name) => rules.has(name));
      found.set(text.trim(), decided === undefined ? "none" : (rules.get(decided) ?? "none"));
      continue;
    }
    if (closing !== undefined) {
      stack.pop();
      continue;
    }
    const classes = /class="([^"]*)"/.exec(attributes ?? "")?.[1]?.split(/\s+/) ?? [];
    if (selfClosing === undefined) stack.push(classes.reverse());
  }
  return found;
}

/** The details of a node, with a field and a table cell a bench copies from. */
const detail: NodeDetail = {
  title: "BIOS region",
  fields: [field("Offset", "0x00400000"), field("GUID", "8C8CE578-8A3D-4F1C-9935-896185C32DD3")],
  tables: [
    {
      title: "PCH straps",
      symbol: "cpu",
      columns: ["Offset", "Value"],
      rows: [
        [
          { text: "0x0104", tone: "plain" },
          { text: "0xDEADBEEF", tone: "plain" },
        ],
      ],
    },
  ],
};

/**
 * Every value a detail shows can be selected and copied: the fields, the tables'
 * cells, the ME summary's values — which upstream declares per label with
 * `isSelectable`, and which here is the stylesheet's, with nothing else to say
 * so.
 */
describe("the values a detail shows", () => {
  const rules = userSelectRules();

  it("are text, over a body that selects nothing", () => {
    expect(rules.get("tool-detail")).toBe("text");
    expect(rules.get("me-summary-value")).toBe("text");
  });

  // UEFI Structure, FIT and the ME Analyzer all render this one component.
  it("can be selected in the details under a table", () => {
    const html = renderToStaticMarkup(
      <ToolDetail subject="0" detail={detail} placeholder="Select a row" />
    );
    const seen = selectability(html, rules);
    for (const value of [
      "0x00400000",
      "8C8CE578-8A3D-4F1C-9935-896185C32DD3",
      "0x0104",
      "0xDEADBEEF",
    ]) {
      expect(seen.get(value), value).toBe("text");
    }
  });

  it("can be selected in the ME summary", () => {
    const html = renderToStaticMarkup(
      <SummaryView
        blocks={[
          {
            title: "Firmware",
            rows: [
              { label: "Version", value: shown("16.1.25.1865"), tone: "standard" },
              { label: "SKU", value: COMING_SOON, tone: "standard" },
            ],
          },
        ]}
        scrollRef={createRef()}
      />
    );
    expect(selectability(html, rules).get("16.1.25.1865")).toBe("text");
  });
});
