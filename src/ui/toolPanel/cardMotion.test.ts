import { describe, expect, it } from "vitest";
import { playCardMotion, revealFrom } from "@/ui/toolPanel/cardMotion";

describe("the large view's motion", () => {
  it("clips the card to the pane it opens out of", () => {
    // The card at 400..1000 × 30..700; the pane at 20..380 × 400..690.
    const card = { left: 400, top: 30, right: 1000, bottom: 700 };
    const pane = { left: 20, top: 400, right: 380, bottom: 690 };
    expect(revealFrom(pane, card)).toBe("inset(370px 620px 10px -380px round 6px)");
  });

  it("shows the card at once with nothing to open out of", async () => {
    const element = {
      animate: () => ({ finished: new Promise(() => {}) }),
    } as unknown as HTMLElement;
    await expect(playCardMotion(element, undefined, true)).resolves.toBeUndefined();
  });
});
