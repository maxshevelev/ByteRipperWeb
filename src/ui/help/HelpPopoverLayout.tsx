/**
 * The one shape every help popover has: a title over the words, flat on the
 * popover's own background, both from the same left edge, and as tall as the
 * words up to a limit past which they scroll.
 *
 * Shared because a term's popover and a setting's answer the same kind of
 * question in the same place; two shapes for it read as two kinds of thing.
 * The type is a panel's detail list's rather than the help book's — its body
 * size for the words, its heading size for the title — and it follows the
 * panels' size with them: a popover is read beside the rows it explains, and at
 * another size than theirs it reads as another thing.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout
 */

import type { CSSProperties, ReactNode, Ref } from "react";

/**
 * The size the box below was drawn for; at any other the box grows or shrinks
 * with the type, so a line holds the same words at every size.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.designSize
 */
export const HELP_POPOVER_DESIGN_SIZE = 13;

/**
 * The popover's width at the design size.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.width
 * @upstream-differs a length in `em` of the popover's own type rather than
 * points worked out from it, so the browser scales it with the type; and never
 * wider than the box the popover stands in
 */
export const HELP_POPOVER_WIDTH = 340;

/**
 * The margin the title and the words keep from the popover's edges. Not scaled,
 * as upstream's is not.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.margin
 */
export const HELP_POPOVER_MARGIN = 14;

/**
 * The tallest the words get before they scroll, at the design size: about
 * twenty lines.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.maxBodyHeight
 * @upstream-differs a length in `em`, as the width is
 */
export const HELP_POPOVER_MAX_BODY_HEIGHT = 320;

/**
 * A length drawn for the design size, as one that keeps its proportion to the
 * popover's type at any other.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.scaled
 * @upstream-differs upstream multiplies by the size it reads; here the length is
 * `em` and the browser does the multiplying, so it is right at every size the
 * panels are set in without anyone being told the size moved
 */
export function helpPopoverLength(points: number): string {
  return `${Number((points / HELP_POPOVER_DESIGN_SIZE).toFixed(4))}em`;
}

/**
 * The popover's view: `title` over the words — with `note`, where there is one,
 * between them — and `footer`, a control that takes the reader further, under
 * them at the right.
 *
 * The words' size is the panels' body size (`--hex-font-size`, which the
 * panels are set in) and the title's one pixel over it, as a detail's heading
 * is over its rows; both are the stylesheet's, so a change to the panels' size
 * lays an open popover out again with nothing listening for it.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.build
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.bodySize
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.titleSize
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.textSize
 * @upstream-differs the sizes are rules of app.css read from the custom property
 * the settings write, where upstream's are handed in at launch; the browser's
 * page zoom scales all of it, being the zoom (`Design/GAPS.md`); and the body's
 * height is the box's own up to its cap, which the browser works out, so no
 * height is measured and returned
 */
export function HelpPopoverLayout({
  title,
  note,
  footer,
  bodyRef,
  children,
}: {
  /**
   * What the popover is about: one line, cut at its end where it is longer.
   *
   * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.title
   */
  readonly title: string;
  /**
   * A line of the caller's own under the title: what a panel knows about the
   * row that the row's name has no room for — a setting's condition, the thing
   * that switches it off. Quiet, selectable, and wrapping onto further lines
   * rather than being cut.
   *
   * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.note
   */
  readonly note?: string | undefined;
  /** A control that takes the reader further, under the words at the right. */
  readonly footer?: ReactNode;
  /** The words' box, for a caller that puts its scroll back to the top. */
  readonly bodyRef?: Ref<HTMLDivElement>;
  /**
   * The words. A help article's blocks are brought to the popover's size by
   * the stylesheet — every size and spacing in `em` of the popover's type, and
   * the last block's margin dropped, which in a box sized to its words would be
   * an empty line under them.
   *
   * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.fitted
   * @upstream-differs rules of app.css rather than a copy of the rendered text
   * with its fonts multiplied
   */
  readonly children: ReactNode;
}) {
  const box = {
    "--help-popover-width": helpPopoverLength(HELP_POPOVER_WIDTH),
    "--help-popover-margin": `${HELP_POPOVER_MARGIN}px`,
    "--help-popover-body-max": helpPopoverLength(HELP_POPOVER_MAX_BODY_HEIGHT),
  } as CSSProperties;
  return (
    <div className="help-popover-layout" style={box}>
      <h4 className="help-popover-name">{title}</h4>
      {note === undefined || note.length === 0 ? null : <p className="help-popover-note">{note}</p>}
      {/* Words that fit do not scroll: the box is as tall as they are up to
          its cap, and only past the cap is there anything to scroll. */}
      <div className="help-popover-body" ref={bodyRef}>
        {children}
      </div>
      {footer === undefined ? null : <div className="help-popover-footer">{footer}</div>}
    </div>
  );
}

/**
 * Plain words — a line break where the text has one — at the popover's size:
 * the body of a popover whose words are the tool's rather than the book's.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpPopoverLayout.swift#HelpPopoverLayout.prose
 */
export function HelpPopoverProse({ text }: { readonly text: string }) {
  return <p className="help-popover-prose">{text}</p>;
}
