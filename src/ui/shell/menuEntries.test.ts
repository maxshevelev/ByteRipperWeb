/**
 * The menu's own tidying.
 *
 * Sections come and go with what is open — no file means no Save, one file
 * means no difference navigation — so the entries are built with holes in them
 * and the holes have to close without leaving a rule floating above nothing.
 */

import { expect, it } from "vitest";
import { compactEntries, type MenuEntry, sectionsOf } from "@/ui/shell/menuModel";

const action = (label: string): MenuEntry => ({ label, onSelect: () => undefined });
const separator: MenuEntry = { kind: "separator" };
const heading = (label: string): MenuEntry => ({ kind: "heading", label });
const section = (label: string): MenuEntry => ({ kind: "heading", label, opensMenu: true });
const labels = (entries: readonly MenuEntry[]) =>
  entries.map((entry) =>
    entry.kind === "separator" ? "──" : entry.kind === "heading" ? `[${entry.label}]` : entry.label
  );

it("drops the holes where a section was", () => {
  expect(labels(compactEntries([action("New"), undefined, undefined, action("Open")]))).toEqual([
    "New",
    "Open",
  ]);
});

it("never opens with a separator, and never doubles one", () => {
  expect(
    labels(compactEntries([separator, action("New"), separator, separator, action("Open")]))
  ).toEqual(["New", "──", "Open"]);
});

it("drops a heading with nothing under it", () => {
  // Every command in the section was unavailable, so the section is not there.
  expect(
    labels(compactEntries([action("New"), separator, heading("Edit"), separator, action("Find")]))
  ).toEqual(["New", "──", "Find"]);
});

it("never ends on a separator or a heading", () => {
  expect(labels(compactEntries([action("New"), separator]))).toEqual(["New"]);
  expect(labels(compactEntries([action("New"), separator, heading("View")]))).toEqual(["New"]);
});

it("leaves a well-formed menu alone", () => {
  const entries = [heading("File"), action("New"), separator, heading("Edit"), action("Find")];
  expect(labels(compactEntries(entries))).toEqual(["[File]", "New", "──", "[Edit]", "Find"]);
});

// The commands menu's two levels: the first is the names, the second the open
// section's commands, and what stands before the first name is not a level.

it("opens a section at every heading that opens a menu, and gives it its commands", () => {
  const entries = compactEntries([
    section("File"),
    action("New"),
    separator,
    action("Open"),
    section("Edit"),
    action("Find"),
    { kind: "heading", label: "A group" },
    action("Fill"),
    section("View"),
    action("Minimap"),
  ]);

  const sections = sectionsOf(entries);
  expect(sections.map((section) => section.label)).toEqual(["File", "Edit", "View"]);
  expect(labels(sections[0]?.items ?? [])).toEqual(["New", "──", "Open"]);
  expect(labels(sections[1]?.items ?? [])).toEqual(["Find", "[A group]", "Fill"]);
  expect(labels(sections[2]?.items ?? [])).toEqual(["Minimap"]);
});

it("keeps a heading that does not open a menu inside its section", () => {
  const sections = sectionsOf([
    section("File"),
    action("Open"),
    { kind: "heading", label: "Open Recent" },
    action("a.bin"),
  ]);

  expect(sections.map((section) => section.label)).toEqual(["File"]);
  expect(labels(sections[0]?.items ?? [])).toEqual(["Open", "[Open Recent]", "a.bin"]);
});

it("lets what stands before the first name stand nowhere at the first level", () => {
  const sections = sectionsOf([action("Settings"), separator, section("File"), action("Open")]);

  expect(sections.map((section) => section.label)).toEqual(["File"]);
  expect(labels(sections[0]?.items ?? [])).toEqual(["Open"]);
});
