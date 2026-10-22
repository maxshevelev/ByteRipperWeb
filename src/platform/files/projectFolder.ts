import type { OverlayEdits, OverlayRun } from "@/core/storage/editOverlayStorage";
import { WORKSPACE_VERSION, type Workspace } from "@/core/workspace/workspace";

/**
 * A project's folder as the page reaches it: a directory handle, from `showDirectoryPicker` — in
 * a Chromium browser and in the desktop shell alike (`Design/WORKSPACE.md`, "Projects").
 *
 * `Job.brw/` holds `Project.json`, the workspace value, and beside it only while there are any the
 * bytes nothing else on disk has: `Untitled/<id>.bin`, the content of a document never saved, and
 * `Edits/<id>.bin`, the unsaved changes of a file, as runs over it.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.project
 * @upstream-differs a folder the person picked rather than a package the Finder shows as one file
 */
export class ProjectFolder {
  /** What was last written or read, so an identical snapshot is not written again. */
  private lastWritten: string | undefined;

  readonly directory: FileSystemDirectoryHandle;

  constructor(directory: FileSystemDirectoryHandle) {
    this.directory = directory;
  }

  /**
   * The workspace file inside.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.fileName
   */
  static readonly fileName = "Project.json";

  /** The project's name: its folder's, without `.brw`. */
  get name(): string {
    return projectName(this.directory.name);
  }

  /**
   * The workspace written last, or nothing when there is none, it does not read, or it is of
   * another version.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.read
   */
  async read(): Promise<Workspace | undefined> {
    try {
      const file = await (await this.directory.getFileHandle(ProjectFolder.fileName)).getFile();
      const text = await file.text();
      const workspace = JSON.parse(text) as Workspace;
      if (workspace.version !== WORKSPACE_VERSION || workspace.tab === undefined) return undefined;
      this.lastWritten = text;
      return workspace;
    } catch {
      return undefined;
    }
  }

  /**
   * Writes `workspace` unless it is what the file already holds. Indented: the file is small, and
   * a person reading it after a restore went wrong should be able to. Answers whether anything
   * was written; a write that fails throws.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.write
   */
  async write(workspace: Workspace): Promise<boolean> {
    const text = JSON.stringify(workspace, undefined, 2);
    if (text === this.lastWritten) return false;
    await writeFile(this.directory, ProjectFolder.fileName, text);
    this.lastWritten = text;
    return true;
  }

  /** Whether the folder holds a project's workspace file. */
  async holdsProject(): Promise<boolean> {
    return (await entryNames(this.directory)).has(ProjectFolder.fileName);
  }

  /**
   * Keeps `value` under `id`: a Blob is an untitled document's content, anything else a file's
   * unsaved changes.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.writeUntitled
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.writeEdits
   * @upstream-differs a file's changes are a header of runs and the added bytes after it, where
   * upstream writes a binary property list
   */
  async writeKept(id: string, value: unknown): Promise<void> {
    if (value instanceof Blob) {
      await writeFile(await this.subfolder(UNTITLED, true), `${id}.bin`, value);
    } else {
      await writeFile(
        await this.subfolder(EDITS, true),
        `${id}.bin`,
        encodeEdits(value as OverlayEdits)
      );
    }
  }

  /**
   * What is kept under `id`: the bytes of an untitled document as a Blob, or a file's changes.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.readUntitled
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.readEdits
   */
  async readKept<T>(id: string): Promise<T | undefined> {
    const untitled = await this.readFile(UNTITLED, `${id}.bin`);
    if (untitled !== undefined) return untitled as T;
    const edits = await this.readFile(EDITS, `${id}.bin`);
    if (edits === undefined) return undefined;
    return decodeEdits(new Uint8Array(await edits.arrayBuffer())) as T | undefined;
  }

  /**
   * Deletes what is kept of every document `ids` does not name: one saved, discarded or closed
   * takes its copy with it.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.removeUntitled
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.removeEdits
   */
  async removeKeptExcept(ids: ReadonlySet<string>): Promise<void> {
    for (const name of [UNTITLED, EDITS]) {
      const folder = await this.subfolder(name, false);
      if (folder === undefined) continue;
      for (const entry of await entryNames(folder)) {
        if (!ids.has(entry.replace(/\.bin$/, ""))) {
          await folder.removeEntry(entry).catch(() => undefined);
        }
      }
    }
  }

  /**
   * Empties the folder of a project, for one written over it: Save as Project… onto a project
   * that was there.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.remove
   */
  async clear(): Promise<void> {
    for (const name of [ProjectFolder.fileName, UNTITLED, EDITS]) {
      await this.directory.removeEntry(name, { recursive: true }).catch(() => undefined);
    }
    this.lastWritten = undefined;
  }

  private async subfolder(name: string, create: true): Promise<FileSystemDirectoryHandle>;
  private async subfolder(
    name: string,
    create: false
  ): Promise<FileSystemDirectoryHandle | undefined>;
  private async subfolder(name: string, create: boolean) {
    try {
      return await this.directory.getDirectoryHandle(name, { create });
    } catch (error) {
      if (create) throw error;
      return undefined;
    }
  }

  private async readFile(folder: string, name: string): Promise<File | undefined> {
    try {
      const directory = await this.directory.getDirectoryHandle(folder);
      return await (await directory.getFileHandle(name)).getFile();
    } catch {
      return undefined;
    }
  }
}

/** @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.untitledFolder */
const UNTITLED = "Untitled";
/** @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.editsFolder */
const EDITS = "Edits";

/**
 * A project's name from its folder's: without the extension.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.currentProjectName
 * @upstream-differs `.brw`, not `.brp`: the two keep different workspaces (one window here, windows
 * of tabs there), so neither may take the other's folder for its own
 */
export const projectName = (folder: string): string => folder.replace(/\.brw$/i, "");

/**
 * Whether a folder's name says it is a project.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#URL.isByteRipperProject
 * @upstream-differs `.brw`, as `projectName`
 */
export const isProjectFolderName = (name: string): boolean => /\.brw$/i.test(name);

async function entryNames(directory: FileSystemDirectoryHandle): Promise<Set<string>> {
  const names = new Set<string>();
  // `keys()` is in every browser that has directory handles, but not yet in TypeScript's DOM types.
  const entries = (directory as unknown as { keys(): AsyncIterable<string> }).keys();
  for await (const name of entries) names.add(name);
  return names;
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string | Uint8Array
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data as FileSystemWriteChunkType);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

/**
 * A file's changes as they are written: the length of a JSON header, the header — the size of the
 * file and the runs over it — and the bytes editing added.
 */
export function encodeEdits(edits: OverlayEdits): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({ baseSize: edits.baseSize, runs: edits.runs })
  );
  const out = new Uint8Array(4 + header.length + edits.added.length);
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  out.set(edits.added, 4 + header.length);
  return out;
}

/** The changes `encodeEdits` wrote, or nothing for bytes that are not such a record. */
export function decodeEdits(bytes: Uint8Array): OverlayEdits | undefined {
  if (bytes.length < 4) return undefined;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(0, true);
  if (4 + length > bytes.length) return undefined;
  try {
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as {
      baseSize?: unknown;
      runs?: unknown;
    };
    if (typeof header.baseSize !== "number" || !Array.isArray(header.runs)) return undefined;
    return {
      baseSize: header.baseSize,
      runs: header.runs as OverlayRun[],
      added: bytes.slice(4 + length),
    };
  } catch {
    return undefined;
  }
}
