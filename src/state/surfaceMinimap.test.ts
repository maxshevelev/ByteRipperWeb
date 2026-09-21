import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import {
  forgetPartMinimap,
  frontMap,
  mapOn,
  minimapStore,
  setMinimapMode,
  setMinimapVisible,
  setMinimapWidth,
  toggleMinimap,
} from "@/state/minimapStore";
import {
  closePart,
  foldParts,
  openEmptyInPane,
  openPart,
  WORKSPACE_SURFACE,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * A map per surface: the workspace's two panes share one, being a comparison
 * binned over the longer of the two, and every part opened over them has a map
 * of its own, of its own bytes and its own length (`Design/GAPS.md` G50).
 *
 * The building itself is a worker's and is not driven here — nothing below
 * gives a map a row count, which is what a rebuild needs.
 *
 * @upstream ByteRipperApp/Minimap/SurfaceMinimapController.swift#SurfaceMinimapController
 * @upstream ByteRipperTests/FragmentMinimapTests.swift#FragmentMinimapTests
 */

const bytes = Uint8Array.from({ length: 64 }, (_, index) => index);
const map = (surface: string) => mapOn(minimapStore.getSnapshot(), surface as never);

afterEach(() => {
  for (const part of workspaceStore.getSnapshot().dock.panels) {
    closePart(`part:${part}`);
    forgetPartMinimap(`part:${part}`);
  }
  minimapStore.update(() => ({ surfaces: {} }));
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

describe("a panel's own map", () => {
  /**
   * Someone who works with the minimap on wants it on the part too — and a
   * panel that opened with it off would be answering a question nobody asked.
   */
  it("opens with the map the workspace has", () => {
    openEmptyInPane("a");
    setMinimapVisible(WORKSPACE_SURFACE, true);
    setMinimapMode(WORKSPACE_SURFACE, "detail");

    const part = openPart(bytes, "body.bin");

    expect(map(part).visible).toBe(true);
    expect(map(part).mode).toBe("detail");
  });

  it("opens shut where the workspace's map is shut", () => {
    openEmptyInPane("a");

    const part = openPart(bytes, "body.bin");

    expect(map(part).visible).toBe(false);
  });

  /** From then on it is the panel's own: neither map answers for the other. */
  it("is its own once it is touched", () => {
    openEmptyInPane("a");
    setMinimapVisible(WORKSPACE_SURFACE, true);
    const part = openPart(bytes, "body.bin");

    setMinimapVisible(part, false);

    expect(map(part).visible).toBe(false);
    expect(map(WORKSPACE_SURFACE).visible).toBe(true);
  });

  it("moves its own edge, not the window's", () => {
    openEmptyInPane("a");
    setMinimapWidth(WORKSPACE_SURFACE, 140);
    const part = openPart(bytes, "body.bin");

    setMinimapWidth(part, 200);

    expect(map(part).width).toBe(200);
    expect(map(WORKSPACE_SURFACE).width).toBe(140);
  });

  /** The toggle is the front surface's, as the Tools menu is. */
  it("is what the toggle means while the panel is up", () => {
    openEmptyInPane("a");
    setMinimapVisible(WORKSPACE_SURFACE, true);
    const part = openPart(bytes, "body.bin");

    toggleMinimap();

    expect(map(part).visible).toBe(false);
    expect(map(WORKSPACE_SURFACE).visible).toBe(true);
    expect(frontMap(minimapStore.getSnapshot()).visible).toBe(false);

    foldParts();
    toggleMinimap();

    expect(map(WORKSPACE_SURFACE).visible).toBe(false);
    expect(map(part).visible).toBe(false);
  });

  it("goes when the part does", () => {
    openEmptyInPane("a");
    const part = openPart(bytes, "body.bin");
    setMinimapMode(part, "detail");

    forgetPartMinimap(part);

    expect(minimapStore.getSnapshot().surfaces[part]).toBeUndefined();
  });
});
