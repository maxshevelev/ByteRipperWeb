import type { Workspace } from "@/core/workspace/workspace";
import { openKeyValueStore } from "@/platform/storage/keyValueStore";

/**
 * Where the workspaces are kept: one record per workspace id, in this browser's IndexedDB — what
 * upstream's `Workspace/` folder in Application Support is (`Design/WORKSPACE.md`).
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder
 * @upstream-differs a record per tab's workspace in IndexedDB, with the files' handles in it
 */

/** One workspace as it is kept. */
export interface WorkspaceRecord {
  readonly workspace: Workspace;
  /**
   * When its tab was last seen: what "the workspace most recently left" sorts by.
   *
   * @web-only a tab has no quit; a fresh tab takes up the newest workspace no tab holds
   */
  readonly leftAt: number;
  /** The handles of its files, by the key its `FileStamp.handle` names. */
  readonly handles: Readonly<Record<string, FileSystemFileHandle>>;
  /**
   * The project the tab had open, by the id this browser knows it by: what a reload opens again.
   *
   * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.lastProject
   * @upstream-differs per tab, as the workspace is, where upstream has one for the app
   */
  readonly project?: string | undefined;
}

/** Where a restore reads the bytes a workspace keeps beside itself: the tab's, or a project's. */
export type KeptReader = <T>(key: string) => Promise<T | undefined>;

/** A record not seen for this long goes, as the bookmarks' do. */
export const WORKSPACE_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const records = openKeyValueStore("byteripper-workspaces");

/** @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.read */
export async function readWorkspaceRecord(id: string): Promise<WorkspaceRecord | undefined> {
  return records.get<WorkspaceRecord>(id).catch(() => undefined);
}

/** @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.write */
export async function writeWorkspaceRecord(id: string, record: WorkspaceRecord): Promise<void> {
  await records.put(id, record).catch(() => undefined);
}

/** @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.remove */
export async function removeWorkspaceRecord(id: string): Promise<void> {
  await records.remove(id).catch(() => undefined);
}

/** Every record, by id; the stale ones are dropped on the way. */
export async function allWorkspaceRecords(
  now = Date.now()
): Promise<{ readonly id: string; readonly record: WorkspaceRecord }[]> {
  const all = await records.entries<WorkspaceRecord>().catch(() => []);
  const kept: { id: string; record: WorkspaceRecord }[] = [];
  for (const { key, value } of all) {
    if (now - value.leftAt > WORKSPACE_STALE_AFTER_MS) await removeWorkspaceRecord(key);
    else kept.push({ id: key, record: value });
  }
  return kept;
}

/** Forgets every workspace: the switch turned off, so none comes back months later. */
export async function removeAllWorkspaceRecords(): Promise<void> {
  for (const { key } of await records.entries().catch(() => [])) await removeWorkspaceRecord(key);
}

/**
 * The bytes a workspace keeps beside itself: an untitled document's content, as a Blob, and a
 * file's unsaved changes, as runs over it — each under `<workspace>/<key>`.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.untitledURL
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.editsURL
 */
const kept = openKeyValueStore("byteripper-workspace-bytes");

/** @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.writeUntitled */
export async function writeKeptBytes(
  workspace: string,
  key: string,
  value: unknown
): Promise<void> {
  await kept.put(`${workspace}/${key}`, value).catch(() => undefined);
}

/** @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.readUntitled */
export async function readKeptBytes<T>(workspace: string, key: string): Promise<T | undefined> {
  return kept.get<T>(`${workspace}/${key}`).catch(() => undefined);
}

/**
 * Drops what a workspace keeps of documents it no longer holds: a document closed takes its copy
 * with it.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.removeUntitled
 */
export async function removeKeptBytesExcept(
  workspace: string,
  keep: ReadonlySet<string>
): Promise<void> {
  const prefix = `${workspace}/`;
  for (const { key } of await kept.entries().catch(() => [])) {
    if (key.startsWith(prefix) && !keep.has(key.slice(prefix.length))) {
      await kept.remove(key).catch(() => undefined);
    }
  }
}

/** Forgets what every workspace kept beside itself. */
export async function removeAllKeptBytes(): Promise<void> {
  for (const { key } of await kept.entries().catch(() => [])) {
    await kept.remove(key).catch(() => undefined);
  }
}
