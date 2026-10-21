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
    expect(rules.get("me-summary")).toBe("text");
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

/** The rules of the stylesheet that name exactly `selector`, comments left out. */
function declarations(selector: string): string {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  let found = "";
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((one: string) => one.trim());
    if (selectors.includes(selector)) found += match[2] ?? "";
  }
  return found;
}

/**
 * The name column of the list every panel draws its fields with. The browser measures
 * the names, so what is checked is what it is told: the rows share the list's columns,
 * and the name column is held to half the list.
 */
describe("the name column of a detail list", () => {
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testANameThatDoesNotFitHalfTheRowWraps
  // @upstream-differs the cap is the stylesheet's, read from it rather than measured
  it("is one column for every row, never more than half the list, and a name wraps in it", () => {
    expect(declarations(".tool-detail-row")).toMatch(/grid-template-columns:\s*subgrid/);
    expect(declarations(".tool-detail-fields")).toMatch(
      /grid-template-columns:\s*min\(var\(--tool-detail-name, 9\.5em\), calc\(50% - 3px\)\)/
    );
    expect(declarations(".tool-detail-row dt")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testAColumnIsAsWideAsItsWidestName
  // @upstream ByteRipperTests/MEAToolFlowTests.swift#MEAToolFlowTests.testTheNameColumnFitsTheLongestNameAndStopsAtHalfTheList
  // @upstream-differs the column is the stylesheet's, read from it rather than measured
  it("takes the longest name where the list asks, never narrower than the shared column", () => {
    const html = renderToStaticMarkup(
      <ToolDetail
        subject="0"
        detail={{ title: "FTPR", fields: [field("systemHeaderCRCValid", "Yes")], tables: [] }}
        placeholder="Select a row"
        names="longest"
      />
    );
    expect(html).toContain('<dl class="tool-detail-fields" data-names="longest">');
    expect(declarations('.tool-detail-fields[data-names="longest"]')).toMatch(
      /grid-template-columns:\s*fit-content\(calc\(50% - 3px\)\)/
    );
    expect(declarations('.tool-detail-fields[data-names="longest"] dt')).toMatch(
      /min-width:\s*min\(var\(--tool-detail-name, 9\.5em\), calc\(50cqi - 3px\)\)/
    );
    // The shared column where the list does not ask.
    expect(
      renderToStaticMarkup(<ToolDetail subject="0" detail={detail} placeholder="Select a row" />)
    ).toContain('<dl class="tool-detail-fields">');
  });
});

/**
 * The ME Analyzer's Summary is drawn with the same list as the detail under its tree:
 * one list per block, under the block's heading.
 */
describe("the ME Analyzer's Summary", () => {
  const blocks = [
    {
      title: "Firmware",
      rows: [
        { label: "Version", value: shown("16.1.25.1865"), tone: "standard" as const },
        { label: "SKU", value: COMING_SOON, tone: "standard" as const },
      ],
    },
    {
      title: "Messages",
      rows: [{ label: "File System State", value: shown("Configured"), tone: "good" as const }],
    },
  ];
  const html = renderToStaticMarkup(<SummaryView blocks={blocks} scrollRef={createRef()} />);

  it("draws its rows as the detail list's, one list per block", () => {
    expect(html.match(/class="tool-detail-fields"/g)?.length).toBe(2);
    expect(html.match(/class="tool-detail-row"/g)?.length).toBe(3);
    expect(html).toContain("<dt>Version</dt>");
    // Its own column, wider than the detail's, for its long labels.
    expect(html).toContain("--tool-detail-name:calc(200em / 11)");
  });

  it("draws a promise grey and a status in its tone, with the tick", () => {
    expect(html).toMatch(/<dd data-soon="">[^<]*<\/dd>/);
    expect(html).toMatch(/<dd data-tone="good"><svg/);
    expect(declarations(".tool-detail-row dd[data-soon]")).toMatch(/color:\s*var\(--text-faint\)/);
  });
});
