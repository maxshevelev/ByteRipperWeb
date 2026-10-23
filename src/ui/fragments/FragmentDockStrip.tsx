import { L } from "@/core/localization/localization";
import { inDesktopShell } from "@/platform/desktop/desktopFiles";
import type { PanelId } from "@/state/fragmentDock";
import { PANE_DRAG_TYPE } from "@/ui/drag/dragDrop";
import { setPaneDragImage } from "@/ui/drag/paneDragImage";
import { HelpGlyph } from "@/ui/fragments/DockPanelHeader";
import { NotesGlyph } from "@/ui/notes/NotesGlyph";
import { PartBadge } from "@/ui/parts/PartBadge";
import { CloseButton } from "@/ui/shell/CloseButton";
import { openContextMenu } from "@/ui/shell/ContextMenu";
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
 * @upstream-differs no `canTearOff` on the item: a browser tab (D11) has nowhere to tear a panel off
 * to, and the desktop shell always has — the strip is handed `onTearOff` or not
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
  carry,
}: {
  readonly item: DockItem;
  /** @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.onSelect */
  readonly onSelect: () => void;
  /** @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.onClose */
  readonly onClose: () => void;
  /** How a part's pill is carried to another window, where there are windows (D6). */
  readonly carry?: PillCarry | undefined;
}) {
  const carried = item.kind === "part" || item.kind === undefined ? carry : undefined;
  return (
    <li className="fragment-pill" data-pill={item.id} data-up={item.isUp ? "" : undefined}>
      <button
        type="button"
        className="fragment-pill-face"
        onClick={onSelect}
        // The pill is how a panel is carried to another window, or onto a pane: its header is where
        // a pull folds it, so it is not picked up by that, as upstream's is (D6).
        draggable={carried === undefined ? undefined : true}
        onDragStart={
          carried === undefined
            ? undefined
            : (event) => {
                event.dataTransfer.setData(PANE_DRAG_TYPE, String(item.id));
                event.dataTransfer.effectAllowed = "copyMove";
                setPillDragImage(event.dataTransfer, item, event.currentTarget);
                carried.onDragStart(item.id);
              }
        }
        onDragEnd={carried?.onDragEnd}
        // @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.menu
        onContextMenu={
          carried === undefined
            ? undefined
            : (event) =>
                openContextMenu(event, [
                  {
                    label: inDesktopShell() ? L("Open in New Window") : L("Open in New Tab"),
                    onSelect: () => carried.onTearOff(item.id),
                  },
                  { kind: "separator" },
                  { label: L("Close “%1$@”", item.title), onSelect: onClose },
                ])
        }
        title={item.title}
        aria-pressed={item.isUp}
      >
        {item.kind === "help" ? (
          <HelpGlyph className="fragment-pill-glyph" />
        ) : item.kind === "notes" ? (
          // The panel's one picture, as its header and its empty view wear it.
          <NotesGlyph className="fragment-pill-glyph" size={11} />
        ) : item.kind === "agent" ? (
          // The toolbar button's own glyph, so the pill is recognisably what that button opened.
          <span className="fragment-pill-glyph fragment-pill-icon">
            <AgentGlyph connected={item.connected === true} />
          </span>
        ) : (
          /* Upstream's `doc` symbol. The part is a document like any other, and
             the pill is where it waits. */
          <svg className="fragment-pill-glyph" viewBox="0 0 16 16" aria-hidden="true">
            {/* The pane's own names for the two strokes, so the plate a pill is carried by fills
                the page as a pane's glyph does (`setPillDragImage`). */}
            <path className="pane-document-page" d="M3.5 1.5h5.8l3.2 3.2v9.8h-9Z" />
            <path className="pane-document-fold" d="M9.3 1.5v3.2h3.2" />
          </svg>
        )}
        <span className="fragment-pill-name">{item.title}</span>
        {/* The badge keeps its word whole; the name gives way to it. In the pill
            that is up it is drawn in the pill's ink.
            @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/PartBadgeView.swift#PartBadgeView.ink
            @upstream-differs the pill's stylesheet inks it, where upstream hands the badge a colour;
            the capsule is washed away from the ink rather than with it, which keeps the word legible
            in every theme */}
        {item.transform === undefined ? null : (
          <PartBadge
            text={item.transform}
            isTransform
            title={item.transformExplanation}
            className="fragment-pill-badge"
          />
        )}
        {item.unseen !== undefined && item.unseen > 0 ? (
          <span className="fragment-pill-unseen" title={L("Annotations not seen yet")}>
            {item.unseen}
          </span>
        ) : null}
        {/* A dot, not a word: the pill has room for a name and a codec's word and no more. A
            disc on the pill's centre line, not a "•", which sits where the font puts it — below
            the middle; and not there at all without changes, so it takes no width before the ✕.
            @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#ChangeDotView
            @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#ChangeDotView.diameter
            @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#ChangeDotView.color
            @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#ChangeDotView.draw
            @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#ChangeDotView.intrinsicContentSize
            @upstream-differs a styled span, its size and disc in the pill's stylesheet */}
        {item.hasChanges ? (
          <span className="fragment-pill-dot" role="img" aria-label={L("Unsaved changes")} />
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

/**
 * The picture a pill is carried by: the plate a pane's header is carried by, rather than the
 * browser's snapshot of the pill, which is cut to the strip it sits in. Its glyph is the pill's
 * own, filled as a pane's is when the part holds changes, and it is as tall as a pane's header,
 * so the panel in flight reads as the pane it becomes when it is let go (D6).
 *
 * @web-only upstream's pill is not dragged
 */
function setPillDragImage(transfer: DataTransfer, item: DockItem, pill: Element): void {
  const glyph = pill.querySelector(".fragment-pill-glyph")?.cloneNode(true) as Element | undefined;
  glyph?.setAttribute("class", "pane-document");
  if (item.hasChanges) glyph?.setAttribute("data-dirty", "");
  const header = document.querySelector(".pane-header");
  setPaneDragImage(
    transfer,
    item.title,
    glyph ?? null,
    header?.getBoundingClientRect().height ?? 0
  );
}

/** How a part's pill carries its panel to another window (`Design/DESKTOP_WINDOWS.md`, D6). */
export interface PillCarry {
  /**
   * The pill's Open in New Window — Open in New Tab in a browser whose tabs share the session host.
   *
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.onTearOff
   * @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentPillView.onTearOff
   * @upstream-differs a window where upstream opens a tab
   */
  readonly onTearOff: (id: PanelId) => void;
  readonly onDragStart: (id: PanelId) => void;
  readonly onDragEnd: () => void;
}

/** @upstream ByteRipperApp/Fragments/FragmentDockStrip.swift#FragmentDockStrip.setItems */
export function FragmentDockStrip({
  items,
  onSelect,
  onClose,
  carry,
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
  /** Where a panel can be carried to another window: the desktop shell (D6). */
  readonly carry?: PillCarry | undefined;
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
          carry={carry}
        />
      ))}
    </ul>
  );
}
