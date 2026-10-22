import type { SessionView } from "@/core/session/sessionView";
import type { KeptContent, KeptJoin, Workspace } from "@/core/workspace/workspace";
import type { OpenedFile } from "@/platform/files/openedFile";
import type { HeldVersion, KeptFolderRef } from "@/state/sessions/keeperOperations";
import { operateHost } from "@/state/sessions/pageSessions";

/**
 * A window's side of the keeper of one folder, which lives in the session host
 * (`Design/FILE_SESSIONS.md`, S6): it names the folder and the sessions, the host does the rest.
 * It answers to the names `ContentKeeper` does, so the recorder and the restore read as they did.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper
 * @upstream-differs the keeper is the host's; a window asks it by the folder's name
 */
export class KeptContentClient {
  readonly folder: KeptFolderRef;
  /** What the last snapshot found written, by session: what leaving would not cost. */
  private held = new Map<string, HeldVersion>();
  private written = false;

  constructor(folder: KeptFolderRef) {
    this.folder = folder;
  }

  /** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.beginSnapshot */
  async beginSnapshot(): Promise<void> {
    await operateHost("keeper.begin", { folder: this.folder });
  }

  /** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.keep */
  async keep(pane: {
    readonly view: SessionView;
    readonly isUntitled: boolean;
    readonly joins: { readonly undo: readonly KeptJoin[]; readonly redo: readonly KeptJoin[] };
  }): Promise<KeptContent | undefined> {
    return (await operateHost("keeper.keep", {
      folder: this.folder,
      pane: { session: pane.view.id, isUntitled: pane.isUntitled, joins: pane.joins },
    })) as KeptContent | undefined;
  }

  async hasPending(): Promise<boolean> {
    return (await operateHost("keeper.hasPending", { folder: this.folder })) === true;
  }

  /** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.fileHash */
  async fileHash(
    file: Pick<OpenedFile, "path" | "source" | "size" | "lastModified" | "name">
  ): Promise<string | undefined> {
    const { path, source, size, lastModified, name } = file;
    return (await operateHost("keeper.fileHash", {
      folder: this.folder,
      file: { ...(path === undefined ? {} : { path }), source, size, lastModified, name },
    })) as string | undefined;
  }

  /**
   * The snapshot is taken: the host writes the kept files, this window writes its record of them
   * through `record`, and then what no record names goes.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.commit
   */
  async commit(
    workspace: Workspace,
    record: (filled: Workspace) => Promise<void>,
    sessions: readonly SessionView[]
  ): Promise<void> {
    const { ticket, filled } = (await operateHost("keeper.commit", {
      folder: this.folder,
      workspace,
    })) as { ticket: number; filled?: Workspace };
    if (filled === undefined) {
      this.written = false;
      return;
    }
    let ok = true;
    try {
      await record(filled);
    } catch (error) {
      ok = false;
      throw error;
    } finally {
      const held = (await operateHost("keeper.recorded", {
        folder: this.folder,
        ticket,
        ok,
        sessions: sessions.map((view) => view.id),
      })) as HeldVersion[];
      this.held = new Map(held.map((one) => [one.session, one]));
      this.written = ok;
    }
  }

  /**
   * Whether the last snapshot written holds `view`'s session as it is now — its history where it
   * was when written — so leaving need not ask about it.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.holdsCurrentBytes
   */
  holdsCurrentBytes(view: SessionView): boolean {
    const held = this.held.get(view.id);
    const now = view.historyVersion;
    return (
      this.written && held !== undefined && held.epoch === now.epoch && held.serial === now.serial
    );
  }

  /** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.bytes */
  async bytesOf(content: KeptContent): Promise<Uint8Array> {
    return (await operateHost("keeper.bytesOf", { folder: this.folder, content })) as Uint8Array;
  }

  /** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.apply */
  async apply(view: SessionView, content: KeptContent): Promise<void> {
    await view.operate("keeper.apply", { folder: this.folder, content });
  }

  /** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.adopt */
  async adopt(
    view: SessionView,
    content: KeptContent,
    name: string,
    dirty: boolean
  ): Promise<{ readonly joins: readonly KeptJoin[]; readonly undoneJoins: readonly KeptJoin[] }> {
    return (await view.operate("keeper.adopt", {
      folder: this.folder,
      content,
      name,
      dirty,
    })) as { readonly joins: readonly KeptJoin[]; readonly undoneJoins: readonly KeptJoin[] };
  }

  async forgetReadBacks(): Promise<void> {
    await operateHost("keeper.forgetReadBacks", { folder: this.folder });
  }

  /** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.takeHistoriesLost */
  async takeHistoriesLost(): Promise<string[]> {
    return (await operateHost("keeper.takeHistoriesLost", { folder: this.folder })) as string[];
  }

  /** The host lets go of this folder's keeper: the window records into another. */
  async forget(): Promise<void> {
    await operateHost("keeper.forget", { folder: this.folder });
  }
}
