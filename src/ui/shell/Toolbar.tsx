import { useEffect, useRef } from "react";
import { agentStatusText } from "@/core/agent/agentStatus";
import { L } from "@/core/localization/localization";
import { saveVerb } from "@/platform/files/capabilities";
import { WORD_SIZES, wordSizeTitle } from "@/render/hexGrid/hexLayout";
import { showAbout } from "@/state/aboutStore";
import { agentService } from "@/state/agent/agentService";
import { bookmarkAt, bookmarksStore, marksFor } from "@/state/bookmarksStore";
import { diffStore } from "@/state/diffStore";
import { editStore } from "@/state/editStore";
import { frontMap, minimapStore, toggleMinimap } from "@/state/minimapStore";
import {
  canNavigateBack,
  canNavigateForward,
  navigateBack,
  navigateForward,
  navigationStore,
} from "@/state/navigationStore";
import type { OpenPanePlacement } from "@/state/openPlacement";
import { recentFilesStore } from "@/state/recentFilesStore";
import { closeSearch, searchStore } from "@/state/searchStore";
import { segmentsStore } from "@/state/segmentsStore";
import { wordSizeFrom } from "@/state/settingsStore";
import {
  activate,
  frontSession,
  menuState,
  panesSwapped,
  toolController,
  toolKeyEquivalent,
} from "@/state/toolController";
import { nextRedo, nextUndo, redoLast, undoLast } from "@/state/undoRouter";
import { checkForUpdate } from "@/state/updateStore";
import { useStore } from "@/state/useStore";
import {
  frontPane,
  paneIn,
  type SlotId,
  setLayout,
  setWordSize,
  swapPanes,
  windowPanesAreReachable,
  workspaceStore,
} from "@/state/workspaceStore";
import { TOOLS } from "@/tools/registry";
import { detectKeyboardPlatform } from "@/ui/pane/hexKeys";
import { mergePiece, pieceAt } from "@/ui/segments/segmentCommands";
import { ChevronShapes } from "@/ui/shell/chevronGlyph";
import { canCopyToOtherPane, copySelectionToOtherPane } from "@/ui/shell/copyToOtherPane";
import { desktopBridge, publishNativeMenu } from "@/ui/shell/desktopMenu";
import { helpMenuEntries } from "@/ui/shell/helpMenu";
import { MenuButton } from "@/ui/shell/MenuButton";
import { compactEntries, type MenuEntry, sectionsOf } from "@/ui/shell/menuModel";
import { revertItem } from "@/ui/shell/paneMenus";
import { SectionMenu } from "@/ui/shell/SectionMenu";
import {
  AgentGlyph,
  BackwardGlyph,
  ChevronLeftGlyph,
  ChevronRightGlyph,
  FindGlyph,
  ForwardGlyph,
  GoToGlyph,
  HelpGlyph,
  IdenticalGlyph,
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
import { useKeyboardInput } from "@/ui/shell/useKeyboardInput";

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
  onOpenRecent,
  onClearRecent,
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
  onToggleFind,
  onClose,
  onSettings,
  navigation,
}: {
  readonly onOpen: (into?: SlotId, placement?: OpenPanePlacement) => void;
  /** File ▸ Open Recent ▸ «file»: re-opens that recent file. The shell only. */
  readonly onOpenRecent: (index: number) => void;
  /** File ▸ Open Recent ▸ Clear Menu: forgets the list. The shell only. */
  readonly onClearRecent: () => void;
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
  /**
   * The Find button's own command, which is not {@link onFind}: the button is a
   * switch that opens the bar and takes nothing from the dump, where the menu
   * item and ⌘F take the selection for a pattern (§11).
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleFindBar
   */
  readonly onToggleFind: () => void;
  readonly onClose: () => void;
  readonly onSettings: () => void;
  /** Where difference navigation has somewhere to go from the active caret. */
  readonly navigation: ToolbarContext["navigation"];
}) {
  const state = useStore(workspaceStore);
  // The toggle and its label mean the map of whatever is in front.
  const minimap = frontMap(useStore(minimapStore));
  const tools = useStore(toolController);
  const diff = useStore(diffStore);
  // File ▸ Open Recent, the shell only: the menu re-sends when the list moves.
  const recent = useStore(recentFilesStore);
  // Subscribed for the nudge; the document itself is the truth.
  useStore(editStore);
  // The history changes on every jump, and what draws Back and Forward follows it.
  useStore(navigationStore);
  const history = { back: canNavigateBack(), forward: canNavigateForward() };
  // The Add/Remove wording follows the caret's row, so the item says what it
  // will do rather than what it might.
  useStore(bookmarksStore);
  // The same for the segment commands, which say what they would merge.
  // Every document command in this menu means the pane in front — the part in
  // the panel that is up, or the active pane with the stage clear — and every
  // command about the workspace's own panes is left out while a panel covers
  // them (`frontPane`, `windowPanesAreReachable`).
  const front = frontPane(state);
  const panesReachable = windowPanesAreReachable(state);
  const pieceCount = useStore(segmentsStore).panes[front]?.partition.segments.length ?? 0;
  const active = paneIn(state, front);
  // What ⌘Z would take back, asked rather than assumed: a cut is undoable too,
  // and it is the router that knows which of the two histories a press means.
  const undoable = nextUndo(front);
  const redoable = nextRedo(front);
  // The verb follows the pane, not only the browser: a file opened without a
  // handle is downloaded however capable the browser is.
  const verb = saveVerb(state.capabilities, active?.file.handle !== undefined);

  const bothOpen = state.panes.a !== undefined && state.panes.b !== undefined;
  // The Agent button and its mark: there while the service is switched on, filled while an agent is
  // connected (`Design/PORT_AGENT.md`).
  const agent = useStore(agentService.store);
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
  // The comparison is the workspace's, and a panel is in the way of it: the
  // items stay where they are and stop working, rather than leaving the bar and
  // coming back.
  const canNavigate = diff.status === "ready" && diff.hunks !== undefined && panesReachable;
  const dirty = active?.document.isDirty === true;
  const revert = revertItem(active);

  /**
   * The commands, in the macOS app's own sections and order.
   *
   * The list is the menu bar's, and a web page keeps it in two levels where the
   * bar has two places: the section names — File, Edit, Bookmarks, Segments,
   * View, Help — stand at the first, and the commands of the section that is
   * open stand at the second, beside their name (SectionMenu, `sectionsOf`).
   * What does not port is left out rather than stubbed: New Window and New Tab
   * belong to a window manager this application does not have (D11), and Enter
   * Full Screen is the browser's own key.
   *
   * The list has a fixed shape, as a menu bar does: a command that does not
   * apply is greyed, not removed. Upstream builds its menus once and answers
   * `validateMenuItem` for every item, so Save is always the fourth thing under
   * File whether or not a file is open — and where the commands hide instead,
   * the menu of an empty workspace is three rows long and reads as if the
   * application had lost them. Muscle memory needs the row to stay put; what a
   * greyed row costs is a glance, what a missing one costs is a search.
   *
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.build
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeFileMenu
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeEditMenu
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeViewMenu
   * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeToolsMenu
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.validateMenuItem
   * @upstream-differs one command menu in the toolbar, in two levels: the section names at the first, the open section's commands at the second; the browser keeps the menu bar, and Tools and the word size are the toolbar's alone
   */
  // In the optional Windows shell the command menu is the window's menu bar.
  const nativeMenuBar = desktopBridge() !== undefined;
  const entries = compactEntries([
    { kind: "heading", label: L("File", { context: "menu" }), opensMenu: true },
    // Upstream's five File keys. ⌘N and ⌘W only where the window is the
    // app's: a browser keeps both for its own windows and tabs, and a menu
    // promising a key the page never receives would be lying.
    // help: menu.file.new
    { label: L("New File"), shortcut: nativeMenuBar ? "⌘N" : undefined, onSelect: onNew },
    // help: menu.file.open
    { label: L("Open…"), shortcut: "⌘O", onSelect: () => onOpen() },
    // Compare with… opens into the pane the active one is compared with — the
    // free one, otherwise the one that is not active — so it needs a file to
    // compare with. With none open the command to reach for is Open….
    // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentCompareWithPanel
    // @upstream-differs no key equivalent, ⌥⌘O being a combination a browser may keep for
    // itself; and the Open Recent row has no ⌥ twin, a menu here having no alternate items
    {
      // help: menu.file.compare-with
      label: L("Compare with…"),
      disabled: !panesReachable || state.panes[state.activePane] === undefined,
      onSelect: () => onOpen(undefined, "otherPane"),
    },
    { kind: "separator" },
    {
      // help: menu.file.save
      label: verb === "Save" ? L("Save") : L("Download"),
      shortcut: "⌘S",
      disabled: active === undefined || (!dirty && verb === "Save"),
      onSelect: onSave,
    },
    {
      // help: menu.file.save-as
      label: verb === "Save" ? L("Save As…") : L("Download As…"),
      shortcut: "⇧⌘S",
      disabled: active === undefined,
      onSelect: onSaveAs,
    },
    // Revert follows the pane in front like the saves above it, titled for what
    // that pane goes back to. The three below it act on the workspace's own
    // panes instead: a part has no pane beside it.
    // help: menu.file.revert
    { label: revert.title, disabled: !revert.enabled, onSelect: onRevert },
    { kind: "separator" },
    {
      // help: menu.file.insert-at-start
      label: L("Insert File at Start…"),
      disabled: active === undefined || !panesReachable,
      onSelect: () => onJoin("start"),
    },
    {
      // help: menu.file.append
      label: L("Append File…"),
      disabled: active === undefined || !panesReachable,
      onSelect: () => onJoin("end"),
    },
    { kind: "separator" },
    {
      // help: menu.file.duplicate
      label: L("Duplicate"),
      disabled: active === undefined || !panesReachable,
      onSelect: onDuplicate,
    },
    // help: menu.file.close
    {
      label: L("Close"),
      // Ctrl+F4 closes a document on Windows; a Mac's is ⌘W. The page takes
      // Ctrl+W as well, for the hand that learnt it in a browser.
      shortcut: nativeMenuBar ? (detectKeyboardPlatform() === "apple" ? "⌘W" : "⌃F4") : undefined,
      disabled: active === undefined,
      onSelect: onClose,
    },
    // The application menu's Settings…, which has nowhere else to go: the
    // first level holds the section names only, so it sits at the foot of
    // File, where the shell's File menu puts it (nativeMenus). No ⌘, — in a
    // browser that is the browser's own settings.
    // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showSettings
    // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.settingsWindowController
    // @upstream-differs at the foot of File, with no key equivalent
    { kind: "separator" },
    { label: L("Settings…"), onSelect: onSettings },

    { kind: "separator" },
    { kind: "heading", label: L("Edit", { context: "menu" }), opensMenu: true },
    // Named by what they take back, where the step carries a name: a tool's
    // transaction names itself, so this reads `Undo Fix FIT Checksum` rather
    // than leaving the user to remember what the last thing was. Greyed rather
    // than absent when there is nothing to take back, and then the bare verb:
    // an item that comes and goes is one the eye has to search for.
    {
      // help: menu.edit.undo
      label: undoable?.label === undefined ? L("Undo") : L("Undo %1$@", undoable.label),
      shortcut: "⌘Z",
      disabled: undoable === undefined,
      onSelect: () => void undoLast(front, false),
    },
    {
      // help: menu.edit.redo
      label: redoable?.label === undefined ? L("Redo") : L("Redo %1$@", redoable.label),
      shortcut: "⇧⌘Z",
      disabled: redoable === undefined,
      onSelect: () => void redoLast(front),
    },
    { kind: "separator" },
    {
      // Copy and Paste in one step, without the clipboard: the active pane's
      // selection goes to the same addresses in the other pane. Upstream's
      // ⌥⌘C is not offered: every browser on a Mac keeps it for its own
      // inspector, so a shortcut here would be one that never arrives.
      // @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeEditMenu
      // @upstream-differs no ⌥⌘C — the chord is the browser's developer tools
      // help: menu.edit.copy-to-other-pane
      label: L("Copy to Other Pane"),
      disabled: !canCopyToOtherPane(state, state.activePane),
      onSelect: () => void copySelectionToOtherPane(state.activePane),
    },
    { kind: "separator" },
    // help: menu.edit.fill
    { label: L("Fill Selection with…"), disabled: active === undefined, onSelect: onFill },
    // help: menu.edit.delete-bytes
    { label: L("Delete Bytes…"), disabled: active === undefined, onSelect: onDeleteBytes },
    { kind: "separator" },
    {
      // help: menu.edit.find
      label: L("Find…"),
      shortcut: "⌘F",
      disabled: active === undefined,
      onSelect: onFind,
    },
    {
      // help: menu.edit.go-to
      label: L("Go To Position…"),
      shortcut: "⌘L",
      disabled: active === undefined,
      onSelect: onGoTo,
    },

    { kind: "separator" },
    { kind: "heading", label: L("Bookmarks", { context: "menu" }), opensMenu: true },
    // The marks of whatever is in front, read at its own offsets: the
    // workspace's list for its panes, the same list at the part's offsets for a
    // panel (§20.7). A panel showing a decompressed body has none, and ⌘D is
    // off there — there is no row of the file to mark.
    {
      label:
        active !== undefined && bookmarkAt(front, active.document.caret) !== undefined
          ? L("Remove Bookmark")
          : L("Add Bookmark"),
      shortcut: "⌘D",
      disabled: active === undefined || marksFor(front) === undefined,
      onSelect: onToggleBookmark,
    },
    {
      // help: menu.edit.bookmark-edit
      label: L("Bookmarks…"),
      shortcut: "⌥⌘B",
      disabled: active === undefined,
      onSelect: onBookmarks,
    },

    { kind: "separator" },
    { kind: "heading", label: L("Segments", { context: "menu" }), opensMenu: true },
    // help: menu.edit.add-cut
    { label: L("Split Here…"), disabled: active === undefined, onSelect: onSplitHere },
    {
      // help: menu.edit.merge
      label: L("Merge"),
      disabled: active === undefined || pieceCount < 2,
      onSelect: () => {
        const piece = pieceAt(front, active?.document.caret ?? 0);
        if (piece !== undefined) mergePiece(front, piece.index);
      },
    },
    // help: menu.edit.segments
    { label: L("Segments…"), disabled: active === undefined, onSelect: onSegments },
    {
      // help: dialog.segments
      label: L("Save All as Separate Files…"),
      disabled: active === undefined || pieceCount < 2,
      onSelect: onSaveAllSegments,
    },

    { kind: "separator" },
    { kind: "heading", label: L("View", { context: "menu" }), opensMenu: true },
    {
      label:
        // help: menu.view.pane-layout
        state.layout === "sideBySide" ? L("Stack the Panes") : L("Put the Panes Side by Side"),
      disabled: !bothOpen || !panesReachable,
      onSelect: () => setLayout(state.layout === "sideBySide" ? "stacked" : "sideBySide"),
    },
    {
      // help: menu.view.swap-panes
      label: L("Swap Panes"),
      disabled: !bothOpen || !panesReachable,
      onSelect: () => {
        panesSwapped();
        swapPanes();
      },
    },
    {
      // help: menu.view.minimap
      label: minimap.visible ? L("Hide Minimap") : L("Show Minimap"),
      shortcut: "⌘M",
      // No file open, no map to show: the empty window's panel is hidden and
      // the item has nothing to switch.
      disabled: state.panes.a === undefined && state.panes.b === undefined,
      onSelect: () => toggleMinimap(),
    },
    { kind: "separator" },
    // Back and Forward walk the places the tab's jumps left (§10.6), on the keys a browser and
    // Finder use for them.
    {
      // help: menu.view.back
      label: L("Back"),
      shortcut: "⌘[",
      disabled: !history.back,
      onSelect: navigateBack,
    },
    {
      // help: menu.view.forward
      label: L("Forward"),
      shortcut: "⌘]",
      disabled: !history.forward,
      onSelect: navigateForward,
    },
    { kind: "separator" },
    {
      // help: menu.view.next-difference
      label: L("Next Difference"),
      // The page answers the key wherever the keyboard is (AppShell's window
      // handler); the menu only draws the designation, so no shellKey.
      shortcut: "⌥⌘→",
      disabled: !canNavigate,
      onSelect: () => onNavigate("difference", 1),
    },
    {
      // help: menu.view.previous-difference
      label: L("Previous Difference"),
      shortcut: "⌥⌘←",
      disabled: !canNavigate,
      onSelect: () => onNavigate("difference", -1),
    },
    {
      label: L("Next Same Block"),
      shortcut: "⇧⌥⌘→",
      disabled: !canNavigate,
      // help: menu.view.next-same
      onSelect: () => onNavigate("same", 1),
    },
    {
      // help: menu.view.previous-same
      label: L("Previous Same Block"),
      shortcut: "⇧⌥⌘←",
      disabled: !canNavigate,
      onSelect: () => onNavigate("same", -1),
    },

    // The Help menu, which has nowhere else to go: there is no menu bar here.
    // Upstream's five destinations, in upstream's order — the book, the two
    // pages a bench walks in through, the two glossaries, and where the
    // knowledge comes from. Each carries a `HelpLink` and nothing matches on a
    // title (`Design/HELP.md`).
    //
    // No ⌘? beside the first: in a browser that chord is ⌘⇧/, which several
    // engines have spent. F1 and ⌘/ open the book instead.
    //
    // @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeHelpMenu
    // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showHelpBook
    { kind: "separator" },
    { kind: "heading", label: L("Help", { context: "menu" }), opensMenu: true },
    ...helpMenuEntries(),
    // Where upstream's is the application menu's first item, and a page has no
    // application menu.
    // @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.build
    // @upstream-differs at the foot of Help
    { kind: "separator" },
    { label: L("About ByteRipper"), onSelect: showAbout },
  ]);

  // The plaque's last determined answer, held through a rebuild.
  const identical = useRef(false);
  identical.current = identicalBadgeAfter(identical.current, diff);
  const search = useStore(searchStore);
  const context: ToolbarContext = {
    activeOpen: active !== undefined,
    comparison: bothOpen,
    windowOpen: state.panes.a !== undefined || state.panes.b !== undefined,
    navigation,
    history,
  };
  // The picker names what the surface in front is running.
  const activeTool = TOOLS.find((tool) => tool.id === frontSession(tools).activeIdentifier);
  const layoutOffer = paneLayoutOffer(state.layout);
  // The word size is the bar's one `<select>`, and a select takes a ring from a
  // tap; the field asks here whether the keyboard was the last input, as the
  // panel header's selector does.
  const keyboardRing = useKeyboardInput();

  // The Tools pull-down: None, then every tool by name, as upstream's Tools menu
  // has them. A tool wears a check while it is the active one; None is a plain
  // command with no check — it is not a tool but the way the panel is closed,
  // and it stays available always. A tool needs a file open in the active pane.
  // The web edition has no Tools menu besides it; the toolbar is where the list
  // lives.
  //
  // The line between None and the modules is upstream's: None is not a tool, it
  // is how the panel is closed, and the separator is what says so. Upstream
  // draws it only when the registry holds something, which is what
  // `compactEntries` does with a separator nothing follows.
  //
  // @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.makeToolsMenu
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activateTool
  // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.validateMenuItem
  const toolEntries = compactEntries([
    {
      // help: menu.tools.none
      label: L("None"),
      onSelect: () => activate(undefined),
    },
    { kind: "separator" },
    ...TOOLS.map((tool, index) => {
      const row = menuState(tool.id, active !== undefined);
      const key = toolKeyEquivalent(index);
      return {
        label: tool.title,
        // ⌘1, ⌘2, … only where the window is the app's: a browser keeps them for its
        // own tabs and never hands them to a page.
        shortcut: nativeMenuBar && key !== undefined ? `⌘${key}` : undefined,
        checked: row.checked,
        disabled: !row.enabled,
        onSelect: () => activate(tool.id),
      };
    }),
  ]);

  // In the optional Windows shell the command menu is the window's menu bar,
  // with the Tools pull-down as its own menu before Help — where upstream's
  // menu bar has it — and the ☰ button goes: one place for the commands.
  // A browser has no bridge, and nothing here happens.
  // @web-only the desktop shell's native menu bar (D15)
  useEffect(() => {
    if (!nativeMenuBar) return;
    const help = entries.findIndex(
      (entry) =>
        entry.kind === "heading" &&
        entry.opensMenu === true &&
        entry.label === L("Help", { context: "menu" })
    );
    const at = help < 0 ? entries.length : help;
    // The page's zoom is the window's, so it is the shell that changes it: the
    // View menu ends with the three commands, and the menu answers their keys.
    // @web-only a browser has its own zoom, and the page has no key for it
    const zoom = (step: -1 | 0 | 1) => () => desktopBridge()?.zoom(step);
    const viewEnd = entries[at - 1]?.kind === "separator" ? at - 1 : at;
    // Exit closes File, after Settings…, where a Windows application has it.
    // @web-only a browser tab is closed by the browser
    const file = entries.findIndex((entry) => entry.kind === "heading" && entry.opensMenu === true);
    const exit: MenuEntry[] = [
      { label: L("Exit"), onSelect: () => desktopBridge()?.quit() },
      { kind: "separator" },
    ];
    // File ▸ Open Recent, the shell only: each row re-opens its own file, and
    // Clear Menu forgets them. @web-only a browser tab has no menu bar to hang it on
    const openRecent = {
      rows: recent.rows.map((row, index) => ({ name: row.name, open: () => onOpenRecent(index) })),
      clear: onClearRecent,
    };
    publishNativeMenu(
      [
        ...entries.slice(0, Math.max(file, 0)),
        ...exit,
        ...entries.slice(Math.max(file, 0), viewEnd),
        { kind: "separator" },
        { label: L("Zoom In"), shortcut: "⌘+", shellKey: true, onSelect: zoom(1) },
        { label: L("Zoom Out"), shortcut: "⌘-", shellKey: true, onSelect: zoom(-1) },
        { label: L("Actual Size"), shortcut: "⌘0", shellKey: true, onSelect: zoom(0) },
        ...entries.slice(viewEnd, at),
        { kind: "heading", label: L("Tools"), opensMenu: true },
        ...toolEntries,
        // Window ▸ Agent: the service's state and the log of what agents have asked. Where
        // upstream's menu bar has it, before Help, and only where there is a service to show.
        // @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.build
        ...(agentService.isAvailable
          ? ([
              { kind: "heading", label: L("Window", { context: "menu" }), opensMenu: true },
              // help: menu.window.agent
              {
                label: L("Agent"),
                checked: agent.windowOpen,
                onSelect: () => agentService.setWindowOpen(!agent.windowOpen),
              },
            ] satisfies MenuEntry[])
          : []),
        ...entries.slice(at),
        // After the Help pages, where a Windows application keeps it.
        // @web-only the desktop build replaces itself; a page is replaced by loading it again
        { kind: "separator" },
        { label: L("Check for Update…"), onSelect: () => void checkForUpdate() },
      ],
      openRecent
    );
  });

  const keyed: { readonly id: ToolbarItemId; readonly key: string }[] = [];
  const seen = new Map<ToolbarItemId, number>();
  for (const id of toolbarItems(bothOpen, identical.current, agent.running)) {
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
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.wordSizeItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.paneLayoutItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.toolsItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeDiffNavigationGroup
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeFilesIdenticalItem
   * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeFilesIdenticalBadgeView
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
        // The wrench, and the name of the tool-module in force — "Tools" at
        // rest, the picker's own name while no module is running (upstream's
        // `noToolTitle`), so the button always says what the tab is working
        // with rather than going blank. A pull-down, with its chevron: it opens
        // a list to choose from rather than acting at once.
        //
        // "Tools" and the tooltip resolve here at render, because the language
        // can switch while the page is up; the tool's own name does so in its
        // module — a getter that asks the language on every access.
        return (
          <MenuButton
            key={key}
            pullDown
            className="toolbar-tools"
            ariaLabel={L("Tools")}
            title={L("The tool-module this tab is working with")}
            disabled={disabled}
            label={
              <>
                <ToolsGlyph />
                <span>{activeTool ? activeTool.title : L("Tools")}</span>
              </>
            }
            entries={toolEntries}
          />
        );
      case "goTo":
        return (
          <IconButton
            key={key}
            label={L("Go To")}
            title={L("Go to an offset or a bookmark")}
            disabled={disabled}
            onClick={onGoTo}
          >
            <GoToGlyph />
          </IconButton>
        );
      case "find":
        // A switch, not the menu's command: pressing it again closes the bar,
        // and opening it takes nothing from the dump (§11, Use Selection for
        // Find — the command that does is ⌘F and the menu item above it).
        return (
          <IconButton
            key={key}
            label={L("Find")}
            title={L("Find bytes or text")}
            pressed={search.open}
            disabled={disabled}
            onClick={() => (search.open ? closeSearch() : onToggleFind())}
          >
            <FindGlyph />
          </IconButton>
        );
      case "segments":
        return (
          <IconButton
            key={key}
            label={L("Segments")}
            title={L("The file's cuts and pieces")}
            disabled={disabled}
            onClick={onSegments}
          >
            <SegmentsGlyph />
          </IconButton>
        );
      case "wordSize":
        // A native `<select>`, which is the one built-in single-choice list
        // HTML has and is the same control upstream's `NSPopUpButton(pullsDown:
        // false)` is — the option it shows *is* its selection, and the keyboard
        // reaches it for free. Only the bezel is drawn here: the platform's own
        // arrow and inset make the one popup in the bar look like a different
        // family from the buttons beside it, and upstream's popup takes the
        // toolbar's bezel too. So the bezel is `.toolbar-button`'s and the
        // arrow is the chevron every pull-down here wears.
        return (
          <span key={key} className={`toolbar-word-size${keyboardRing ? " is-keyboard" : ""}`}>
            <select
              className="toolbar-select"
              value={state.wordSize}
              onChange={(event) => setWordSize(wordSizeFrom(Number(event.target.value)))}
              // help: menu.view.word-size
              aria-label={L("Word Size")}
              title={L("Bytes per word in the hex grid")}
            >
              {WORD_SIZES.map((size) => (
                <option key={size} value={size}>
                  {wordSizeTitle(size)}
                </option>
              ))}
            </select>
            <svg
              className="menu-chevron"
              width="8"
              height="5"
              viewBox="0 0 8 5"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <ChevronShapes />
            </svg>
          </span>
        );
      // Back and Forward through the tab's navigation history (§10.6): the chevrons Finder has
      // for the same two commands, joined in one block.
      // help: toolbar.history
      // @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeHistoryNavigationGroup
      // @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.historyNavigationGroup
      case "historyNavigation":
        return (
          <span key={key} className="toolbar-group">
            <IconButton
              label={L("Back")}
              title={L("Go back to where the last jump left")}
              disabled={!toolbarItemEnabled("navigateBack", context)}
              onClick={navigateBack}
            >
              <ChevronLeftGlyph />
            </IconButton>
            <IconButton
              label={L("Forward")}
              title={L("Go forward to where Back left")}
              disabled={!toolbarItemEnabled("navigateForward", context)}
              onClick={navigateForward}
            >
              <ChevronRightGlyph />
            </IconButton>
          </span>
        );
      case "diffNavigation":
        return (
          <span key={key} className="toolbar-group">
            <IconButton
              label={L("Prev Diff")}
              title={L("Previous Difference")}
              disabled={!toolbarItemEnabled("previousDifference", context)}
              onClick={() => onNavigate("difference", -1)}
            >
              <BackwardGlyph />
            </IconButton>
            <IconButton
              label={L("Next Diff")}
              title={L("Next Difference")}
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
            aria-label={L("Files are identical")}
          >
            <IdenticalGlyph />
            {L("Files are identical")}
          </span>
        );
      // The `?`, between the difference plaque and the pane arrangement: the
      // book's door where a reader is already looking, which is at the thing
      // they do not understand rather than in a menu.
      //
      // A pull-down rather than a plain button, because the book has more than
      // one starting point and picking the right one is most of the value — and
      // the list is `helpMenuEntries()`, the same builder the command menu's
      // Help block uses, so the two cannot offer different doors.
      //
      // Nothing to disable: the book is there whatever the workspace holds,
      // which is the same reason upstream's item has no validation.
      //
      // help: toolbar.help
      // @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeHelpItem
      // @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.helpItem
      // @upstream ByteRipperApp/App/MainWindowController.swift#NSToolbarItem.Identifier.help
      case "help":
        return (
          <MenuButton
            key={key}
            className="toolbar-help"
            label={<HelpGlyph />}
            ariaLabel={L("Help", { context: "menu" })}
            title={L("Where to start reading the help book")}
            entries={helpMenuEntries()}
            pullDown
          />
        );
      // The Agent window as a button, while the agent service is switched on.
      // help: toolbar.agent
      // @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.agentWindowItem
      // @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.makeAgentWindowItem
      case "agentWindow":
        return (
          <IconButton
            key={key}
            label={L("Agent")}
            title={`${L("Show the Agent window")} — ${agentStatusText({
              available: true,
              failure: agent.failure,
              running: agent.running,
              connections: agent.connections,
            })}`}
            pressed={agent.windowOpen}
            onClick={() => agentService.setWindowOpen(!agent.windowOpen)}
          >
            <AgentGlyph connected={agent.connections > 0} />
          </IconButton>
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
            label={L("Toggle Minimap")}
            title={`${L("Show or hide the minimap")} (Cmd/Ctrl+M)`}
            pressed={minimap.visible}
            disabled={disabled}
            onClick={() => toggleMinimap()}
          >
            <MinimapGlyph />
          </IconButton>
        );
    }
  };

  return (
    <header className="toolbar">
      {/* The web edition's menu bar, before everything: a page has nowhere else
          to put File, Edit and View. Two levels, as the bar has two places —
          the section names at the first, the open section's commands at the
          second. */}
      {nativeMenuBar ? null : (
        <SectionMenu
          label="☰"
          ariaLabel={L("Commands")}
          title={L("Commands")}
          sections={sectionsOf(entries)}
        />
      )}
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
