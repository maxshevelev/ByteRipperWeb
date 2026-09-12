import { saveVerb } from "@/platform/files/capabilities";
import { WORD_SIZES, wordSizeTitle } from "@/render/hexGrid/hexLayout";
import { diffStore } from "@/state/diffStore";
import { editStore } from "@/state/editStore";
import { minimapStore, toggleMinimap } from "@/state/minimapStore";
import { useStore } from "@/state/useStore";
import {
  GROUPING_GAP_CHOICES,
  type PaneId,
  setGroupingGap,
  setLayout,
  setWordSize,
  swapPanes,
  workspaceStore,
} from "@/state/workspaceStore";
import { MenuButton } from "@/ui/shell/MenuButton";
import { compactEntries } from "@/ui/shell/menuModel";

/**
 * A web page has no menu bar (D12), so the commands live behind one button at
 * the head of the toolbar, in the sections the macOS app's menu bar uses.
 *
 * Two keep a permanent place beside it, and they are the two that are reached
 * constantly while reading a dump rather than occasionally while managing one:
 * Go To, which is how you get anywhere in a file too large to scroll, and the
 * minimap toggle, which is where you are in it. Upstream gives the minimap the
 * same treatment — a toolbar button *and* a menu item — for the same reason.
 */
export function Toolbar({
  onOpen,
  onNew,
  onNavigate,
  onSave,
  onSaveAs,
  onRevert,
  onFill,
  onDeleteBytes,
  onGoTo,
  onDuplicate,
  onFind,
  onClose,
}: {
  readonly onOpen: (into?: PaneId) => void;
  readonly onNew: () => void;
  readonly onNavigate: (what: "difference" | "same", direction: 1 | -1) => void;
  readonly onSave: () => void;
  readonly onSaveAs: () => void;
  readonly onRevert: () => void;
  readonly onFill: () => void;
  readonly onDeleteBytes: () => void;
  readonly onGoTo: () => void;
  readonly onDuplicate: () => void;
  readonly onFind: () => void;
  readonly onClose: () => void;
}) {
  const state = useStore(workspaceStore);
  const minimap = useStore(minimapStore);
  const diff = useStore(diffStore);
  // Subscribed for the nudge; the document itself is the truth.
  useStore(editStore);
  const active = state.panes[state.activePane];
  // The verb follows the pane, not only the browser: a file opened without a
  // handle is downloaded however capable the browser is.
  const verb = saveVerb(state.capabilities, active?.file.handle !== undefined);

  const bothOpen = state.panes.a !== undefined && state.panes.b !== undefined;
  const canNavigate = diff.status === "ready" && diff.hunks !== undefined;
  const anyOpen = state.panes.a !== undefined;
  const dirty = active?.document.isDirty === true;

  /**
   * The commands, in the macOS app's own sections and order.
   *
   * File, Edit, View — the menu bar's three document menus, flattened into one
   * popup because a web page has only one place to put them. What does not port
   * is left out rather than stubbed: New Window and New Tab belong to a window
   * manager this application does not have (D11), and Enter Full Screen is the
   * browser's own key.
   */
  const entries = compactEntries([
    { kind: "heading", label: "File" },
    { label: "New", onSelect: onNew },
    { label: "Open…", onSelect: () => onOpen() },
    anyOpen && state.panes.b === undefined
      ? { label: "Compare with…", onSelect: () => onOpen("b") }
      : undefined,
    { kind: "separator" },
    active === undefined
      ? undefined
      : {
          label: verb,
          disabled: !dirty && verb === "Save",
          onSelect: onSave,
        },
    active === undefined
      ? undefined
      : { label: verb === "Save" ? "Save As…" : "Download As…", onSelect: onSaveAs },
    active === undefined
      ? undefined
      : { label: "Revert to Saved", disabled: !dirty, onSelect: onRevert },
    { kind: "separator" },
    active === undefined ? undefined : { label: "Duplicate", onSelect: onDuplicate },
    active === undefined ? undefined : { label: "Close", onSelect: onClose },

    { kind: "separator" },
    { kind: "heading", label: "Edit" },
    active === undefined ? undefined : { label: "Fill Selection with…", onSelect: onFill },
    active === undefined ? undefined : { label: "Delete Bytes…", onSelect: onDeleteBytes },
    active === undefined ? undefined : { kind: "separator" },
    active === undefined ? undefined : { label: "Find…", shortcut: "⌘F", onSelect: onFind },
    active === undefined
      ? undefined
      : { label: "Go To Position…", shortcut: "⌘L", onSelect: onGoTo },

    { kind: "separator" },
    { kind: "heading", label: "View" },
    bothOpen
      ? {
          label: state.layout === "sideBySide" ? "Stack the Panes" : "Put the Panes Side by Side",
          onSelect: () => setLayout(state.layout === "sideBySide" ? "stacked" : "sideBySide"),
        }
      : undefined,
    bothOpen ? { label: "Swap Panes", onSelect: swapPanes } : undefined,
    anyOpen
      ? {
          label: minimap.visible ? "Hide Minimap" : "Show Minimap",
          shortcut: "⌘M",
          onSelect: toggleMinimap,
        }
      : undefined,
    bothOpen ? { kind: "separator" } : undefined,
    bothOpen
      ? {
          label: "Next Difference",
          disabled: !canNavigate,
          onSelect: () => onNavigate("difference", 1),
        }
      : undefined,
    bothOpen
      ? {
          label: "Previous Difference",
          disabled: !canNavigate,
          onSelect: () => onNavigate("difference", -1),
        }
      : undefined,
    bothOpen
      ? { label: "Next Same Block", disabled: !canNavigate, onSelect: () => onNavigate("same", 1) }
      : undefined,
    bothOpen
      ? {
          label: "Previous Same Block",
          disabled: !canNavigate,
          onSelect: () => onNavigate("same", -1),
        }
      : undefined,

    active === undefined ? undefined : { kind: "separator" },
    active === undefined ? undefined : { kind: "heading", label: "Word size" },
    ...(active === undefined
      ? []
      : WORD_SIZES.map((size) => ({
          label: wordSizeTitle(size),
          checked: state.wordSize === size,
          exclusive: true,
          onSelect: () => setWordSize(size),
        }))),

    bothOpen ? { kind: "separator" } : undefined,
    bothOpen ? { kind: "heading", label: "Grouping distance" } : undefined,
    ...(bothOpen
      ? GROUPING_GAP_CHOICES.map((gap) => ({
          label: `${gap} bytes`,
          checked: state.groupingGap === gap,
          exclusive: true,
          onSelect: () => setGroupingGap(gap),
        }))
      : []),
  ]);

  return (
    <header className="toolbar">
      <MenuButton label="☰" title="Commands" entries={entries} />
      <span className="toolbar-title">ByteRipper</span>

      {active === undefined ? null : (
        <button type="button" className="toolbar-button" onClick={onGoTo} title="Go to position">
          Go To…
        </button>
      )}

      <span className="toolbar-spacer" />

      <button
        type="button"
        className={`toolbar-button${minimap.visible ? " is-on" : ""}`}
        aria-pressed={minimap.visible}
        onClick={toggleMinimap}
        disabled={!anyOpen}
        title="Show the minimap (Cmd/Ctrl+M)"
      >
        Minimap
      </button>
    </header>
  );
}
