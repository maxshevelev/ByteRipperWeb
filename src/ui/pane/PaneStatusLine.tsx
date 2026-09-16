import { comparisonInfo } from "@/core/diff/comparisonInfo";
import { type PaneStatus, statusLine } from "@/core/text/statusLine";
import { diffStore } from "@/state/diffStore";
import { transientMessageStore } from "@/state/transientMessageStore";
import { useStore } from "@/state/useStore";
import type { PaneId } from "@/state/workspaceStore";

/**
 * The pane's status line, in its own component for one reason: it carries the
 * comparison's counts, and those change on every tick of a running scan. A
 * subscription to the diff store inside the pane would redraw the pane — the
 * canvas element, the scroller, the overlays — at that rate. Here only this
 * span does.
 *
 * The spelling is not here: it is `statusLine`'s, so the whole line is one
 * string assembled in one place, exactly as upstream assembles it.
 *
 * A transient message stands in the line's place while it holds (§22.2), which
 * is upstream's arrangement too: the label is set to the message and put back
 * when the message has had its two seconds. Nothing else of the readout changes
 * — the mode, the region and the operation strip are beside this span rather
 * than in it, so a report does not take away the fact that the pane is in
 * insert mode.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.updateStatus
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.showTransientMessage
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.statusLabel
 * @upstream-differs a span drawn from a store, where upstream sets an
 * NSTextField's stringValue: the label's own font, colour and constraints are
 * the readout row's CSS
 */
export function PaneStatusLine({
  pane,
  ...status
}: Omit<PaneStatus, "comparison"> & { readonly pane: PaneId }) {
  const diff = useStore(diffStore);
  const message = useStore(transientMessageStore)[pane];
  return (
    <span className="readout-line" data-message={message === undefined ? undefined : ""}>
      {message ??
        statusLine({
          ...status,
          // Only a finished index has counts to give: while it builds, the
          // operation strip is saying so with a bar (see comparisonInfo).
          comparison: comparisonInfo({
            ready: diff.status === "ready",
            differingBytes: diff.differingBytes,
            sameBytes: diff.sameBytes,
          }),
        })}
    </span>
  );
}
