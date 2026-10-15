import { L } from "@/core/localization/localization";
import type { PanelId } from "@/state/fragmentDock";
import { HelpGlyph } from "@/ui/fragments/DockPanelHeader";
import { CloseButton } from "@/ui/shell/CloseButton";
import { AgentGlyph } from "@/ui/shell/ToolbarIcons";

/**
 * The dock along the bottom of the workspace: one pill per fragment panel the
 * tab has open (`Design/GAPS.md` G48).
 *
 * It takes its own row rather than lying over the panes, the way upstream's
 * New Tab strip does at the other end: a dock drawn over a pane's status bar
 * would hide the one line that says where the caret is.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip
 */

/**
 * What the dock shows, in the dock's own order.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.Item
 * @upstream-differs no `canTearOff`: one workspace per browser tab (D11) leaves
 * a torn-off panel nowhere to go, so the pill has no such item to dim
 */
export interface DockItem {
  /**
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.Item.id
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.id
   */
  readonly id: PanelId;
  /**
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.Item.title
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.title
   */
  readonly title: string;
  /**
   * Whether this is the panel on screen. Filled rather than outlined, so the
   * dock says at a glance which pill the panel in front belongs to.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.Item.isUp
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.isUp
   */
  readonly isUp: boolean;
  /**
   * Whether the part holds bytes the parent has not got back yet.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.Item.hasChanges
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.hasChanges
   */
  readonly hasChanges: boolean;
  /**
   * The codec's word for what the part's bytes went through — `LZMA`, `XOR 77`
   * — in a capsule after the name; nothing for a part that holds the file's own
   * bytes. What the name used to say with `decompressed` or `(decoded)`, said
   * once for every kind of part.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.Item.transform
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.transform
   */
  readonly transform?: string | undefined;
  /**
   * The badge's sentence, under the pointer.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.Item.transformExplanation
   */
  readonly transformExplanation?: string | undefined;
  /**
   * What the pill holds: a part of a dump, the help book or the Agent window.
   * Decides the glyph and what the ✕ is called — the dock holds identity and
   * order and nothing else, so a book is not a document, and "Close chip.bin"
   * is not what closing it does.
   *
   * @web-only upstream's book and Agent are windows and never reach a dock
   */
  readonly kind?: "part" | "help" | "agent" | "notes";
  /**
   * For the Agent's pill: whether an agent is connected, which its glyph says as the toolbar
   * button's does — the corners filled.
   *
   * @web-only upstream's Agent is a window and never reaches a dock
   */
  readonly connected?: boolean;
  /**
   * For the Annotations pill: how many of the agent's annotations were made while it was out of
   * view, counted in the agent's hue.
   *
   * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesCountBadge.count
   * @upstream-differs on the dock's pill, where upstream badges the toolbar's Annotations button
   */
  readonly unseen?: number | undefined;
}

/**
 * One pill in the dock: a folded fragment panel, or the one that is up.
 *
 * It wears the shape a pane wears when it is dragged — a fully rounded plate
 * with a document glyph and a name — because it is the same idea: a document
 * held in the hand rather than laid out on the bench.
 *
 * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView
 * @upstream-differs upstream's pill is one view that draws itself and puts a
 * close button inside; here the plate is the button, with the ✕ beside it — a
 * button inside a button is not markup a browser will take
 */
function FragmentPill({
  item,
  onSelect,
  onClose,
}: {
  readonly item: DockItem;
  /** @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.onSelect */
  readonly onSelect: () => void;
  /** @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.onClose */
  readonly onClose: () => void;
}) {
  return (
    <li className="fragment-pill" data-pill={item.id} data-up={item.isUp ? "" : undefined}>
      <button
        type="button"
        className="fragment-pill-face"
        onClick={onSelect}
        title={item.title}
        aria-pressed={item.isUp}
      >
        {item.kind === "help" ? (
          <HelpGlyph className="fragment-pill-glyph" />
        ) : item.kind === "notes" ? (
          // Upstream's `note.text`.
          <svg className="fragment-pill-glyph" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 1.5h10v13H3Z" />
            <path d="M5.5 5h5M5.5 8h5M5.5 11h3" />
          </svg>
        ) : item.kind === "agent" ? (
          // The toolbar button's own glyph, so the pill is recognisably what that button opened.
          <span className="fragment-pill-glyph fragment-pill-icon">
            <AgentGlyph connected={item.connected === true} />
          </span>
        ) : (
          /* Upstream's `doc` symbol. The part is a document like any other, and
             the pill is where it waits. */
          <svg className="fragment-pill-glyph" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 1.5h5.8l3.2 3.2v9.8h-9Z" />
            <path d="M9.3 1.5v3.2h3.2" />
          </svg>
        )}
        <span className="fragment-pill-name">{item.title}</span>
        {/* The badge keeps its word whole; the name gives way to it. In the pill
            that is up it is drawn in the pill's ink.
            @upstream ByteRipperApp/Pane/PartBadgeView.swift#PartBadgeView.ink
            @upstream-differs the pill's stylesheet inks it, where upstream hands the badge a colour;
            the capsule is washed away from the ink rather than with it, which keeps the word legible
            in every theme */}
        {item.transform === undefined ? null : (
          <span className="fragment-pill-badge" title={item.transformExplanation}>
            {item.transform}
          </span>
        )}
        {item.unseen !== undefined && item.unseen > 0 ? (
          <span className="fragment-pill-unseen" title={L("Annotations not seen yet")}>
            {item.unseen}
          </span>
        ) : null}
        {/* A dot, not a word: the pill has room for a name and a codec's word and no more. */}
        {item.hasChanges ? (
          <span className="fragment-pill-dot" role="img" aria-label={L("Unsaved changes")}>
            •
          </span>
        ) : null}
      </button>
      {/* The Annotations panel has no ✕: it is there while there is an annotation. */}
      {item.kind === "notes" ? null : (
        <CloseButton
          label={
            item.kind === "help"
              ? L("Close the help")
              : item.kind === "agent"
                ? L("Close the Agent")
                : L("Close %1$@", item.title)
          }
          onClick={onClose}
        />
      )}
    </li>
  );
}

/** @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.setItems */
export function FragmentDockStrip({
  items,
  onSelect,
  onClose,
}: {
  readonly items: readonly DockItem[];
  /**
   * The pill's own click: the panel that is up folds, any other rises.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.onSelect
   */
  readonly onSelect: (id: PanelId) => void;
  /** @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.onClose */
  readonly onClose: (id: PanelId) => void;
}) {
  // help: shell.fragment-dock
  return (
    <ul className="fragment-dock" aria-label={L("Panels")}>
      {items.map((item) => (
        <FragmentPill
          key={item.id}
          item={item}
          onSelect={() => onSelect(item.id)}
          onClose={() => onClose(item.id)}
        />
      ))}
    </ul>
  );
}
