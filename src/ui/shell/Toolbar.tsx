import { useRef } from "react";
import { TOPIC, termId, termLink, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { saveVerb } from "@/platform/files/capabilities";
import { WORD_SIZES } from "@/render/hexGrid/hexLayout";
import { bookmarkAt, bookmarksStore, marksFor } from "@/state/bookmarksStore";
import { diffStore } from "@/state/diffStore";
import { editStore } from "@/state/editStore";
import { showHelp } from "@/state/helpStore";
import { frontMap, minimapStore, toggleMinimap } from "@/state/minimapStore";
import { closeSearch, searchStore } from "@/state/searchStore";
import { segmentsStore } from "@/state/segmentsStore";
import { wordSizeFrom } from "@/state/settingsStore";
import {
  activate,
  frontSession,
  menuState,
  panesSwapped,
  toolController,
} from "@/state/toolController";
import { nextRedo, nextUndo, redoLast, undoLast } from "@/state/undoRouter";
import { useStore } from "@/state/useStore";
import {
  frontPane,
  GROUPING_GAP_CHOICES,
  paneIn,
  type SlotId,
  setGroupingGap,
  setLayout,
  setWordSize,
  swapPanes,
  windowPanesAreReachable,
  workspaceStore,
} from "@/state/workspaceStore";
import { TOOLS } from "@/tools/registry";
import { mergePiece, pieceAt } from "@/ui/segments/segmentCommands";
import { wordSizeChoiceTitle } from "@/ui/settings/settingsText";
import { ChevronShapes } from "@/ui/shell/chevronGlyph";
import { MenuButton } from "@/ui/shell/MenuButton";
import { compactEntries } from "@/ui/shell/menuModel";
import { revertItem } from "@/ui/shell/paneMenus";
import {
  BackwardGlyph,
  FindGlyph,
  ForwardGlyph,
  GoToGlyph,
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
 * What the tool picker says when no tool-module is running: its own name.
 *
 * The item always says what it holds — the name of the tool-module in force,
 * or "Tools" while there is none. A wrench on its own is a picture the reader
 * has to recognise before they can use it, and this is the one item in the
 * toolbar whose whole job is naming what the tab is working with; going blank
 * at rest is exactly when it is least obvious.
 *
 * @upstream ByteRipperApp/App/MainWindowController.swift#MainWindowController.noToolTitle
 */
const noToolTitle = "Tools";

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
  onToggleFind,
  onClose,
  onSettings,
  navigation,
}: {
  readonly onOpen: (into?: SlotId) => void;
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
  // Subscribed for the nudge; the document itself is the truth.
  useStore(editStore);
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
  const anyOpen = state.panes.a !== undefined;
  const dirty = active?.document.isDirty === true;
  const revert = revertItem(active);

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
    { label: L("Settings…"), onSelect: onSettings },
    { kind: "separator" },
    { kind: "heading", label: L("File", { context: "menu" }) },
    { label: L("New"), onSelect: onNew },
    { label: L("Open…"), onSelect: () => onOpen() },
    anyOpen && state.panes.b === undefined
      ? { label: L("Compare with…"), disabled: !panesReachable, onSelect: () => onOpen("b") }
      : undefined,
    { kind: "separator" },
    active === undefined
      ? undefined
      : {
          label: verb === "Save" ? L("Save") : L("Download"),
          disabled: !dirty && verb === "Save",
          onSelect: onSave,
        },
    active === undefined
      ? undefined
      : { label: verb === "Save" ? "Save As…" : "Download As…", onSelect: onSaveAs },
    // Revert follows the pane in front like the saves above it, titled for what
    // that pane goes back to. The three below it act on the workspace's own
    // panes instead: a part has no pane beside it.
    active === undefined
      ? undefined
      : { label: revert.title, disabled: !revert.enabled, onSelect: onRevert },
    { kind: "separator" },
    active === undefined
      ? undefined
      : {
          label: L("Insert File at Start…"),
          disabled: !panesReachable,
          onSelect: () => onJoin("start"),
        },
    active === undefined
      ? undefined
      : { label: L("Append File…"), disabled: !panesReachable, onSelect: () => onJoin("end") },
    { kind: "separator" },
    active === undefined
      ? undefined
      : { label: L("Duplicate"), disabled: !panesReachable, onSelect: onDuplicate },
    active === undefined ? undefined : { label: L("Close"), onSelect: onClose },

    { kind: "separator" },
    { kind: "heading", label: L("Edit", { context: "menu" }) },
    // Named by what they take back, where the step carries a name: a tool's
    // transaction names itself, so this reads `Undo Fix FIT Checksum` rather
    // than leaving the user to remember what the last thing was. Absent rather
    // than greyed when there is nothing to take back.
    undoable === undefined
      ? undefined
      : {
          label: undoable.label === undefined ? L("Undo") : L("Undo %1$@", undoable.label),
          shortcut: "⌘Z",
          onSelect: () => void undoLast(front, false),
        },
    redoable === undefined
      ? undefined
      : {
          label: redoable.label === undefined ? L("Redo") : L("Redo %1$@", redoable.label),
          shortcut: "⇧⌘Z",
          onSelect: () => void redoLast(front),
        },
    undoable === undefined && redoable === undefined ? undefined : { kind: "separator" },
    active === undefined ? undefined : { label: L("Fill Selection with…"), onSelect: onFill },
    active === undefined ? undefined : { label: L("Delete Bytes…"), onSelect: onDeleteBytes },
    active === undefined ? undefined : { kind: "separator" },
    active === undefined ? undefined : { label: L("Find…"), shortcut: "⌘F", onSelect: onFind },
    active === undefined
      ? undefined
      : { label: L("Go To Position…"), shortcut: "⌘L", onSelect: onGoTo },

    active === undefined ? undefined : { kind: "separator" },
    active === undefined
      ? undefined
      : { kind: "heading", label: L("Bookmarks", { context: "menu" }) },
    // The marks of whatever is in front, read at its own offsets: the
    // workspace's list for its panes, the same list at the part's offsets for a
    // panel (§20.7). A panel showing a decompressed body has none, and ⌘D is
    // off there — there is no row of the file to mark.
    active === undefined || marksFor(front) === undefined
      ? undefined
      : {
          label:
            bookmarkAt(front, active.document.caret) === undefined
              ? "Add Bookmark"
              : "Remove Bookmark",
          shortcut: "⌘D",
          onSelect: onToggleBookmark,
        },
    active === undefined
      ? undefined
      : { label: L("Bookmarks…"), shortcut: "⌥⌘B", onSelect: onBookmarks },

    active === undefined ? undefined : { kind: "separator" },
    active === undefined
      ? undefined
      : { kind: "heading", label: L("Segments", { context: "menu" }) },
    active === undefined ? undefined : { label: L("Split Here…"), onSelect: onSplitHere },
    active === undefined
      ? undefined
      : {
          label: L("Merge"),
          disabled: pieceCount < 2,
          onSelect: () => {
            const piece = pieceAt(front, active.document.caret);
            if (piece !== undefined) mergePiece(front, piece.index);
          },
        },
    active === undefined ? undefined : { label: L("Segments…"), onSelect: onSegments },
    active === undefined
      ? undefined
      : {
          label: L("Save All as Separate Files…"),
          disabled: pieceCount < 2,
          onSelect: onSaveAllSegments,
        },

    { kind: "separator" },
    { kind: "heading", label: L("View", { context: "menu" }) },
    bothOpen
      ? {
          label: state.layout === "sideBySide" ? "Stack the Panes" : "Put the Panes Side by Side",
          disabled: !panesReachable,
          onSelect: () => setLayout(state.layout === "sideBySide" ? "stacked" : "sideBySide"),
        }
      : undefined,
    bothOpen
      ? {
          label: L("Swap Panes"),
          disabled: !panesReachable,
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
          onSelect: () => toggleMinimap(),
        }
      : undefined,
    bothOpen ? { kind: "separator" } : undefined,
    bothOpen
      ? {
          label: L("Next Difference"),
          disabled: !canNavigate,
          onSelect: () => onNavigate("difference", 1),
        }
      : undefined,
    bothOpen
      ? {
          label: L("Previous Difference"),
          disabled: !canNavigate,
          onSelect: () => onNavigate("difference", -1),
        }
      : undefined,
    bothOpen
      ? {
          label: L("Next Same Block"),
          disabled: !canNavigate,
          onSelect: () => onNavigate("same", 1),
        }
      : undefined,
    bothOpen
      ? {
          label: L("Previous Same Block"),
          disabled: !canNavigate,
          onSelect: () => onNavigate("same", -1),
        }
      : undefined,

    bothOpen ? { kind: "separator" } : undefined,
    bothOpen ? { kind: "heading", label: L("Grouping distance") } : undefined,
    ...(bothOpen
      ? GROUPING_GAP_CHOICES.map((gap) => ({
          label: L("%1$@ bytes", gap),
          checked: state.groupingGap === gap,
          exclusive: true,
          onSelect: () => setGroupingGap(gap),
        }))
      : []),

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
    { kind: "heading", label: L("Help", { context: "menu" }) },
    { label: L("ByteRipper Help"), onSelect: () => showHelp(topicLink(TOPIC.overview)) },
    { label: L("Getting Started"), onSelect: () => showHelp(topicLink(TOPIC.firstComparison)) },
    { label: L("Bench Rules"), onSelect: () => showHelp(topicLink(TOPIC.benchSafety)) },
    {
      label: L("Glossary: UEFI Images"),
      onSelect: () => showHelp(termLink(termId("flash-descriptor"))),
    },
    { label: L("Glossary: Intel ME"), onSelect: () => showHelp(termLink(termId("fpt"))) },
    {
      label: L("Where This Knowledge Comes From"),
      onSelect: () => showHelp(topicLink(TOPIC.provenance)),
    },
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
  // The picker names what the surface in front is running.
  const activeTool = TOOLS.find((tool) => tool.id === frontSession(tools).activeIdentifier);
  const layoutOffer = paneLayoutOffer(state.layout);
  // The word size is the bar's one `<select>`, and a select takes a ring from a
  // tap; the field asks here whether the keyboard was the last input, as the
  // panel header's selector does.
  const keyboardRing = useKeyboardInput();

  // The Tools pull-down: None, then every tool by name, as upstream's Tools menu
  // has them — a radio group where None closes the panel and stays available,
  // and a tool needs a file open in the active pane. The web edition has no
  // Tools menu besides it; the toolbar is where the list lives.
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
      label: L("None"),
      checked: menuState(undefined, active !== undefined).checked,
      exclusive: true,
      onSelect: () => activate(undefined),
    },
    { kind: "separator" },
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
        return (
          <MenuButton
            key={key}
            pullDown
            className="toolbar-tools"
            ariaLabel="Tools"
            title="The tool-module this tab is working with"
            disabled={disabled}
            label={
              <>
                <ToolsGlyph />
                <span>{activeTool?.title ?? noToolTitle}</span>
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
        // A switch, not the menu's command: pressing it again closes the bar,
        // and opening it takes nothing from the dump (§11, Use Selection for
        // Find — the command that does is ⌘F and the menu item above it).
        return (
          <IconButton
            key={key}
            label="Find"
            title="Find a byte pattern"
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
            label="Segments"
            title="The file's cuts and pieces"
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
              aria-label={L("Word Size")}
              title="Bytes per word in the hex grid"
            >
              {WORD_SIZES.map((size) => (
                <option key={size} value={size}>
                  {wordSizeChoiceTitle(size)}
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
            aria-label={L("Files are identical")}
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
