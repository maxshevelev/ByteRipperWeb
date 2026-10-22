import type { JournalStore } from "@/core/edit/undoJournal";

/**
 * Where a workspace keeps its documents' content: `Kept/`, a folder of bases and logs, each under
 * a name a `KeptContent` gives it (`Design/PORT_WINDOW_07A3928_21A2889.md`, P6).
 *
 * The session's is a folder of the origin-private file system per workspace; a project's is
 * `Kept/` in its folder, written by the shell. `src/core` reaches neither, so the keeper is handed
 * one.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.keptFolder
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.keptURL
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.prepareKeptFolder
 * @upstream-differs a folder the page reaches through a store, never by path
 */
export interface KeptFolder {
  /** What tells this folder from another: a journal placed in one is not in the other. */
  readonly id: string;
  /** The kept file `name`: a log appended to, or a base written once. */
  file(name: string): KeptFile;
  /**
   * Deletes every kept file `names` does not name: what a written workspace no longer reads.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.removeKept
   */
  removeExcept(names: ReadonlySet<string>): Promise<void>;
}

/** A kept file, written and read where it is told. */
export interface KeptFile extends JournalStore {
  /** Cuts the file back to `length`, as a manifest pinned it. */
  truncate(length: number): Promise<void>;
  /** Puts what was written on the disk, before a manifest names it. */
  synchronize(): Promise<void>;
  /** How long the file is; nothing when there is none. */
  size(): Promise<number | undefined>;
}

/** The whole of a kept file, read a slice at a time; nothing when there is none. */
export async function readWholeKeptFile(file: KeptFile): Promise<Uint8Array | undefined> {
  const size = await file.size();
  if (size === undefined) return undefined;
  const bytes = new Uint8Array(size);
  const slice = 8 << 20;
  for (let at = 0; at < size; at += slice) {
    bytes.set(await file.read(at, Math.min(slice, size - at)), at);
  }
  return bytes;
}
