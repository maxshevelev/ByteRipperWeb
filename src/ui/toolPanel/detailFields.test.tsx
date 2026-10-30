import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import stylesheet from "@/app/app.css?raw";
import { detailCopyText } from "@/ui/toolPanel/detailCopy";
import { DetailFields, type FieldHelp, type ListedField } from "@/ui/toolPanel/ToolDetail";

/**
 * The detail list's second value and a row's `?` (`ToolFieldList`): read off the markup
 * the list renders and the stylesheet's rules, the browser doing the layout.
 */

const row = (label: string, value: string, extra: Partial<ListedField> = {}): ListedField => ({
  label,
  value,
  tone: "standard",
  ...extra,
});

const help: FieldHelp = {
  identifier: "MELanPowerWell",
  text: "LAN Power Well.",
  buttonName: "Setting help",
  buttonTooltip: "What the tool says",
};

const markup = (fields: readonly ListedField[]) =>
  renderToStaticMarkup(<DetailFields fields={fields} />);

/** The rows of `html` as the copy takes them, with each row's elements a tab apart. */
function copied(html: string): string {
  // A minimal tree of the markup, enough for the copy's walk: elements with classes and text.
  type Node = {
    nodeType: number;
    nodeName: string;
    textContent: string | null;
    childNodes: Node[];
    className?: string;
  };
  const root: Node = { nodeType: 11, nodeName: "#fragment", textContent: null, childNodes: [] };
  const stack: Node[] = [root];
  for (const token of html.matchAll(/<(\/)?([a-zA-Z][\w-]*)([^>]*?)(\/)?>|([^<]+)/g)) {
    const [, closing, name, attributes, selfClosing, text] = token;
    const top = stack.at(-1) as Node;
    if (text !== undefined) {
      top.childNodes.push({ nodeType: 3, nodeName: "#text", textContent: text, childNodes: [] });
    } else if (closing !== undefined) {
      stack.pop();
    } else {
      const classes = /class="([^"]*)"/.exec(attributes ?? "")?.[1]?.split(/\s+/) ?? [];
      const element: Node = {
        nodeType: 1,
        nodeName: (name ?? "").toUpperCase(),
        textContent: null,
        childNodes: [],
        className: classes.join(" "),
      };
      top.childNodes.push(element);
      if (selfClosing === undefined && !["wbr", "path", "circle"].includes(name ?? ""))
        stack.push(element);
    }
  }
  return detailCopyText(root as never);
}

describe("a row's `?`", () => {
  // The `?` a row carries where the tool it came from has something to say about it, and
  // no button at all where it has nothing: a control that opens an empty popover is worse
  // than no control. The button's words are the panel's, carried on the help.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testOnlyARowWithHelpCarriesAButton
  it("is carried only by a row with help", () => {
    const html = markup([row("LAN Power Well", "Enabled", { help }), row("Auto", "No")]);
    expect(html.match(/tool-detail-row-help/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Setting help"');
    expect(html).toContain('title="What the tool says"');
  });

  // The button follows the name, right after its last word — inside the name's cell.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testTheButtonFollowsTheName
  // @upstream-differs where the button sits is the name cell's flow, not a frame this computes
  it("follows the name", () => {
    const html = markup([row("LAN Power Well", "Enabled", { help })]);
    expect(html).toMatch(/<dt>LAN Power Well<button[^>]*class="tool-detail-row-help"/);
  });

  // The pointer over the `?` is an arrow, not the text's I-beam.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testTheButtonIsNotUnderTheIBeam
  it("is under an arrow", () => {
    const rule = /\.tool-detail-row-help\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";
    expect(rule).toMatch(/cursor:\s*default/);
    expect(rule).toMatch(/user-select:\s*none/);
  });

  // Pressing the button hands the panel the words and the button to hang a popover off.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testPressingTheButtonAsksThePanelForTheHelp
  it("hands the panel the help and the button", () => {
    const asked: [FieldHelp, unknown][] = [];
    const element = DetailFields({
      fields: [row("LAN Power Well", "Enabled", { help })],
      onHelp: (one, button) => asked.push([one, button]),
    });
    // The rendered tree: the list, its row, the name cell, the button inside it.
    const find = (node: unknown): { props: { onClick?: (event: unknown) => void } } | undefined => {
      if (node === null || typeof node !== "object") return undefined;
      const props = (node as { props?: Record<string, unknown> }).props;
      if (props === undefined) return undefined;
      if (props.className === "tool-detail-row-help") return node as never;
      if (typeof (node as { type?: unknown }).type === "function") {
        const rendered = (node as { type: (p: unknown) => unknown }).type(props);
        return find(rendered);
      }
      const children = props.children;
      for (const child of (Array.isArray(children) ? children : [children]).flat(4)) {
        const found = find(child);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const button = find(element);
    const target = { tagName: "BUTTON" };
    button?.props.onClick?.({ currentTarget: target });
    expect(asked).toEqual([[help, target]]);
  });
});

describe("a second value", () => {
  // A row that compares two copies of one thing: the second value is a column of its own
  // — the same width as the first, so the two line up down the list — and the copy of a
  // row carries the three parts, a tab apart.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testASecondValueIsAColumnOfItsOwn
  it("is a column of its own", () => {
    const html = markup([
      row("EomFirstBootEnabled", "No", { second: { value: "Yes" } }),
      row("FlexibleEomSettings", "Lock Descriptor Only", {
        second: { value: "Lock Descriptor Only" },
      }),
    ]);
    expect(html).toContain("data-second");
    const columns = /\.tool-detail-fields\[data-second\]\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";
    expect(columns).toMatch(/minmax\(0, 1fr\) minmax\(0, 1fr\)/);
    expect(copied(html)).toBe(
      "EomFirstBootEnabled\tNo\tYes\nFlexibleEomSettings\tLock Descriptor Only\tLock Descriptor Only"
    );
  });

  // A row without a second value is the plain name/value row: the value has everything
  // the name column leaves, and there is no third part to select.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testARowWithoutASecondValueIsUnchanged
  it("leaves a row without one unchanged", () => {
    const html = markup([row("Kind", "File")]);
    expect(html).not.toContain("data-second");
    expect(html).not.toContain("data-spans");
    expect(copied(html)).toBe("Kind\tFile");
    // In a list that compares, a row with one value spans both value columns.
    const mixed = markup([row("Kind", "File"), row("A", "1", { second: { value: "2" } })]);
    expect(mixed.match(/data-spans/g)).toHaveLength(1);
  });

  // A drag selects across the second value of one row into the name of the next.
  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/ToolFieldListTests.swift#ToolFieldListTests.testADragIntoTheSecondValueTakesIt
  // @upstream-differs the browser selects across the cells; what is checked is the copy of the rows
  it("is taken with a band of rows", () => {
    const html = markup([
      row("A", "1", { second: { value: "2" } }),
      row("B", "3", { second: { value: "4" } }),
    ]);
    expect(copied(html)).toBe("A\t1\t2\nB\t3\t4");
  });
});
