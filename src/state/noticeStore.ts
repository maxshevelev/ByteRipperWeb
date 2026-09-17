import { createStore } from "@/state/store";

/**
 * Short-lived notices over the window: a frosted plate with a glyph and a few
 * lines, which fades in, holds, and fades out on its own.
 *
 * For an answer about a *whole* operation rather than about the place the user
 * is looking — a Smart Search that tried five encodings and found nothing, a
 * search that came round the end of the file. The status line is the wrong
 * place for that: it is one line beside the file's own numbers, and the report
 * is a list.
 *
 * One at a time, and all through here, so the two kinds cannot drift into two
 * conventions. A new plate replaces the last without a fade — a cross-fade
 * between two answers reads as a glitch — and a stale one fades, which is what
 * the eye follows. Either way the store forgets it at once: "is a notice
 * showing?" is answered by the intent, not by the fade.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter.host
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter.init
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.notices
 * @upstream-differs a store the shell draws from, rather than a presenter holding its host view
 */

/**
 * What the plate shows beside its lines, or alone.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.symbolView
 */
export type NoticeGlyph =
  | "wrapForward"
  | "wrapBackward"
  | "smartSearch"
  | "addedToFavorites"
  /** A panel's summary went to the clipboard as text: the Copy Summary button's sign. */
  | "copySummary"
  /** And as a picture: the Copy Screenshot button's. */
  | "copyScreenshot"
  /**
   * Something was asked for that cannot be done — a selection too long to be a
   * search pattern, so far (§11). Upstream's `exclamationmark.triangle`, which
   * it passes as the `symbol:` of a plate rather than naming in a type.
   */
  | "warning";

export interface Notice {
  /** New for every plate, so a replacement is a new element rather than a changed one. */
  readonly id: number;
  /**
   * The sign it wears — for a plate about a control, the one on that control.
   *
   * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.symbolName
   */
  readonly glyph: NoticeGlyph;
  /**
   * The first names the operation, the rest are its findings. None for a plate
   * that is only its glyph — a sign rather than a report.
   *
   * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.lines
   * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.textStack
   */
  readonly lines: readonly string[];
}

export interface NoticeState {
  /**
   * The plate on screen, if any.
   *
   * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter.current
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.transientNotice
   */
  readonly current: Notice | undefined;
  /** A plate that has been dismissed and is still fading out. */
  readonly leaving: Notice | undefined;
}

/**
 * How long a plate with something to read holds before it fades.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.holdDuration
 */
export const HOLD_DURATION_MS = 4000;

/**
 * How long a plate that is only a glyph holds: taken in at a glance, with
 * nothing to read — by the time a wrap is understood it has done its job.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.glyphHoldDuration
 */
export const GLYPH_HOLD_DURATION_MS = 900;

/** @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.fadeInDuration */
export const FADE_IN_MS = 150;

/** @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.fadeOutDuration */
export const FADE_OUT_MS = 300;

export const noticeStore = createStore<NoticeState>({ current: undefined, leaving: undefined });

let nextId = 1;
/** @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.dismissWorkItem */
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

function clearHold(): void {
  if (holdTimer !== undefined) clearTimeout(holdTimer);
  holdTimer = undefined;
}

function clearFade(): void {
  if (fadeTimer !== undefined) clearTimeout(fadeTimer);
  fadeTimer = undefined;
}

/**
 * A plate with something to read: a glyph and a few lines. It replaces any
 * plate already showing, holds, and goes on its own.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter.show
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.present
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showNotice
 */
export function showNotice(glyph: NoticeGlyph, lines: readonly string[]): void {
  dismissNotice(false);
  const notice: Notice = { id: nextId++, glyph, lines };
  noticeStore.update(() => ({ current: notice, leaving: undefined }));
  holdTimer = setTimeout(
    () => dismissNotice(true),
    lines.length === 0 ? GLYPH_HOLD_DURATION_MS : HOLD_DURATION_MS
  );
}

/**
 * Takes the notice off screen now: faded where the answer has simply gone
 * stale, at once where it is being replaced.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter.dismiss
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.dismiss
 */
export function dismissNotice(animated = true): void {
  clearHold();
  const { current } = noticeStore.getSnapshot();
  if (animated) {
    if (current === undefined) return;
    clearFade();
    noticeStore.update(() => ({ current: undefined, leaving: current }));
    fadeTimer = setTimeout(() => {
      fadeTimer = undefined;
      noticeStore.update((state) =>
        state.leaving === undefined ? state : { ...state, leaving: undefined }
      );
    }, FADE_OUT_MS);
    return;
  }
  clearFade();
  noticeStore.update((state) =>
    state.current === undefined && state.leaving === undefined
      ? state
      : { current: undefined, leaving: undefined }
  );
}

/**
 * Says that a search came round the end of the file: one large glyph turning
 * the way the search was going, and nothing to read.
 *
 * Wrapping is the one thing about a step the dump cannot show. The match and
 * the page move exactly as they do for the next match in line, so without
 * this the difference between "the next one" and "the first one, again" is
 * invisible.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showWrapNotice
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.wrapForwardGlyph
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.wrapBackwardGlyph
 */
export function showWrapNotice(direction: "forward" | "backward"): void {
  showNotice(direction === "forward" ? "wrapForward" : "wrapBackward", []);
}
