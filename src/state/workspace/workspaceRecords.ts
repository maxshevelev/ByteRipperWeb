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
}

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
