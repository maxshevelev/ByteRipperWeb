import { describe, expect, it } from "vitest";
import {
  mergeAnnotations,
  NO_SHARED_ANNOTATIONS,
  type SharedAnnotation,
  type SharedAnnotations,
} from "@/core/agent/annotationMerge";

const note = (id: string, title = id, relatedTo: string[] = []): SharedAnnotation => ({
  id,
  file: { kind: "disk", identity: { name: "bios.bin", size: 16, modified: 1, path: "/b" } },
  title,
  note: "",
  relatedTo,
});

const version = (
  items: SharedAnnotation[],
  more: Partial<Omit<SharedAnnotations, "items">> = {}
): SharedAnnotations => ({
  items,
  order: items.map((one) => one.id).reverse(),
  fresh: [],
  unseen: [],
  nextId: 1 + items.length,
  ...more,
});

const titles = (merged: SharedAnnotations) =>
  Object.fromEntries(merged.items.map((one) => [one.id, one.title]));

describe("two windows' annotations put together", () => {
  it("takes what the other window changed when nothing changed here", () => {
    const base = version([note("a1"), note("a2")]);
    const theirs = version([note("a1", "renamed"), note("a3")], { nextId: 4 });
    const { merged } = mergeAnnotations(base, base, theirs);
    expect(titles(merged)).toEqual({ a1: "renamed", a3: "a3" });
    expect(merged.nextId).toBe(4);
  });

  it("keeps what was changed here on top of what the other window changed", () => {
    const base = version([note("a1"), note("a2"), note("a3")]);
    const mine = version([note("a1", "edited here"), note("a3"), note("a4")], { nextId: 5 });
    const theirs = version([note("a1"), note("a2", "edited there"), note("a3")]);
    const { merged, renamed } = mergeAnnotations(base, mine, theirs);
    expect(titles(merged)).toEqual({ a1: "edited here", a3: "a3", a4: "a4" });
    expect(renamed.size).toBe(0);
  });

  it("leaves an annotation removed in either window removed", () => {
    const base = version([note("a1"), note("a2")]);
    const mine = version([note("a1", "edited here"), note("a2")]);
    const theirs = version([note("a2")]);
    expect(titles(mergeAnnotations(base, mine, theirs).merged)).toEqual({ a2: "a2" });
  });

  it("gives an annotation made here a new id when the other window made one under it meanwhile", () => {
    const base = version([note("a1")]);
    const mine = version([note("a1"), note("a2", "mine"), note("a3", "about mine", ["a2"])], {
      nextId: 4,
    });
    const theirs = version([note("a1"), note("a2", "theirs")], { nextId: 3 });
    const { merged, renamed } = mergeAnnotations(base, mine, theirs);
    expect(renamed).toEqual(new Map([["a2", "a4"]]));
    expect(titles(merged)).toEqual({ a1: "a1", a2: "theirs", a4: "mine", a3: "about mine" });
    expect(merged.items.find((one) => one.id === "a3")?.relatedTo).toEqual(["a4"]);
    expect(merged.nextId).toBe(5);
  });

  it("puts the cards made here in front of the other window's order", () => {
    const base = version([note("a1"), note("a2")], { order: ["a2", "a1"] });
    const mine = version([note("a1"), note("a2"), note("a5")], { order: ["a5", "a2", "a1"] });
    const theirs = version([note("a1"), note("a2")], { order: ["a1", "a2"] });
    expect(mergeAnnotations(base, mine, theirs).merged.order).toEqual(["a5", "a1", "a2"]);
  });

  it("keeps a card moved here when the other window moved none", () => {
    const base = version([note("a1"), note("a2")], { order: ["a2", "a1"] });
    const mine = version([note("a1"), note("a2")], { order: ["a1", "a2"] });
    expect(mergeAnnotations(base, mine, base).merged.order).toEqual(["a1", "a2"]);
  });

  it("puts together which are new and which are unseen the same way", () => {
    const items = [note("a1"), note("a2"), note("a3")];
    const base = version(items, { unseen: ["a1", "a2"] });
    const mine = version(items, { unseen: ["a2", "a3"] });
    const theirs = version(items, { unseen: ["a1"] });
    expect(mergeAnnotations(base, mine, theirs).merged.unseen).toEqual(["a3"]);
  });

  it("starts from nothing agreed: everything here and there is kept", () => {
    const mine = version([note("a1", "read from the database")]);
    const theirs = version([note("a1", "read from the database"), note("a2")]);
    expect(titles(mergeAnnotations(NO_SHARED_ANNOTATIONS, mine, theirs).merged)).toEqual({
      a1: "read from the database",
      a2: "a2",
    });
  });
});
