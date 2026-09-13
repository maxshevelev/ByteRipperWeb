import { describe, expect, it } from "vitest";
import { PaneScroller } from "@/ui/pane/paneScroller";

const LIMIT = 30_000_000;
const VIEWPORT = 340;

function make(contentHeight: number) {
  const host = {
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: VIEWPORT,
    clientWidth: 600,
    scrollWidth: 900,
  };
  const spacer = { style: { height: "", marginTop: "" } };
  const scroller = new PaneScroller(host, spacer, LIMIT);
  scroller.setContentHeight(contentHeight);
  return { host, spacer, scroller };
}

const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false) => ({
  deltaX: 0,
  deltaY,
  deltaMode,
  ctrlKey,
});

describe("a pane whose file fits", () => {
  // A 16 MB dump at 17 px a row.
  const CONTENT = 17_825_809;

  it("scrolls the element one-to-one", () => {
    const { host, spacer, scroller } = make(CONTENT);
    expect(spacer.style.height).toBe(`${CONTENT}px`);
    scroller.moveTo(12_345);
    expect(host.scrollTop).toBe(12_345);
    expect(scroller.top).toBe(12_345);
    expect(scroller.scaled).toBe(false);
  });

  it("leaves the wheel to the browser", () => {
    const { scroller } = make(CONTENT);
    expect(scroller.wheel(wheel(51), 17)).toBe(false);
  });

  it("takes the user's scroll as the position", () => {
    const { host, scroller } = make(CONTENT);
    host.scrollTop = 777;
    expect(scroller.noteScroll()).toBe(true);
    expect(scroller.top).toBe(777);
  });

  it("does not mistake its own move for the user's", () => {
    const { scroller } = make(CONTENT);
    scroller.moveTo(100, 20);
    expect(scroller.noteScroll()).toBe(false);
  });

  it("pulls the spacer up by exactly the viewport's height", () => {
    const { spacer, scroller } = make(CONTENT);
    scroller.fit();
    expect(spacer.style.marginTop).toBe(`-${VIEWPORT}px`);
  });

  it("stops at the last screen", () => {
    const { scroller } = make(CONTENT);
    scroller.moveTo(Number.MAX_SAFE_INTEGER);
    expect(scroller.top).toBe(CONTENT - VIEWPORT);
  });

  it("follows the content when it shrinks under the position", () => {
    const { scroller } = make(CONTENT);
    scroller.moveTo(CONTENT - VIEWPORT);
    expect(scroller.setContentHeight(10_000)).toBe(true);
    expect(scroller.top).toBe(10_000 - VIEWPORT);
  });
});

describe("a pane taller than the browser lays out", () => {
  // A 32 MB image at 17 px a row: past Chromium's limit.
  const CONTENT = 35_651_618;

  it("caps the spacer at the limit", () => {
    const { spacer, scroller } = make(CONTENT);
    expect(spacer.style.height).toBe(`${LIMIT}px`);
    expect(scroller.scaled).toBe(true);
  });

  it("can reach the end, and puts the thumb at the end of its track", () => {
    const { host, scroller } = make(CONTENT);
    scroller.moveTo(scroller.maxTop);
    expect(scroller.top).toBe(CONTENT - VIEWPORT);
    expect(host.scrollTop).toBeCloseTo(LIMIT - VIEWPORT, 6);
  });

  it("keeps the position exact rather than rounded to the thumb", () => {
    const { scroller } = make(CONTENT);
    scroller.moveTo(20_000_017);
    expect(scroller.top).toBe(20_000_017);
  });

  it("reads a drag of the thumb in content pixels", () => {
    const { host, scroller } = make(CONTENT);
    host.scrollTop = (LIMIT - VIEWPORT) / 2;
    expect(scroller.noteScroll()).toBe(true);
    expect(scroller.top).toBeCloseTo((CONTENT - VIEWPORT) / 2, 4);
  });

  it("moves by exactly the wheel's distance", () => {
    const { scroller } = make(CONTENT);
    scroller.moveTo(1000);
    expect(scroller.wheel(wheel(51), 17)).toBe(true);
    expect(scroller.top).toBe(1051);
    // The scroll event that follows is the echo, not a second move.
    expect(scroller.noteScroll()).toBe(false);
  });

  it("reads a wheel that counts lines as rows", () => {
    const { scroller } = make(CONTENT);
    scroller.moveTo(1000);
    scroller.wheel(wheel(3, 1), 17);
    expect(scroller.top).toBe(1051);
  });

  it("leaves a pinch to the browser, which zooms with it", () => {
    const { scroller } = make(CONTENT);
    expect(scroller.wheel(wheel(51, 0, true), 17)).toBe(false);
  });
});
