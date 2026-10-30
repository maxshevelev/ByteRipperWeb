import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import stylesheet from "@/app/app.css?raw";
import { holdHelpPopover } from "@/ui/help/HelpPopover";
import {
  HELP_POPOVER_MAX_BODY_HEIGHT,
  HELP_POPOVER_WIDTH,
  HelpPopoverLayout,
  HelpPopoverProse,
  helpPopoverLength,
} from "@/ui/help/HelpPopoverLayout";

/** The declarations of the stylesheet's rule for exactly `selector`. */
function rule(selector: string): string {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((one: string) => one.trim());
    if (selectors.includes(selector)) return match[2] ?? "";
  }
  throw new Error(`no rule for ${selector}`);
}

describe("HelpPopoverLayout", () => {
  // A note sits under the title, in the quiet colour and the popover's own
  // size, and the words stay under it.
  // @upstream Packages/HelpUI/Tests/HelpUITests/HelpUITests.swift#HelpTermPopoverTests.testANoteSitsUnderTheTitle
  it("puts a note between the title and the words", () => {
    const html = renderToStaticMarkup(
      <HelpPopoverLayout title="MELanPowerWell" note="eSpiEnabled = No, assumed">
        <HelpPopoverProse text="The tool's words." />
      </HelpPopoverLayout>
    );
    const title = html.indexOf("MELanPowerWell");
    const note = html.indexOf('class="help-popover-note">eSpiEnabled = No, assumed');
    const words = html.indexOf("The tool&#x27;s words.");
    expect(title).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(title);
    expect(words).toBeGreaterThan(note);

    const quiet = rule(".help-popover-note");
    expect(quiet).toMatch(/color:\s*var\(--text-muted\)/);
    expect(quiet, "the note is the words' size").not.toMatch(/font-size/);
    expect(rule(".help-popover-layout"), "the panel's line is copied like the rest").toMatch(
      /(?<!-)user-select:\s*text/
    );
  });

  it("draws no note where there is none", () => {
    const html = renderToStaticMarkup(
      <HelpPopoverLayout title="MFS">
        <HelpPopoverProse text="Words." />
      </HelpPopoverLayout>
    );
    expect(html).not.toContain("help-popover-note");
  });

  // A note longer than a line wraps, rather than being cut to the one line a
  // label is measured at before it is told its width.
  // @upstream Packages/HelpUI/Tests/HelpUITests/HelpUITests.swift#HelpTermPopoverTests.testALongNoteIsNotCutToOneLine
  it("lets a long note wrap", () => {
    const note = rule(".help-popover-note");
    expect(note).not.toMatch(/white-space:\s*nowrap/);
    expect(note).not.toMatch(/text-overflow/);
    expect(note).toMatch(/overflow-wrap:\s*anywhere/);
  });

  // Words that fit do not scroll; words that do not are held to the cap, about
  // twenty lines, and scroll inside it.
  // @upstream Packages/HelpUI/Tests/HelpUITests/HelpUITests.swift#HelpBodyViewTests.testAPopoverScrollsOnlyWhatDoesNotFit
  it("scrolls only words that do not fit", () => {
    const html = renderToStaticMarkup(
      <HelpPopoverLayout title="Long">
        <HelpPopoverProse text={"A line of the tool's words.\n".repeat(80)} />
      </HelpPopoverLayout>
    );
    expect(html).toContain(
      `--help-popover-body-max:${helpPopoverLength(HELP_POPOVER_MAX_BODY_HEIGHT)}`
    );
    const body = rule(".help-popover-body");
    expect(body).toMatch(/max-height:\s*var\(--help-popover-body-max\)/);
    // `auto`, not `scroll`: a scroller only where there is something to scroll.
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body, "no bounce that would say there was more").toMatch(
      /overscroll-behavior:\s*contain/
    );
    expect(body, "a short body is as tall as its words").not.toMatch(/(?<!max-|min-)height:/);
  });

  // The popover's type is the panels': their body size for the words, a point
  // over it for the title, and it moves with them — the box growing with the
  // type, since its width is a length of that type.
  // @upstream Packages/HelpUI/Tests/HelpUITests/HelpUITests.swift#HelpTermPopoverTests.testItFollowsTheZoom
  it("is set in the panels' type and grows with it", () => {
    expect(rule(".help-popover-layout")).toMatch(/font-size:\s*var\(--hex-font-size/);
    expect(rule(".help-popover-name")).toMatch(/font-size:\s*calc\(1em \+ 1px\)/);
    expect(helpPopoverLength(HELP_POPOVER_WIDTH)).toBe("26.1538em");
    expect(helpPopoverLength(13)).toBe("1em");
    expect(rule(".help-popover-layout")).toMatch(/width:\s*var\(--help-popover-width\)/);
  });
});

describe("holdHelpPopover", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Closed, a popover lets go of what it held: left listening, every popover
  // ever opened would still be answering presses after it had gone.
  // @upstream Packages/HelpUI/Tests/HelpUITests/HelpUITests.swift#HelpTermPopoverTests.testAClosedPopoverGoes
  it("stops listening once the popover has closed", () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const onClose = vi.fn();
    const release = holdHelpPopover(events, () => false, onClose);

    // The press that opened it is still on its way up: it does not close it.
    events.dispatchEvent(new Event("pointerdown"));
    expect(onClose).not.toHaveBeenCalled();

    vi.runAllTimers();
    events.dispatchEvent(new Event("pointerdown"));
    expect(onClose).toHaveBeenCalledTimes(1);

    release();
    events.dispatchEvent(new Event("pointerdown"));
    expect(onClose, "the closed popover answers nothing").toHaveBeenCalledTimes(1);
  });

  it("stays open for a press inside it", () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const onClose = vi.fn();
    const release = holdHelpPopover(events, () => true, onClose);
    vi.runAllTimers();
    events.dispatchEvent(new Event("pointerdown"));
    expect(onClose).not.toHaveBeenCalled();
    release();
  });

  it("lets go even before it has started listening", () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const onClose = vi.fn();
    holdHelpPopover(events, () => false, onClose)();
    vi.runAllTimers();
    events.dispatchEvent(new Event("pointerdown"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
