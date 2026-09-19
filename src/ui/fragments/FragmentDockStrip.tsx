import type { PanelId } from "@/state/fragmentDock";
import { CloseButton } from "@/ui/shell/CloseButton";

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
    <li className="fragment-pill" data-up={item.isUp ? "" : undefined}>
      <button
        type="button"
        className="fragment-pill-face"
        onClick={onSelect}
        title={item.title}
        aria-pressed={item.isUp}
      >
        {/* Upstream's `doc` symbol. The part is a document like any other, and
            the pill is where it waits. */}
        <svg className="fragment-pill-glyph" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 1.5h5.8l3.2 3.2v9.8h-9Z" />
          <path d="M9.3 1.5v3.2h3.2" />
        </svg>
        <span className="fragment-pill-name">{item.title}</span>
        {/* A dot, not a word: the pill has room for a name and no more. */}
        {item.hasChanges ? (
          <span className="fragment-pill-dot" role="img" aria-label="Unsaved changes">
            •
          </span>
        ) : null}
      </button>
      <CloseButton label={`Close ${item.title}`} onClick={onClose} />
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
  return (
    <ul className="fragment-dock" aria-label="Fragment panels">
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
