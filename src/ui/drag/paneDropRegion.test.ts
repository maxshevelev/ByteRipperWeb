import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginPaneDrag, draggedPaneId, endDrag, paneDragStore } from "@/state/paneDragStore";
import { PANE_DRAG_TYPE, PANE_DROP_NONE, type PaneDropOutcome } from "@/ui/drag/dragDrop";
import { paneDropRegion } from "@/ui/drag/PaneDropBands";

/**
 * Where a drop lands, from the pointer's own place (§22.4). A dragging gesture
 * cannot be tested, but the rule that reads the pointer can: the region's
 * handlers are plain functions over the event, so the whole of the interesting
 * part — which of the four zones a point belongs to — is decided with a rectangle
 * and two numbers.
 *
 * The one thing a browser makes necessary, and upstream does not: the bands of a
 * single-file workspace divide **one half** of the view, and the region's element
 * is the whole of it. A band is a share of the half's height, so the height alone
 * answers for the free half too when the split is side by side — which is what
 * these tests exist to keep from coming back.
 */

beforeEach(() => {
  endDrag();
});

/** The bands' box: the left half of a 1000 × 400 view, as `getBoundingClientRect` would give it. */
const BANDS_BOX = { left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 };

interface Stub {
  readonly event: React.DragEvent;
  readonly transfer: { types: string[]; dropEffect: string };
  readonly prevented: () => boolean;
  readonly stopped: () => boolean;
}

/** A drag event with just what the region reads off one. */
function dragEvent(options: {
  readonly x: number;
  readonly y: number;
  readonly types?: readonly string[];
  readonly altKey?: boolean;
}): Stub {
  const transfer = { types: [...(options.types ?? [])], dropEffect: "none" };
  let prevented = false;
  let stopped = false;
  return {
    event: {
      clientX: options.x,
      clientY: options.y,
      altKey: options.altKey ?? false,
      dataTransfer: transfer,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    } as unknown as React.DragEvent,
    transfer,
    prevented: () => prevented,
    stopped: () => stopped,
  };
}

/**
 * A single-file workspace's region: the free half is the fourth zone, and the
 * bands divide the half the open file sits in.
 */
function singleFileRegion(outcomeFor: () => PaneDropOutcome = () => PANE_DROP_NONE) {
  const bands = { current: { getBoundingClientRect: () => BANDS_BOX } as unknown as HTMLElement };
  return paneDropRegion({
    bands,
    outcomeFor: () => outcomeFor(),
    fallbackBand: "addSecond",
    onPaneDropped: vi.fn(),
    onFilesDropped: vi.fn(),
  });
}

/** Somewhere inside the bands' box: a share of its height, and inside its edges. */
const inBands = (y: number) => ({ x: 250, y });

/** The file drag the browser hands a region: the "Files" type, and nothing else. */
const FILES = { types: ["Files"] };

describe("the drop region's bands", () => {
  it("answers with the band the pointer is over", () => {
    const region = singleFileRegion();

    // The two clamped strips at either end, and the replace band between them.
    region.onDragOver(dragEvent({ ...inBands(10), ...FILES }).event);
    expect(paneDragStore.getSnapshot().zone).toBe("insertAtStart");

    region.onDragOver(dragEvent({ ...inBands(200), ...FILES }).event);
    expect(paneDragStore.getSnapshot().zone).toBe("replace");

    region.onDragOver(dragEvent({ ...inBands(390), ...FILES }).event);
    expect(paneDragStore.getSnapshot().zone).toBe("appendAtEnd");
  });

  it("answers with the free half when the pointer is beside the bands", () => {
    // Side by side, the free half shares the bands' vertical range and none of
    // their width. Asked by height alone, a point in it lands on a band of the
    // half the pointer is not in — and the free half, whose whole purpose is to
    // be a target, is never the answer.
    const region = singleFileRegion();

    region.onDragOver(dragEvent({ x: 750, y: 200, ...FILES }).event);
    expect(paneDragStore.getSnapshot().zone).toBe("addSecond");
  });

  it("answers with the free half when the pointer is past the bands", () => {
    // Stacked, the free half is below the bands rather than beside them.
    const region = singleFileRegion();

    region.onDragOver(dragEvent({ x: 250, y: 500, ...FILES }).event);
    expect(paneDragStore.getSnapshot().zone).toBe("addSecond");
  });

  it("takes the free half's own edges as outside the bands", () => {
    // The box's right edge and its bottom edge belong to the half next to it,
    // as upstream's `bounds.contains` has them — its comparisons are half-open.
    const region = singleFileRegion();

    region.onDragOver(dragEvent({ x: 500, y: 200, ...FILES }).event);
    expect(paneDragStore.getSnapshot().zone).toBe("addSecond");

    region.onDragOver(dragEvent({ x: 250, y: 400, ...FILES }).event);
    expect(paneDragStore.getSnapshot().zone).toBe("addSecond");
  });

  it("takes a file in its stride and raises the session for the whole workspace", () => {
    // A file entering one region is what tells the *other* panes' bands to come
    // up, and only this store reaches them.
    const region = singleFileRegion();
    expect(paneDragStore.getSnapshot().inFlight).toBeUndefined();

    const drag = dragEvent({ ...inBands(200), ...FILES });
    region.onDragOver(drag.event);
    expect(paneDragStore.getSnapshot().inFlight).toBe("file");
    expect(drag.prevented()).toBe(true);
    expect(drag.transfer.dropEffect).toBe("copy");
  });

  it("refuses a band with nothing to offer, by the cursor and not the flight", () => {
    // Over the pane's own middle band, a pane drop means nothing: the region
    // stops the event from reaching what is behind it, but never accepts it —
    // so no drop happens, rather than one that is swallowed and ignored.
    beginPaneDrag("a");
    const region = singleFileRegion();
    const drag = dragEvent({ ...inBands(200), types: [PANE_DRAG_TYPE] });

    region.onDragOver(drag.event);
    expect(drag.prevented()).toBe(false);
    expect(drag.stopped()).toBe(true);
    expect(drag.transfer.dropEffect).toBe("none");
    expect(paneDragStore.getSnapshot().zone).toBeUndefined();
    // The refusal takes the bands down, never the flight — or every band after
    // this one answers "no" for the rest of the gesture.
    expect(draggedPaneId()).toBe("a");
  });

  it("accepts a pane on a band that copies, and says so with the cursor", () => {
    const region = singleFileRegion(() => ({ kind: "duplicate", intoPane: "b" }));
    const drag = dragEvent({ x: 750, y: 200, types: [PANE_DRAG_TYPE] });

    region.onDragOver(drag.event);
    expect(drag.prevented()).toBe(true);
    expect(drag.transfer.dropEffect).toBe("copy");
    expect(paneDragStore.getSnapshot().zone).toBe("addSecond");
  });
});
