import type { OverlayEdits, OverlayRun } from "@/core/storage/editOverlayStorage";
import type { Workspace } from "@/core/workspace/workspace";

/**
 * The open project's folder as a window's page reaches it: through the desktop shell, which keeps
 * the folder of the one project the app has open and writes it by path
 * (`Design/DESKTOP_WINDOWS.md`, D3). The page records its window's workspace into it and keeps the
 * bytes nothing else on disk has under keys of its own — an untitled document's content, a file's
 * unsaved changes — and never names a path.
 *
 * `Job.brw/` holds `Project.json`, every window front to back, and beside it only while there are
 * any `Untitled/<key>.bin` and `Edits/<key>.bin` (`desktop/projects.cjs`).
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.project
 * @upstream-differs the shell's main process writes the folder; a page has no path to write by
 */
export class ProjectFolder {
  /** What this window last recorded, so an identical snapshot is not sent again. */
  private lastWritten: string | undefined;

  readonly name: string;
  private readonly bridge: ProjectBridge;

  constructor(name: string, bridge: ProjectBridge) {
    this.name = name;
    this.bridge = bridge;
  }

  /**
   * Records this window's `workspace` into the project unless it is what was recorded last.
   * Answers whether anything was sent; one that fails throws.
   *
   * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.write
   */
  async write(workspace: Workspace): Promise<boolean> {
    const text = JSON.stringify(workspace);
    if (text === this.lastWritten) return false;
    await this.bridge.record(workspace);
    this.lastWritten = text;
    return true;
  }

  /**
   * Keeps `value` under `key`: a Blob is an untitled document's content, anything else a file's
   * unsaved changes.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper
   * @upstream-differs a file's changes are a header of runs and the added bytes after it, where
   * upstream writes a base and a log
   */
  async writeKept(key: string, value: unknown): Promise<void> {
    if (value instanceof Blob) {
      await this.bridge.writeKept(key, "untitled", new Uint8Array(await value.arrayBuffer()));
    } else {
      await this.bridge.writeKept(key, "edits", encodeEdits(value as OverlayEdits));
    }
  }

  /** What is kept under `key`: an untitled document's bytes as a Blob, or a file's changes. */
  async readKept<T>(key: string): Promise<T | undefined> {
    const kept = await this.bridge.readKept(key).catch(() => undefined);
    if (kept === undefined || kept === null) return undefined;
    if (kept.kind === "untitled") return new Blob([kept.bytes.slice()]) as T;
    return decodeEdits(kept.bytes) as T | undefined;
  }

  /**
   * Says which keys this window keeps bytes under: what no window of the project names any more,
   * the shell deletes.
   */
  async removeKeptExcept(keys: ReadonlySet<string>): Promise<void> {
    await this.bridge.keeps([...keys]);
  }
}

/** The shell's half of a project, as its preload script exposes it. */
export interface ProjectBridge {
  record(workspace: Workspace): Promise<void>;
  keeps(keys: readonly string[]): Promise<void>;
  writeKept(key: string, kind: "untitled" | "edits", bytes: Uint8Array): Promise<void>;
  readKept(
    key: string
  ): Promise<{ readonly kind: "untitled" | "edits"; readonly bytes: Uint8Array } | undefined>;
}

/**
 * A project's name from its folder's: without the extension.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.currentProjectName
 * @upstream-differs `.brw`, not `.brp`: the two keep different workspaces (windows of one tab here,
 * windows of tabs there), so neither may take the other's folder for its own
 */
export const projectName = (folder: string): string => folder.replace(/\.brw$/i, "");

/**
 * Whether a folder's name says it is a project.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#URL.isByteRipperProject
 * @upstream-differs `.brw`, as `projectName`
 */
export const isProjectFolderName = (name: string): boolean => /\.brw$/i.test(name);

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
