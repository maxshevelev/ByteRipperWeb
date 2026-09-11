/**
 * The menu's own tidying.
 *
 * Sections come and go with what is open — no file means no Save, one file
 * means no difference navigation — so the entries are built with holes in them
 * and the holes have to close without leaving a rule floating above nothing.
 */

import { expect, it } from "vitest";
import { compactEntries, type MenuEntry } from "@/ui/shell/MenuButton";

const action = (label: string): MenuEntry => ({ label, onSelect: () => undefined });
const separator: MenuEntry = { kind: "separator" };
const heading = (label: string): MenuEntry => ({ kind: "heading", label });
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
