import { useRef } from "react";
import { saveVerb } from "@/platform/files/capabilities";
import { WORD_SIZES } from "@/render/hexGrid/hexLayout";
import { bookmarkAt, bookmarksStore } from "@/state/bookmarksStore";
import { diffStore } from "@/state/diffStore";
import { editStore, noteDocumentChanged } from "@/state/editStore";
import { minimapStore, toggleMinimap } from "@/state/minimapStore";
import { closeSearch, searchStore } from "@/state/searchStore";
import { segmentsStore } from "@/state/segmentsStore";
import { wordSizeFrom } from "@/state/settingsStore";
import { activate, menuState, panesSwapped, toolController } from "@/state/toolController";
import { nextRedo, nextUndo, redoLast, undoLast } from "@/state/undoRouter";
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
import { TOOLS } from "@/tools/registry";
import { mergePiece, pieceAt } from "@/ui/segments/segmentCommands";
import { wordSizeChoiceTitle } from "@/ui/settings/settingsText";
import { MenuButton } from "@/ui/shell/MenuButton";
import { compactEntries } from "@/ui/shell/menuModel";
import {
  BackwardGlyph,
  FindGlyph,
  ForwardGlyph,
  GoToGlyph,
  IdenticalGlyph,
  InsertModeGlyph,
  MinimapGlyph,
  PaneLayoutGlyph,
  SegmentsGlyph,
  ToolsGlyph,
} from "@/ui/shell/ToolbarIcons";
import {
  identicalBadgeAfter,
  paneLayoutOffer,
  type ToolbarContext,
  type ToolbarItemId,
  toolbarItemEnabled,
  toolbarItems,
} from "@/ui/shell/toolbarModel";

/**
 * A web page has no menu bar (D12), so the commands live behind one button at
 * the head of the toolbar, in the sections the macOS app's menu bar uses.
 *
 * Three keep a permanent place beside it. The tool picker comes first, right
 * after the title, because it names what the panel on the left is — upstream's
 * toolbar carries the same pull-down for the same reason: the panel can be
 * scrolled away while a tool is still bound to a pane. The other two are reached
 * constantly while reading a dump rather than occasionally while managing one:
 * Go To, which is how you get anywhere in a file too large to scroll, and the
 * minimap toggle, which is where you are in it. Upstream gives the minimap the
 * same treatment — a toolbar button *and* a menu item — for the same reason.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.buildToolbar
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.toolbar
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.toolbarDefaultItemIdentifiers
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.toolbarAllowedItemIdentifiers
 * @upstream-differs a React toolbar in the page, not an NSToolbar
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
  onBookmarks,
  onToggleBookmark,
  onJoin,
  onSegments,
  onSplitHere,
  onSaveAllSegments,
  onDuplicate,
  onFind,
  onClose,
  onSettings,
  navigation,
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
  readonly onBookmarks: () => void;
  readonly onToggleBookmark: () => void;
  readonly onJoin: (position: "start" | "end") => void;
  readonly onSegments: () => void;
  readonly onSplitHere: () => void;
  readonly onSaveAllSegments: () => void;
  readonly onDuplicate: () => void;
  readonly onFind: () => void;
  readonly onClose: () => void;
  readonly onSettings: () => void;
  /** Where difference navigation has somewhere to go from the active caret. */
  readonly navigation: ToolbarContext["navigation"];
}) {
  const state = useStore(workspaceStore);
  const minimap = useStore(minimapStore);
  const tools = useStore(toolController);
  const diff = useStore(diffStore);
  // Subscribed for the nudge; the document itself is the truth.
  useStore(editStore);
  // The Add/Remove wording follows the caret's row, so the item says what it
  // will do rather than what it might.
  useStore(bookmarksStore);
  // The same for the segment commands, which say what they would merge.
  const pieceCount =
    useStore(segmentsStore).panes[state.activePane]?.partition.segments.length ?? 0;
  const active = state.panes[state.activePane];
  // What ⌘Z would take back, asked rather than assumed: a cut is undoable too,
  // and it is the router that knows which of the two histories a press means.
  const undoable = nextUndo(state.activePane);
  const redoable = nextRedo(state.activePane);
  // The verb follows the pane, not only the browser: a file opened without a
  // handle is downloaded however capable the browser is.
  const verb = saveVerb(state.capabilities, active?.file.handle !== undefined);

  const bothOpen = state.panes.a !== undefined && state.panes.b !== undefined;
  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#DiffNavigationState
   * @upstream ByteRipperApp/Window/MainViewController.swift#DiffNavigationState.previousDifference
   * @upstream ByteRipperApp/Window/MainViewController.swift#DiffNavigationState.nextDifference
   * @upstream ByteRipperApp/Window/MainViewController.swift#DiffNavigationState.previousSameBlock
   * @upstream ByteRipperApp/Window/MainViewController.swift#DiffNavigationState.nextSameBlock
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.diffNavigationState
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.refreshDiffNavigation
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.syncDiffNavigationToolbarItem
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.applyDiffNavigationToolbarItem
   */
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
   *
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.build
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeFileMenu
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeEditMenu
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeViewMenu
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeToolsMenu
   * @upstream-differs one command menu in the toolbar with File, Edit, Bookmarks, Segments and View sections; the browser keeps the menu bar, and Tools and the word size are the toolbar's alone
   */
  const entries = compactEntries([
    // The application menu's Settings…, which has nowhere else to go. No ⌘, —
    // in a browser that is the browser's own settings.
    // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showSettings
    // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.settingsWindowController
    // @upstream-differs an item in the command menu, with no key equivalent
    { label: "Settings…", onSelect: onSettings },
    { kind: "separator" },
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
    active === undefined
      ? undefined
      : { label: "Insert File at Start…", onSelect: () => onJoin("start") },
    active === undefined ? undefined : { label: "Append File…", onSelect: () => onJoin("end") },
    { kind: "separator" },
    active === undefined ? undefined : { label: "Duplicate", onSelect: onDuplicate },
    active === undefined ? undefined : { label: "Close", onSelect: onClose },

    { kind: "separator" },
    { kind: "heading", label: "Edit" },
    // Named by what they take back, where the step carries a name: a tool's
    // transaction names itself, so this reads `Undo Fix FIT Checksum` rather
    // than leaving the user to remember what the last thing was. Absent rather
    // than greyed when there is nothing to take back.
    undoable === undefined
      ? undefined
      : {
          label: undoable.label === undefined ? "Undo" : `Undo ${undoable.label}`,
          shortcut: "⌘Z",
          onSelect: () => void undoLast(state.activePane, false),
        },
    redoable === undefined
      ? undefined
      : {
          label: redoable.label === undefined ? "Redo" : `Redo ${redoable.label}`,
          shortcut: "⇧⌘Z",
          onSelect: () => void redoLast(state.activePane),
        },
    undoable === undefined && redoable === undefined ? undefined : { kind: "separator" },
    active === undefined ? undefined : { label: "Fill Selection with…", onSelect: onFill },
    active === undefined ? undefined : { label: "Delete Bytes…", onSelect: onDeleteBytes },
    active === undefined ? undefined : { kind: "separator" },
    active === undefined ? undefined : { label: "Find…", shortcut: "⌘F", onSelect: onFind },
    active === undefined
      ? undefined
      : { label: "Go To Position…", shortcut: "⌘L", onSelect: onGoTo },

    active === undefined ? undefined : { kind: "separator" },
    active === undefined ? undefined : { kind: "heading", label: "Bookmarks" },
    active === undefined
      ? undefined
      : {
          label:
            bookmarkAt(active.document.caret) === undefined ? "Add Bookmark" : "Remove Bookmark",
          shortcut: "⌘D",
          onSelect: onToggleBookmark,
        },
    active === undefined
      ? undefined
      : { label: "Bookmarks…", shortcut: "⌥⌘B", onSelect: onBookmarks },

    active === undefined ? undefined : { kind: "separator" },
    active === undefined ? undefined : { kind: "heading", label: "Segments" },
    active === undefined ? undefined : { label: "Split Here…", onSelect: onSplitHere },
    active === undefined
      ? undefined
      : {
          label: "Merge",
          disabled: pieceCount < 2,
          onSelect: () => {
            const piece = pieceAt(state.activePane, active.document.caret);
            if (piece !== undefined) mergePiece(state.activePane, piece.index);
          },
        },
    active === undefined ? undefined : { label: "Segments…", onSelect: onSegments },
    active === undefined
      ? undefined
      : {
          label: "Save All as Separate Files…",
          disabled: pieceCount < 2,
          onSelect: onSaveAllSegments,
        },

    { kind: "separator" },
    { kind: "heading", label: "View" },
    bothOpen
      ? {
          label: state.layout === "sideBySide" ? "Stack the Panes" : "Put the Panes Side by Side",
          onSelect: () => setLayout(state.layout === "sideBySide" ? "stacked" : "sideBySide"),
        }
      : undefined,
    bothOpen
      ? {
          label: "Swap Panes",
          onSelect: () => {
            panesSwapped();
            swapPanes();
          },
        }
      : undefined,
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

  // The plaque's last determined answer, held through a rebuild.
  const identical = useRef(false);
  identical.current = identicalBadgeAfter(identical.current, diff);
  const search = useStore(searchStore);
  const context: ToolbarContext = {
    activeOpen: active !== undefined,
    comparison: bothOpen,
    navigation,
  };
  const activeTool = TOOLS.find((tool) => tool.id === tools.activeIdentifier);
  const layoutOffer = paneLayoutOffer(state.layout);
  const insertOn = active?.typing.isInsertMode === true;

  // The Tools pull-down: None, then every tool by name, as upstream's Tools menu
  // has them — a radio group where None closes the panel and stays available,
  // and a tool needs a file open in the active pane. The web edition has no
  // Tools menu besides it; the toolbar is where the list lives.
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activateTool
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.validateMenuItem
  const toolEntries = compactEntries([
    {
      label: "None",
      checked: menuState(undefined, active !== undefined).checked,
      exclusive: true,
      onSelect: () => activate(undefined),
    },
    ...TOOLS.map((tool) => {
      const row = menuState(tool.id, active !== undefined);
      return {
        label: tool.title,
        checked: row.checked,
        disabled: !row.enabled,
        exclusive: true,
        onSelect: () => activate(tool.id),
      };
    }),
  ]);

  const keyed: { readonly id: ToolbarItemId; readonly key: string }[] = [];
  const seen = new Map<ToolbarItemId, number>();
  for (const id of toolbarItems(bothOpen, identical.current)) {
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    keyed.push({ id, key: `${id}${count}` });
  }

  /**
   * One toolbar item, drawn for its identifier.
   *
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.toolbar
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.toolbarAllowedItemIdentifiers
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.diffNavigationGroup
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.minimapToggleItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.filesIdenticalItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.goToItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.findItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.segmentsItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.insertModeItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.wordSizeItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.paneLayoutItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.toolsItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeDiffNavigationGroup
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeFilesIdenticalItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeFilesIdenticalBadgeView
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeInsertModeItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeWordSizeItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeToolsItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.noToolTitle
   * @upstream-differs elements built on each render from the stores, rather than NSToolbarItems cached on the window controller
   */
  const item = (id: ToolbarItemId, key: string): React.ReactNode => {
    const disabled = !toolbarItemEnabled(id, context);
    switch (id) {
      case "space":
        return <span key={key} className="toolbar-space" />;
      case "flexibleSpace":
        return <span key={key} className="toolbar-spacer" />;
      case "tools":
        // The wrench, and the name of the tool-module in force — nothing at
        // rest, so the toolbar fits the window it opens in.
        return (
          <MenuButton
            key={key}
            className="toolbar-tools"
            ariaLabel="Tools"
            title="The tool-module this tab is working with"
            disabled={disabled}
            label={
              <>
                <ToolsGlyph />
                {activeTool === undefined ? null : <span>{activeTool.title}</span>}
              </>
            }
            entries={toolEntries}
          />
        );
      case "goTo":
        return (
          <IconButton
            key={key}
            label="Go To"
            title="Go to an offset or a bookmark"
            disabled={disabled}
            onClick={onGoTo}
          >
            <GoToGlyph />
          </IconButton>
        );
      case "find":
        // A switch, not the menu's command: pressing it again closes the bar.
        return (
          <IconButton
            key={key}
            label="Find"
            title="Find a byte pattern"
            pressed={search.open}
            disabled={disabled}
            onClick={() => (search.open ? closeSearch() : onFind())}
          >
            <FindGlyph />
          </IconButton>
        );
      case "segments":
        return (
          <IconButton
            key={key}
            label="Segments"
            title="The file's cuts and pieces"
            disabled={disabled}
            onClick={onSegments}
          >
            <SegmentsGlyph />
          </IconButton>
        );
      case "insertMode":
        // The active pane's typing mode, readable from the chrome and not only
        // as OVR / INS in the pane's status line.
        return (
          <IconButton
            key={key}
            label="Insert Mode"
            title="Insert mode: typing shifts the rest of the file"
            pressed={insertOn}
            disabled={disabled}
            onClick={() => void active?.typing.toggleInsertMode().then(noteDocumentChanged)}
          >
            <InsertModeGlyph />
          </IconButton>
        );
      case "wordSize":
        return (
          <select
            key={key}
            className="toolbar-select"
            value={state.wordSize}
            onChange={(event) => setWordSize(wordSizeFrom(Number(event.target.value)))}
            aria-label="Word Size"
            title="Bytes per word in the hex grid"
          >
            {WORD_SIZES.map((size) => (
              <option key={size} value={size}>
                {wordSizeChoiceTitle(size)}
              </option>
            ))}
          </select>
        );
      case "diffNavigation":
        return (
          <span key={key} className="toolbar-group">
            <IconButton
              label="Prev Diff"
              title="Previous difference"
              disabled={!toolbarItemEnabled("previousDifference", context)}
              onClick={() => onNavigate("difference", -1)}
            >
              <BackwardGlyph />
            </IconButton>
            <IconButton
              label="Next Diff"
              title="Next difference"
              disabled={!toolbarItemEnabled("nextDifference", context)}
              onClick={() => onNavigate("difference", 1)}
            >
              <ForwardGlyph />
            </IconButton>
          </span>
        );
      case "filesIdentical":
        return (
          <span
            key={key}
            className="toolbar-identical"
            role="status"
            aria-label="Files are identical"
          >
            <IdenticalGlyph />
            Files are identical
          </span>
        );
      case "paneLayout":
        return (
          <IconButton
            key={key}
            label={layoutOffer.label}
            title={layoutOffer.toolTip}
            disabled={disabled}
            onClick={() => setLayout(layoutOffer.next)}
          >
            <PaneLayoutGlyph stacked={layoutOffer.next === "stacked"} />
          </IconButton>
        );
      case "toggleMinimap":
        return (
          <IconButton
            key={key}
            label="Toggle Minimap"
            title="Show or hide the minimap (Cmd/Ctrl+M)"
            pressed={minimap.visible}
            onClick={toggleMinimap}
          >
            <MinimapGlyph />
          </IconButton>
        );
    }
  };

  return (
    <header className="toolbar">
      {/* The web edition's menu bar, before everything: a page has nowhere else
          to put File, Edit and View. */}
      <MenuButton label="☰" title="Commands" entries={entries} />
      {keyed.map((one) => item(one.id, one.key))}
    </header>
  );
}

/**
 * A plain icon button: a glyph, a tooltip, and — for the ones that carry a
 * state — pressed while the state is on.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeCommandItem
 * @upstream-differs a button element; a toggle says its state with aria-pressed
 */
function IconButton({
  label,
  title,
  pressed,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly title: string;
  readonly pressed?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`toolbar-icon${pressed === true ? " is-on" : ""}`}
      aria-label={label}
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
