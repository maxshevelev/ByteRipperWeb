import { type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { L } from "@/core/localization/localization";
import { foldParts } from "@/state/workspaceStore";
import { PaneHeaderHostContext } from "@/ui/pane/paneHeaderHost";
import { CloseButton } from "@/ui/shell/CloseButton";
import { ChevronShapes } from "@/ui/shell/chevronGlyph";

/**
 * The chrome every panel of the fragment dock wears, whatever it holds — a part of a dump, the
 * help book, the Agent window (`CLAUDE.md`: every additional window opens as a panel in the dock).
 *
 * One header across the top of the panel, in the strip the panel keeps for it, so the panel is
 * pulled down by it as by a part's (`FragmentPanel`, `PULL_HANDLES`), and at its trailing edge the
 * same two marks: **⌄** folds the panel into its pill, **✕** closes it.
 */

/**
 * The header's trailing marks: the fold and the close, pushed to the trailing edge.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.collapseButton
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.collapseTapped
 * @web-only one pair for every kind of panel; upstream's help and Agent are windows with a title bar
 */
export function DockPanelControls({
  closeLabel,
  onClose,
  onCollapse,
}: {
  /** What the ✕ closes, for the tooltip and a screen reader. */
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** Folds the panel into its pill. A pane of the workspace has none, and passes nothing. */
  readonly onCollapse?: (() => void) | undefined;
}) {
  return (
    <>
      {/* The chrome's two marks sit at the trailing edge; what the header says stays at the
          leading one. */}
      <span className="pane-header-gap" aria-hidden="true" />
      {onCollapse === undefined ? null : (
        /*
         * Upstream's own note on this button says why it is here rather than only on the
         * gesture: "a gesture is not discoverable and, in the web edition, not there at all".
         */
        <button
          type="button"
          className="pane-collapse"
          title={L("Collapse into the dock")}
          aria-label={L("Collapse panel")}
          onClick={onCollapse}
        >
          {/* Drawn, not typed: a "⌄" character sits wherever the platform's font puts it. */}
          <svg
            viewBox="0 0 8 5"
            width="9"
            height="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <ChevronShapes />
          </svg>
        </button>
      )}
      <CloseButton label={closeLabel} onClick={onClose} />
    </>
  );
}

/**
 * The header of a dock panel that is not a pane: its glyph — the one its pill wears — its name,
 * what it puts between them and the marks, and the marks. Laid in the panel's header strip, where
 * a part's pane puts its own bar, so the two are one row of one height in one place.
 *
 * @web-only upstream's help and Agent are windows; here they are panels of the dock, and wear a
 * part's header
 */
export function DockPanelHeader({
  glyph,
  title,
  titleHint,
  children,
  closeLabel,
  onClose,
}: {
  /** The pill's glyph, so the panel and the pill it rose from are recognisably one thing. */
  readonly glyph: ReactNode;
  readonly title: string;
  /** The title whole, under the pointer, where it is cut short. */
  readonly titleHint?: string | undefined;
  /** The panel's own controls, between the name and the marks. */
  readonly children?: ReactNode;
  readonly closeLabel: string;
  readonly onClose: () => void;
}) {
  const host = useContext(PaneHeaderHostContext);
  const header = (
    <header className="pane-header dock-panel-header">
      <span className="dock-panel-glyph">{glyph}</span>
      <h2 className="pane-name dock-panel-title" title={titleHint ?? title}>
        {title}
      </h2>
      {children}
      <DockPanelControls closeLabel={closeLabel} onClose={onClose} onCollapse={foldParts} />
    </header>
  );
  // Outside a panel — a test, or a page that renders it on its own — it stands where it is.
  if (host === undefined) return header;
  return host.element === null ? null : createPortal(header, host.element);
}

/**
 * A question mark in a circle: the sign the `?` buttons wear, so the pill the book waits in, and
 * the panel's header, are recognisably the same thing they open.
 */
export function HelpGlyph({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.1 6.1a1.9 1.9 0 1 1 2.5 1.8c-.5.2-.8.6-.8 1.1v.4" />
      <circle cx="7.8" cy="11.6" r="0.75" />
    </svg>
  );
}
