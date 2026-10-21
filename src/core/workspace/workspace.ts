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
export const WORKSPACE_VERSION = 1;

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
   * The unsaved changes of a file, kept beside the workspace under this name.
   *
   * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.edits
   */
  readonly edits?: string | undefined;
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
 * An untitled document: the key of its bytes beside the workspace, the name it showed, and
 * whether it held work nobody had saved.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#UntitledStamp
 */
export interface UntitledStamp {
  /** @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#UntitledStamp.id */
  readonly id: string;
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
  | { readonly kind: "unreadable"; readonly name: string; readonly reason: string };
