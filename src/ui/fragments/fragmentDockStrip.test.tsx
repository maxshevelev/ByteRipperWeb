import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PanelId } from "@/state/fragmentDock";
import { type DockItem, FragmentDockStrip, type PillCarry } from "@/ui/fragments/FragmentDockStrip";

const part: DockItem = { id: 1 as PanelId, title: "part", isUp: false, hasChanges: false };
const carry: PillCarry = { onTearOff: () => {}, onDragStart: () => {}, onDragEnd: () => {} };

/** The opening tag of the pill's face in `html`. */
const face = (html: string) =>
  html.match(/<button[^>]*class="fragment-pill-face"[^>]*>/)?.[0] ?? "";

describe("a fragment's pill in the dock", () => {
  // A press that does not move is a click: the pill is a button, chosen by its click, which the
  // browser fires as the button comes up and never for a press that became a drag.
  // @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testAPillIsChosenWhenTheButtonComesUp
  // @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testAPillDraggedPastTheThresholdIsCarriedOffNotChosen
  // @upstream-differs the browser counts the threshold and keeps a drag from being a click; what
  // is left to check is that the pill is draggable where a panel can be carried, and only there
  it("is dragged off where a panel can be carried, and is a plain button elsewhere", () => {
    const strip = (withCarry: boolean) =>
      face(
        renderToStaticMarkup(
          <FragmentDockStrip
            items={[part]}
            onSelect={() => {}}
            onClose={() => {}}
            carry={withCarry ? carry : undefined}
          />
        )
      );
    expect(strip(true)).toContain('draggable="true"');
    expect(strip(false)).not.toContain("draggable");
  });

  // The help book's pill is a panel of the window's own, never carried off.
  it("leaves a pill that is not a part's where it is", () => {
    const html = renderToStaticMarkup(
      <FragmentDockStrip
        items={[{ ...part, kind: "help" }]}
        onSelect={() => {}}
        onClose={() => {}}
        carry={carry}
      />
    );
    expect(face(html)).not.toContain("draggable");
  });
});
