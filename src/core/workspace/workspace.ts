/**
 * The session as it is written down: what the tab had open and where (`Design/WORKSPACE.md`).
 *
 * A value, gathered from the live panes and applied back to them. It names files by what a page
 * can know of them and says what they were like when it was taken (`FileStamp`), so the restore
 * can tell a file that is still the same from one that was rewritten in between.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#Workspace
 * @upstream-differs one tab, the page's, where upstream keeps windows of tabs
 */
export interface Workspace {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#Workspace.version */
  readonly version: number;
  readonly tab: TabState;
  /** The Annotations panel: whether it was up, and the cards chosen in it. */
  readonly notes?: NotesState | undefined;
}

/**
 * The version this build writes. A record of another version is ignored rather than migrated:
 * losing a workspace is an inconvenience, misreading one is not acceptable.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#Workspace.currentVersion
 */
export const WORKSPACE_VERSION = 2;

/**
 * The Annotations panel: whether it was the panel up, and which cards were chosen. The annotations
 * themselves are kept on their own, with ids that last from one visit to the next.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#NotesState
 * @upstream-differs a panel of the dock, so it is up or folded rather than placed among tabs
 */
export interface NotesState {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#NotesState.isSelected */
  readonly isUp: boolean;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#NotesState.selected */
  readonly selected: readonly string[];
}

/**
 * The tab: File A and File B, which of them has the keyboard, and the state around them.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#TabState
 * @upstream-differs no bookmarks: the page keeps them under the workspace's id already
 */
export interface TabState {
  /**
   * File A, then File B; nothing for a slot with nothing open.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#TabState.panes
   */
  readonly panes: readonly (PaneState | undefined)[];
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#TabState.activePane */
  readonly activePane: number;
  /**
   * The share of the split File A takes in a comparison (0–1); absent outside one.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#TabState.dividerFraction
   */
  readonly dividerFraction?: number | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#TabState.surface */
  readonly surface: SurfaceState;
  /**
   * The panels over the tab, a parent always before the parts taken out of it.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#TabState.fragments
   */
  readonly fragments: readonly FragmentState[];
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#TabState.expandedFragment */
  readonly expandedFragment?: number | undefined;
}

/**
 * One pane: the document in it, and where the reader was in it.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState
 */
export interface PaneState {
  /**
   * What the parts taken out of this pane name it by. Unique within one workspace.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.id
   */
  readonly id?: string | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.document */
  readonly document: DocumentSource;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.selectionStart */
  readonly selectionStart: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.selectionEnd */
  readonly selectionEnd: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.inputRegion */
  readonly inputRegion: InputRegion;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.insertMode */
  readonly insertMode: boolean;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.topOffset */
  readonly topOffset: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.segments */
  readonly segments?: SegmentationState | undefined;
  /**
   * A file's content beyond what is on disk — its unsaved changes and the history that made them
   * — kept beside the workspace. Nothing for a file with neither.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.kept
   */
  readonly kept?: KeptContent | undefined;
  /**
   * What the undo router and the cut history held for the pane: what a press of Undo takes back
   * after a relaunch, the cuts with it (`Design/PORT_WINDOW_07A3928_21A2889.md`, P6e).
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.segmentsMagic
   * @upstream-differs upstream pairs a snapshot with each step of the document's history in its
   * log; the web keeps its snapshots on the router's acts and its cuts' own history, so those are
   * what is written down
   */
  readonly undo?: PaneUndoState | undefined;
}

/**
 * A document's content as a workspace keeps it: a base, and the log of the transactions made over
 * it. Every state a document passes through has a serial of its own; the base holds one state, the
 * log holds transactions, each naming the state it was applied to, and the content is the state
 * `head` names, found from the base by the transactions between them. An edit appends to the log
 * and an undo only moves `head`, so a snapshot writes what changed since the last one.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.init
 */
export interface KeptContent {
  /**
   * The document's name in `Kept/`, for as long as it is kept.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.id
   */
  readonly id: string;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.base */
  readonly base: KeptBase;
  /**
   * The state the document was in.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.head
   */
  readonly head: number;
  /**
   * Where its serials go on counting from.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.nextSerial
   */
  readonly nextSerial: number;
  /**
   * For a file: the state the file on disk holds. Nothing for a document with no file.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.saved
   */
  readonly saved?: number | undefined;
  /**
   * The transactions over the base; nothing while there are none.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.log
   */
  readonly log?: KeptLog | undefined;
  /**
   * The history over the content: what undo and redo find after a relaunch. Nothing for content
   * kept without one.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.history
   */
  readonly history?: KeptHistory | undefined;
}

/**
 * The files in `Kept/` a content is read from.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptContent.files
 */
export function keptFiles(content: KeptContent): string[] {
  const files: string[] = [];
  if (content.base.kind !== "file") files.push(content.base.file);
  if (content.log !== undefined) files.push(content.log.file);
  return files;
}

/**
 * The state a kept content starts from: the file on disk, which holds the state `serial` names;
 * the whole content in `Kept/<file>` — an untitled document or a part; or runs over the file on
 * disk (`OverlayEdits`) in `Kept/<file>` — a file whose saved state no transaction kept leads to.
 * `hash` is the kept file's SHA-256, hex: it is read only when it matches.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptBase
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptBase.serial
 */
export type KeptBase =
  | { readonly kind: "file"; readonly serial: number }
  | {
      readonly kind: "bytes" | "edits";
      readonly file: string;
      readonly serial: number;
      readonly hash: string;
    };

/**
 * A log in `Kept/`, pinned: the length it is read to and the chained hash at that length, hex.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptLog
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptLog.init
 */
export interface KeptLog {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptLog.file */
  readonly file: string;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptLog.length */
  readonly length: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptLog.hash */
  readonly hash: string;
}

/**
 * A document's undo history as a workspace keeps it, beside its content: the transactions are in
 * the log, this says how they stand.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory.init
 */
export interface KeptHistory {
  /**
   * The state an empty undo side stands for: the undo side is the way from it to the head.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory.undoBase
   */
  readonly undoBase: number;
  /**
   * The newest state the redo side leads to; nothing with nothing to redo.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory.redoTip
   */
  readonly redoTip?: number | undefined;
  /**
   * How many transactions each redo step holds, the next to redo first.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory.redoSteps
   */
  readonly redoSteps: readonly number[];
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory.savedState */
  readonly savedState: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory.dirtyRegardless */
  readonly dirtyRegardless: boolean;
  /**
   * The joins that can be undone and those that can be redone, each with the file it detached the
   * document from.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory.joins
   */
  readonly joins: readonly KeptJoin[];
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptHistory.undoneJoins */
  readonly undoneJoins: readonly KeptJoin[];
}

/**
 * A join on a kept history: its transaction, and the file it detached the document from — which
 * undoing it attaches the document to again.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptJoin
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptJoin.init
 * @upstream-differs the file as a stamp and the name the pane showed, a page reaching a file by
 * its handle or, in the shell, its path
 */
export interface KeptJoin {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptJoin.serial */
  readonly serial: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptJoin.path */
  readonly file: FileStamp;
  readonly name: string;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#KeptJoin.readOnly */
  readonly readOnly: boolean;
}

/**
 * What the undo router held for a pane, and the cuts' own history: the acts in the order they
 * were made, those undone in the order they were taken out, each with the partitions it restores;
 * and the partitions the segments store can step back and forth through.
 *
 * @web-only see {@link PaneState.undo}
 */
export interface PaneUndoState {
  readonly past: readonly UndoActState[];
  readonly future: readonly UndoActState[];
  readonly cutsPast: readonly SegmentationState[];
  readonly cutsFuture: readonly SegmentationState[];
}

/** One act of the undo router: an edit, a cut, or both as one. */
export interface UndoActState {
  readonly kind: "document" | "segments" | "group";
  readonly parts?: readonly UndoActState[] | undefined;
  /** For a group: the partition before its first part. */
  readonly before?: SegmentationState | undefined;
  /** The partition the act left, taken when it was undone. */
  readonly after?: SegmentationState | undefined;
}

/** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#InputRegion */
export type InputRegion = "hex" | "text";

/**
 * Where a pane's bytes come from.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#DocumentSource
 */
export type DocumentSource =
  | { readonly kind: "file"; readonly file: FileStamp }
  | { readonly kind: "untitled"; readonly untitled: UntitledStamp }
  | { readonly kind: "part"; readonly part: PartOrigin };

/**
 * Where a part came from: the pane it was taken out of, the stretch of it, and how it was read.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin
 */
export interface PartOrigin {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin.parent */
  readonly parent: string;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin.sourceStart */
  readonly sourceStart: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin.sourceEnd */
  readonly sourceEnd: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin.name */
  readonly name: string;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin.layout */
  readonly layout?: string | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin.codec */
  readonly codec?: string | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin.size */
  readonly size: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PartOrigin.edits */
  readonly edits?: UntitledStamp | undefined;
}

/**
 * A panel over the tab: a part of a document, or bytes with no parent at all.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FragmentState
 */
export interface FragmentState {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FragmentState.pane */
  readonly pane: PaneState;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FragmentState.surface */
  readonly surface: SurfaceState;
}

/**
 * An untitled document: its content as the workspace keeps it, the name it showed, and whether it
 * held work nobody had saved.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#UntitledStamp
 */
export interface UntitledStamp {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#UntitledStamp.content */
  readonly content: KeptContent;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#UntitledStamp.name */
  readonly name?: string | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#UntitledStamp.size */
  readonly size: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#UntitledStamp.dirty */
  readonly dirty: boolean;
}

/**
 * A file and what it was like: enough to reach it again and to tell whether it is still the file
 * the rest of the pane's state was measured on.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp
 * @upstream-differs a page knows a file by name, size and date, by the handle it was given in
 * Chromium and by its path only in the shell
 */
export interface FileStamp {
  readonly name: string;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp.path */
  readonly path?: string | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp.relativePath */
  readonly relativePath?: string | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp.size */
  readonly size: number;
  /**
   * The modification time, milliseconds.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp.modified
   */
  readonly modified: number;
  /** The key of the handle kept beside the workspace, where the browser gave one. */
  readonly handle?: string | undefined;
  /**
   * The file's SHA-256, hex — written down only when something is laid over the file at restore
   * (`PaneState.kept`), and then what decides whether it is still the file: a copy or a `touch`
   * moves the date, not the bytes.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp.sha256
   */
  readonly sha256?: string | undefined;
}

/**
 * Whether `current` is the same file content as far as size and modification date tell. A file
 * rewritten with the same bytes reads as changed; a restore that drops a little state for it errs
 * the safe way.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp.isUnchanged
 */
export function stampIsUnchanged(
  was: Pick<FileStamp, "size" | "modified">,
  now: Pick<FileStamp, "size" | "modified">
): boolean {
  return was.size === now.size && Math.abs(was.modified - now.modified) < 1000;
}

/**
 * `path` relative to `folder`, climbing out of it with `..` where it has to; nothing for a file
 * sharing no folder with it but the root, where a relative path would say nothing a move keeps.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FileStamp.relativePath
 */
export function relativePathOf(path: string, folder: string): string | undefined {
  const parts = (one: string) => one.split(/[\\/]+/).filter((part) => part.length > 0);
  const target = parts(path);
  const base = parts(folder);
  let common = 0;
  while (common < Math.min(target.length, base.length) && target[common] === base[common]) {
    common += 1;
  }
  // Sharing only the root is no relation worth keeping.
  if (common < 1) return undefined;
  return [...Array(base.length - common).fill(".."), ...target.slice(common)].join("/");
}

/**
 * A file cut into pieces: its size when it was cut, and every piece in file order.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#SegmentationState
 */
export interface SegmentationState {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#SegmentationState.contentSize */
  readonly contentSize: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#SegmentationState.pieces */
  readonly pieces: readonly PieceState[];
}

/** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PieceState */
export interface PieceState {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PieceState.start */
  readonly start: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PieceState.name */
  readonly name: string;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PieceState.link */
  readonly link?: PieceLinkState | undefined;
}

/**
 * A piece's link to its source file: the file, and the stretch of it the piece stands for.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PieceLinkState
 * @upstream-differs the file as a stamp, a page having no path for it outside the shell
 */
export interface PieceLinkState {
  readonly file: FileStamp;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PieceLinkState.sourceStart */
  readonly sourceStart: number;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PieceLinkState.sourceEnd */
  readonly sourceEnd: number;
}

/**
 * What sits around the panes: the minimap, the find bar and the tool panel.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#SurfaceState
 */
export interface SurfaceState {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#SurfaceState.minimapVisible */
  readonly minimapVisible: boolean;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#SurfaceState.minimapMode */
  readonly minimapMode?: string | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#SurfaceState.findPattern */
  readonly findPattern?: FindPatternState | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#SurfaceState.tool */
  readonly tool?: ToolState | undefined;
}

/**
 * The tool panel: which tool-module, what it had chosen, and which pane it read.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#ToolState
 */
export interface ToolState {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#ToolState.identifier */
  readonly identifier: string;
  /**
   * What the session parked, as the tool-module encoded it; absent for one that keeps nothing.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#ToolState.state
   */
  readonly state?: string | undefined;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#ToolState.pane */
  readonly pane?: number | undefined;
}

/** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FindPatternState */
export interface FindPatternState {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FindPatternState.text */
  readonly text: string;
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#FindPatternState.encoding */
  readonly encoding: string;
}

/**
 * Nothing to bring back: no file in either pane, no panel, and the Annotations panel not up.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#Workspace.isEmpty
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#TabState.isEmpty
 */
export const workspaceIsEmpty = (workspace: Workspace): boolean =>
  workspace.tab.panes.every((pane) => pane === undefined) &&
  workspace.tab.fragments.length === 0 &&
  workspace.notes?.isUp !== true;

/**
 * What of a pane's saved state applies to the document as it is now. The position always comes
 * back; past the end of a file that got shorter, the caret, the selection and the first row on
 * screen move to the last address. What was measured on the old bytes — segments, a tool's choice —
 * comes back only if the file is still the file it was measured on.
 *
 * @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#PaneRestore
 */
export interface PaneRestore {
  /** @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#PaneRestore.selection */
  readonly selection: { readonly start: number; readonly end: number };
  /** @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#PaneRestore.topOffset */
  readonly topOffset: number;
  /** @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#PaneRestore.inputRegion */
  readonly inputRegion: InputRegion;
  /** @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#PaneRestore.insertMode */
  readonly insertMode: boolean;
  /** @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#PaneRestore.keepsMeasuredState */
  readonly keepsMeasuredState: boolean;
}

/** @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#PaneRestore.init */
export function paneRestore(saved: PaneState, size: number, unchanged: boolean): PaneRestore {
  // The last address, not the end: a caret on the end of a file is legal, but a file that shrank
  // under the reader is better shown at its last byte than past it.
  const last = size === 0 ? 0 : size - 1;
  const start = Math.min(saved.selectionStart, saved.selectionEnd);
  const end = Math.max(saved.selectionStart, saved.selectionEnd);
  let selection: { start: number; end: number };
  if (unchanged) {
    selection = { start: Math.min(start, size), end: Math.min(end, size) };
  } else {
    const clamped = Math.min(start, last);
    selection = { start: clamped, end: Math.max(clamped, Math.min(end, size)) };
  }
  return {
    selection,
    topOffset: Math.min(saved.topOffset, last),
    inputRegion: saved.inputRegion,
    insertMode: saved.insertMode,
    keepsMeasuredState: unchanged,
  };
}

/**
 * Whether these pieces still describe a document of `size` whose bytes are unchanged: the cuts were
 * made on these bytes and no others.
 *
 * @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#SegmentationState.applies
 */
export function segmentationApplies(
  segments: SegmentationState,
  size: number,
  unchanged: boolean
): boolean {
  const { pieces } = segments;
  const last = pieces.at(-1);
  return (
    unchanged &&
    segments.contentSize === size &&
    pieces[0]?.start === 0 &&
    pieces.every((piece, index) => index === 0 || (pieces[index - 1]?.start ?? 0) < piece.start) &&
    last !== undefined &&
    (last.start < size || size === 0)
  );
}

/**
 * Something a restore could not bring back as it was, for the one warning shown once everything
 * is open.
 *
 * @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#RestoreIssue
 * @upstream-differs `unreachable`: a file the browser gave no way back to
 */
export type RestoreIssue =
  /** The file is no longer where it was; its pane stays empty. */
  | { readonly kind: "missing"; readonly name: string }
  /** It opened, but changed since: its position was kept, its segments and tool state were not. */
  | { readonly kind: "changed"; readonly name: string }
  /** The browser gave no way back to it — Firefox, Safari, a file opened without its handle. */
  | { readonly kind: "unreachable"; readonly name: string }
  /**
   * Its handle is there, but the browser was not allowed to read it: the person refused, or the
   * browser keeps a refusal for it.
   *
   * @web-only a browser's permission on a file handle
   */
  | { readonly kind: "notAllowed"; readonly name: string }
  /**
   * Reached, but reading it failed for a reason of its own — a disk gone, a share unreachable.
   *
   * @web-only the reason the browser gave
   */
  | { readonly kind: "unreadable"; readonly name: string; readonly reason: string }
  /**
   * The changes kept for it could not be read — the kept files are damaged or missing: a file
   * opened as it is on disk, a document with no file was not opened.
   *
   * @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#RestoreIssue.unreadable
   */
  | { readonly kind: "keptUnreadable"; readonly name: string }
  /**
   * Its content came back, but not the steps to undo it: the log no longer held the way back.
   *
   * @upstream Packages/Workspace/Sources/Workspace/PaneRestore.swift#RestoreIssue.historyLost
   */
  | { readonly kind: "historyLost"; readonly name: string };

/**
 * The workspace with every kept content in it — a file's, an untitled document's, a part's, in a
 * pane or a panel — passed through `transform`: what fills in a content's base and log once they
 * are written.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#Workspace.updatingKept
 */
export function updatingKept(
  workspace: Workspace,
  transform: (content: KeptContent) => KeptContent
): Workspace {
  const pane = (state: PaneState): PaneState => {
    const kept = state.kept === undefined ? {} : { kept: transform(state.kept) };
    const document = state.document;
    switch (document.kind) {
      case "file":
        return { ...state, ...kept };
      case "untitled":
        return {
          ...state,
          ...kept,
          document: {
            kind: "untitled",
            untitled: { ...document.untitled, content: transform(document.untitled.content) },
          },
        };
      case "part": {
        const edits = document.part.edits;
        return {
          ...state,
          ...kept,
          document:
            edits === undefined
              ? document
              : {
                  kind: "part",
                  part: {
                    ...document.part,
                    edits: { ...edits, content: transform(edits.content) },
                  },
                },
        };
      }
    }
  };
  return {
    ...workspace,
    tab: {
      ...workspace.tab,
      panes: workspace.tab.panes.map((one) => (one === undefined ? undefined : pane(one))),
      fragments: workspace.tab.fragments.map((fragment) => ({
        ...fragment,
        pane: pane(fragment.pane),
      })),
    },
  };
}

/**
 * The workspace with the stamp of every file kept content is laid over passed through
 * `transform`: what fills in a hash made behind the snapshot.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#Workspace.updatingKeptFileStamps
 */
export function updatingKeptFileStamps(
  workspace: Workspace,
  transform: (stamp: FileStamp) => FileStamp
): Workspace {
  const pane = (state: PaneState): PaneState =>
    state.kept === undefined || state.document.kind !== "file"
      ? state
      : { ...state, document: { kind: "file", file: transform(state.document.file) } };
  return {
    ...workspace,
    tab: {
      ...workspace.tab,
      panes: workspace.tab.panes.map((one) => (one === undefined ? undefined : pane(one))),
      fragments: workspace.tab.fragments.map((fragment) => ({
        ...fragment,
        pane: pane(fragment.pane),
      })),
    },
  };
}
