import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeDevicePixelRatio } from "@/ui/pane/observeDevicePixelRatio";

/**
 * A page zoom in Electron: the media query and the resize arrive while
 * `devicePixelRatio` still answers the old value, and the new one shows only
 * later. What is pinned here is that the callback then runs for the ratio that
 * is real, however late it shows.
 */
describe("watching the device pixel ratio", () => {
  let ratio = 1.5;
  let queryListener: (() => void) | undefined;
  let resizeListener: (() => void) | undefined;
  let frames: (() => void)[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    ratio = 1.5;
    queryListener = undefined;
    resizeListener = undefined;
    frames = [];
    vi.stubGlobal("window", {
      get devicePixelRatio() {
        return ratio;
      },
      addEventListener: (type: string, listener: () => void) => {
        if (type === "resize") resizeListener = listener;
      },
      removeEventListener: () => {
        resizeListener = undefined;
      },
      setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: (_type: string, listener: () => void) => {
        queryListener = listener;
      },
      removeEventListener: () => {},
    }));
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs the callback for a ratio that has already moved", () => {
    const seen: number[] = [];
    observeDevicePixelRatio(() => seen.push(ratio));
    ratio = 1.25;
    queryListener?.();
    expect(seen).toEqual([1.25]);
  });

  it("runs it later when the event came before the ratio moved", () => {
    const seen: number[] = [];
    observeDevicePixelRatio(() => seen.push(ratio));
    queryListener?.(); // the event, and the ratio still the old one
    expect(seen).toEqual([]);
    ratio = 1.25;
    for (const frame of frames) frame();
    expect(seen).toEqual([1.25]);
  });

  it("runs it once layout has settled, if the frame still saw the old ratio", () => {
    const seen: number[] = [];
    observeDevicePixelRatio(() => seen.push(ratio));
    resizeListener?.();
    for (const frame of frames) frame();
    expect(seen).toEqual([]);
    ratio = 1.1410887241363525;
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([1.1410887241363525]);
  });

  it("does not repeat itself for a ratio it has acted on", () => {
    const seen: number[] = [];
    observeDevicePixelRatio(() => seen.push(ratio));
    ratio = 1.25;
    resizeListener?.();
    for (const frame of frames) frame();
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([1.25]);
  });

  it("stops when told to", () => {
    const seen: number[] = [];
    const stop = observeDevicePixelRatio(() => seen.push(ratio));
    stop();
    ratio = 1.25;
    queryListener?.();
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([]);
  });
});
