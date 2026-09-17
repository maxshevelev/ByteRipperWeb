import { Fragment, type MouseEvent, useCallback, useLayoutEffect, useRef, useState } from "react";
import { comparisonInfo } from "@/core/diff/comparisonSummary";
import {
  exactSizeText,
  hexSizeText,
  type PaneStatus,
  SEPARATOR,
  type SizeForm,
  statusParts,
} from "@/core/text/statusLine";
import { diffStore } from "@/state/diffStore";
import { transientMessageStore } from "@/state/transientMessageStore";
import { useStore } from "@/state/useStore";
import type { PaneId } from "@/state/workspaceStore";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { statusOffsetMenu, statusSizeMenu } from "@/ui/shell/paneMenus";

/**
 * The pane's status line, in its own component for one reason: it carries the
 * comparison's share, and that changes on every tick of a running scan. A
 * subscription to the diff store inside the pane would redraw the pane — the
 * canvas element, the scroller, the overlays — at that rate. Here only this
 * span does.
 *
 * The spelling is not here: it is `statusParts`', so the whole line is assembled
 * in one place, exactly as upstream assembles it.
 *
 * Two parts of the line answer a pointer, which is upstream's arrangement
 * (§3.4). The pointer on the file size unfolds the exact count in place — what
 * a glance wants is the abbreviation, and the exact form is what the pointer is
 * asking for — and a right-click copies the half it landed on, in that half's
 * own format. A right-click on the caret's offset copies the digits the line is
 * drawing. Everywhere else on the line a click is a click on the bar like any
 * other: it goes up to the pane, which focuses the dump.
 *
 * A transient message stands in the line's place while it holds (§22.2), which
 * is upstream's arrangement too: the label is set to the message and put back
 * when the message has had its two seconds — and with the line goes the size,
 * so the pointer where it was finds nothing to unfold (upstream's
 * `showTransient` drops the region with it). Nothing else of the readout
 * changes — the mode, the region and the operation strip are beside this span
 * rather than in it, so a report does not take away the fact that the pane is
 * in insert mode.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.updateStatus
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.showTransientMessage
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.statusLabel
 * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel
 * @upstream-differs a span drawn from a store, where upstream sets an
 * NSTextField's stringValue: the label's own font, colour and constraints are
 * the readout row's CSS
 * @upstream-differs a part's box is the span's own, so nothing is recovered from character
 * positions and no hit slack is needed around it: `resolveGeometry` measures a
 * monospaced line's characters because its parts share one field, and the browser
 * measures the elements it laid out
 * @upstream-differs both parts are the mouse's alone, as upstream's label parts are:
 * neither is a control, and a part that is aimed at rather than pressed has no
 * keyboard route of its own to offer — the bar's are the menus' (§3.4). The two
 * spans therefore carry a suppression each, where upstream's answer is a `hitTest`
 * that returns nil outside its regions
 */
export function PaneStatusLine({
  pane,
  ...status
}: Omit<PaneStatus, "comparison"> & { readonly pane: PaneId }) {
  const diff = useStore(diffStore);
  const message = useStore(transientMessageStore)[pane];
  const line = useRef<HTMLSpanElement | null>(null);
  /**
   * Whether the pointer has unfolded the size into its exact form (§3.4).
   *
   * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.isExpanded
   */
  const [unfolded, setUnfolded] = useState(false);

  const spelled = statusParts({
    ...status,
    // Only a finished index has a share to give: while it builds, the operation
    // strip is saying so with a bar, and the store is holding the previous
    // index — which is not the one being asked about.
    comparison: comparisonInfo(diff.status === "ready" ? diff.index : undefined),
  });

  // A transient message takes the size off screen with it (see the header).
  //
  // @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.showTransient
  const shown = message === undefined && unfolded;

  // Whether the exact form fits in the room the line has (§3.4): an expansion
  // that would itself be cut off says less than the abbreviation it replaced —
  // and it would chase its own tail, expanding into a truncation that collapses
  // it again. Upstream asks the bar for the width it offers and measures the
  // exact form against it; the line here is its own clipping box, so the
  // question is asked of the layout the browser has just produced, before it
  // paints — the cut-off form is never on screen.
  //
  // The room is what the row leaves: the line is the row's only growing item,
  // and the mode indicator and the operation strip have taken their width out
  // before it is asked. Upstream subtracts the same things by hand — the bar's
  // two insets, the gap and the indicator's own frame — which is the arithmetic
  // that moved with the indicator when it was pinned to the bar's right corner
  // (`b660189`); here nothing has to be, because the flex row has already done
  // it and the line is measured against the box it ended up with.
  //
  // @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.setExpanded
  // @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.canExpand
  // @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.statusRoom
  useLayoutEffect(() => {
    if (!shown) return;
    const box = line.current;
    if (box === null || box.scrollWidth <= box.clientWidth) return;
    setUnfolded(false);
  }, [shown]);

  /**
   * The size's right-click, from the half it landed on: the exact form is drawn
   * as its two halves, so the event's own target is the answer (§3.4). An
   * abbreviated size is one span, and the hex half is what a click on it means
   * — upstream measures a click against where the exact form's address would
   * end, which puts every point on the abbreviation inside the hex half.
   *
   * @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.sizeMenu
   */
  const onSizeMenu = useCallback(
    (event: MouseEvent<HTMLSpanElement>) => {
      const half = (event.target as HTMLElement).dataset.half;
      const form: SizeForm = half === "decimal" ? "decimal" : "hex";
      openContextMenu(event, statusSizeMenu(status.fileSize, form));
    },
    [status.fileSize]
  );

  const exact = exactSizeText(status.fileSize);
  const hex = hexSizeText(status.fileSize);

  return (
    <span className="readout-line" data-message={message === undefined ? undefined : ""} ref={line}>
      {message ??
        spelled.parts.map((part, index) => (
          // The parts are positional — the line is short, and it is rebuilt whole,
          // so where a part sits is what identifies it.
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts are positional
          <Fragment key={index}>
            {index > 0 ? SEPARATOR : null}
            {index === spelled.sizeIndex ? (
              // The readout the pointer unfolds, and the copy menu behind its
              // right-click: a readout, not a control, and mouse-only as
              // upstream's label part is.
              //
              // @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.sizeRegion
              // @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.pointerIsAt
              // biome-ignore lint/a11y/noStaticElementInteractions: a readout, not a control
              <span
                className="readout-size"
                onPointerEnter={() => setUnfolded(true)}
                onPointerLeave={() => setUnfolded(false)}
                onContextMenu={onSizeMenu}
              >
                {shown ? (
                  /*
                    The exact form, split where the right-click is decided: the
                    address up to where it ends, and the decimal count after it.

                    @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.exactSizeText
                    @upstream-differs the halves are elements rather than two ranges measured
                    off one string, so what the click landed on needs no arithmetic
                  */
                  <>
                    <span data-half="hex">{hex}</span>
                    <span data-half="decimal">{exact.slice(hex.length)}</span>
                  </>
                ) : (
                  part
                )}
              </span>
            ) : index === spelled.offset.index ? (
              // The address is the tail of its part — the line draws "Offset
              // 0002E6", digits last — so the digits are the span that answers.
              <span>
                {part.slice(0, part.length - spelled.offset.digits.length)}
                {/*
                  The address's own span: it, and not the word in front of it, is
                  the region a right-click on the offset copies from.

                  @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.offsetRegion
                  @upstream ByteRipperApp/Pane/StatusBarLabels.swift#StatusLabel.offsetMenu
                */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: as the size is —
                    drawn text with a copy menu on it. The dump's own menu reaches a Copy
                    Offset with the keyboard; this one is the bar's, as upstream's is. */}
                <span
                  className="readout-address"
                  onContextMenu={(event) =>
                    openContextMenu(event, statusOffsetMenu(spelled.offset.digits))
                  }
                >
                  {spelled.offset.digits}
                </span>
              </span>
            ) : (
              part
            )}
          </Fragment>
        ))}
    </span>
  );
}
