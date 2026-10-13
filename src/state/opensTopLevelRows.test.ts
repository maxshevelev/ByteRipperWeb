import { describe, expect, it } from "vitest";
import { showItemWishes, takeShowItemAt, wishShowItemAt } from "@/state/opensTopLevelRows";

/**
 * The node a part's UEFI panel is to show: wished by whoever opens or raises the part, heard by a
 * panel already up, taken once.
 *
 * @web-only the wish is the web's way to a session upstream holds
 */
describe("a wish to show a node", () => {
  it("is heard by a panel already up, and taken once", () => {
    const heard: number[] = [];
    const stop = showItemWishes.subscribe(() => {
      const wish = showItemWishes.getSnapshot().get("part:7");
      if (wish !== undefined) heard.push(wish.start);
    });
    wishShowItemAt("part:7", 0x10, 0x40);
    expect(heard).toEqual([0x10]);
    expect(takeShowItemAt("part:7")).toEqual({ start: 0x10, end: 0x40 });
    expect(takeShowItemAt("part:7")).toBeUndefined();
    // A second place, the part already up: heard again.
    wishShowItemAt("part:7", 0x80);
    expect(heard).toEqual([0x10, 0x80]);
    expect(takeShowItemAt("part:7")).toEqual({ start: 0x80, end: undefined });
    stop();
  });
});
