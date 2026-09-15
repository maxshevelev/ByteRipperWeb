import { type Notice, type NoticeGlyph, noticeStore } from "@/state/noticeStore";
import { useStore } from "@/state/useStore";

/**
 * The glyph on a plate with lines beside it.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.symbolPointSize
 */
const SYMBOL_SIZE = 28;

/**
 * The glyph on a plate that is nothing but the glyph — big enough to read as a
 * sign rather than as an icon beside missing text.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.glyphPointSize
 */
const GLYPH_SIZE = 44;

/** What a plate that is only its glyph says to a reader who cannot see it. */
const GLYPH_LABEL: Record<NoticeGlyph, string> = {
  wrapForward: "The search came round the end of the file",
  wrapBackward: "The search came round the start of the file",
  smartSearch: "Smart search",
};

/**
 * Where the notices are drawn: over the whole window, never in the way.
 *
 * The plate sits centred, a third of the way up from the bottom — out of the
 * way of the bytes being read at the top and of the find bar above them, and
 * still inside the window, so it reads as the app's own answer rather than as
 * a system alert. It is not interactive: a click over it goes to the dump
 * underneath.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter.verticalFraction
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter.minimumBottomInset
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticePresenter.horizontalInset
 * @upstream-differs placed by CSS; a window too short for the lower third is not guarded against
 */
export function TransientNotice() {
  const { current, leaving } = useStore(noticeStore);
  return (
    <div className="transient-notice-host">
      {leaving === undefined ? null : <Plate key={leaving.id} notice={leaving} leaving />}
      {current === undefined ? null : <Plate key={current.id} notice={current} leaving={false} />}
    </div>
  );
}

/**
 * One plate: a glyph and its lines, or a glyph alone.
 *
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.cornerRadius
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.init
 * @upstream ByteRipperApp/Window/TransientNoticeView.swift#TransientNoticeView.hitTest
 * @upstream-differs a frosted element with pointer-events: none, rather than an NSVisualEffectView whose hitTest returns nil
 */
function Plate({ notice, leaving }: { readonly notice: Notice; readonly leaving: boolean }) {
  const glyphOnly = notice.lines.length === 0;
  return (
    <div
      className="transient-notice"
      data-glyph-only={glyphOnly ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
      role="status"
      aria-label={glyphOnly ? GLYPH_LABEL[notice.glyph] : notice.lines.join(" ")}
    >
      <Glyph glyph={notice.glyph} size={glyphOnly ? GLYPH_SIZE : SYMBOL_SIZE} />
      {glyphOnly ? null : (
        <div className="transient-notice-lines">
          {notice.lines.map((line, index) => (
            <span
              key={line}
              className={index === 0 ? "transient-notice-heading" : "transient-notice-line"}
            >
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The plate's glyphs, drawn here: SF Symbols do not ship to a browser.
 *
 * A wrap is an arrow round a capsule whose head says which end the search came
 * round — top right for one that ran off the end, bottom left for one that ran
 * off the start. A Smart Search that found nothing is a wand.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.symbolName
 * @upstream-differs inline SVG in place of named system symbols, so there is no fallback to choose
 */
function Glyph({ glyph, size }: { readonly glyph: NoticeGlyph; readonly size: number }) {
  return (
    <svg
      className="transient-notice-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyph === "smartSearch" ? (
        <>
          <path d="M4 20 15 9" />
          <path d="m13.5 7.5 3 3" />
          <path d="M18 3v3M16.5 4.5h3" />
          <path d="M20 10v2M19 11h2" />
          <path d="M9 3v2M8 4h2" />
        </>
      ) : (
        <g transform={glyph === "wrapBackward" ? "rotate(180 12 12)" : undefined}>
          <path d="M16.5 5.5H8a5 5 0 0 0-5 5v3a5 5 0 0 0 5 5h8a5 5 0 0 0 5-5v-3a5 5 0 0 0-2-4" />
          <path d="m13.5 2.5 3 3-3 3" />
        </g>
      )}
    </svg>
  );
}
