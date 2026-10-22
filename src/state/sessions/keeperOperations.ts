import type { SessionHost, SessionParts } from "@/core/session/sessionHost";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import type { KeptFolder } from "@/core/workspace/keptFolder";
import type { KeptContent, KeptJoin, Workspace } from "@/core/workspace/workspace";
import type { OpenedFile } from "@/platform/files/openedFile";
import { ContentKeeper, type KeptPane } from "@/state/workspace/contentKeeper";

/**
 * Where kept content is written, as a window names it to the host: the workspace's own folder, or
 * an open project's `Kept/`.
 *
 * @web-only a window names a folder; the host holds the keeper of it
 */
export type KeptFolderRef =
  | { readonly kind: "session"; readonly workspace: string }
  | { readonly kind: "project"; readonly project: string };

/**
 * The state of a document's history a snapshot found written: a window asks it of a session to
 * know, as it goes, whether leaving would cost what the session holds.
 *
 * @web-only see {@link KeptFolderRef}
 */
export interface HeldVersion {
  readonly session: string;
  readonly epoch: number;
  readonly serial: number;
}

/** A pane as the keeper is to take it: its session, and what only the window knows of it. */
export interface KeptPaneArgs {
  readonly session: string;
  readonly isUntitled: boolean;
  readonly joins: { readonly undo: readonly KeptJoin[]; readonly redo: readonly KeptJoin[] };
}

/**
 * The keepers of kept content live in the session host (`Design/FILE_SESSIONS.md`, S6): a
 * document's content is the session's, so what writes it down is beside the session, whatever
 * window shows it. A window takes a snapshot of its panes by asking for each one, and writes its
 * own record of them between the kept files going down and the ones it no longer names going.
 *
 * @web-only upstream's keeper is the app's, beside its windows
 */
export function installKeeperOperations(
  host: SessionHost,
  folderOf: (ref: KeptFolderRef) => KeptFolder | undefined
): void {
  const keepers = new Map<string, ContentKeeper>();
  const keeperOf = (ref: KeptFolderRef): ContentKeeper => {
    const key = ref.kind === "session" ? `session:${ref.workspace}` : `project:${ref.project}`;
    let keeper = keepers.get(key);
    if (keeper === undefined) {
      const folder = folderOf(ref);
      if (folder === undefined) throw new Error("That folder cannot be kept in here.");
      keeper = new ContentKeeper(folder);
      keepers.set(key, keeper);
    }
    return keeper;
  };
  const sessionOf = (id: string): SessionParts => {
    const session = host.session(id);
    if (session === undefined) throw new Error(`Session ${id} is not open.`);
    return session;
  };
  const paneOf = (args: KeptPaneArgs): KeptPane => {
    const { document } = sessionOf(args.session);
    return {
      document,
      isUntitled: args.isUntitled,
      exportKeptEdits: async () => {
        const storage = document.storage;
        return !args.isUntitled && document.isDirty && storage instanceof EditOverlayStorage
          ? storage.exportEdits()
          : undefined;
      },
      joins: () => args.joins,
    };
  };
  /** The commits waiting for their window to write its record, by the ticket it was handed. */
  const waiting = new Map<
    number,
    { readonly recorded: (ok: boolean) => void; readonly done: Promise<void> }
  >();
  let tickets = 0;

  const define = <A>(name: string, operation: (args: A) => unknown) =>
    host.defineHostOperation(name, (args) => operation(args as A));

  define<{ folder: KeptFolderRef }>("keeper.forget", ({ folder }) => {
    keepers.delete(
      folder.kind === "session" ? `session:${folder.workspace}` : `project:${folder.project}`
    );
  });
  define<{ folder: KeptFolderRef }>("keeper.begin", ({ folder }) =>
    keeperOf(folder).beginSnapshot()
  );
  define<{ folder: KeptFolderRef; pane: KeptPaneArgs }>(
    "keeper.keep",
    ({ folder, pane }): Promise<KeptContent | undefined> => keeperOf(folder).keep(paneOf(pane))
  );
  define<{ folder: KeptFolderRef }>(
    "keeper.hasPending",
    ({ folder }) => keeperOf(folder).hasPending
  );
  define<{
    folder: KeptFolderRef;
    file: Pick<OpenedFile, "path" | "source" | "size" | "lastModified" | "name">;
  }>("keeper.fileHash", ({ folder, file }) => keeperOf(folder).fileHash(file));

  /**
   * Hands the snapshot to the writer. Answers once the kept files are down, with the workspace
   * their hashes filled in, for the window to write as its record — or with nothing, when a write
   * failed and the record that stands must stay. The removal of what no record names waits for
   * `keeper.recorded`.
   */
  define<{ folder: KeptFolderRef; workspace: Workspace }>(
    "keeper.commit",
    ({ folder, workspace }) =>
      new Promise<{ readonly ticket: number; readonly filled?: Workspace }>((answer, fail) => {
        const ticket = ++tickets;
        let answered = false;
        const done = keeperOf(folder)
          .commit(
            workspace,
            (filled) =>
              new Promise<void>((recorded, notRecorded) => {
                answered = true;
                waiting.set(ticket, {
                  recorded: (ok) => (ok ? recorded() : notRecorded(new Error("Not recorded."))),
                  done,
                });
                answer({ ticket, filled });
              })
          )
          .then(
            () => {
              if (!answered) answer({ ticket });
            },
            (error: unknown) => {
              if (!answered) fail(error);
            }
          );
      })
  );

  /** The window wrote its record, or could not: the commit finishes, and says what it holds. */
  define<{ folder: KeptFolderRef; ticket: number; ok: boolean; sessions: readonly string[] }>(
    "keeper.recorded",
    async ({ folder, ticket, ok, sessions }): Promise<HeldVersion[]> => {
      const held = waiting.get(ticket);
      waiting.delete(ticket);
      held?.recorded(ok);
      await held?.done.catch(() => undefined);
      const keeper = keeperOf(folder);
      const versions: HeldVersion[] = [];
      for (const id of sessions) {
        const document = host.session(id)?.document;
        if (document === undefined || !keeper.holdsCurrentBytes(document)) continue;
        const { epoch, serial } = document.undoHistory.version;
        versions.push({ session: id, epoch, serial });
      }
      return versions;
    }
  );

  define<{ folder: KeptFolderRef; content: KeptContent }>("keeper.bytesOf", ({ folder, content }) =>
    keeperOf(folder).bytesOf(content)
  );
  define<{ folder: KeptFolderRef }>("keeper.forgetReadBacks", ({ folder }) =>
    keeperOf(folder).forgetReadBacks()
  );
  define<{ folder: KeptFolderRef }>("keeper.takeHistoriesLost", ({ folder }) =>
    keeperOf(folder).takeHistoriesLost()
  );

  // In the session's turn: these change its document.
  host.defineSessionOperation("keeper.apply", async (session, args) => {
    const { folder, content } = args as { folder: KeptFolderRef; content: KeptContent };
    const storage = session.document.storage;
    if (!(storage instanceof EditOverlayStorage)) throw new Error("No overlay to lay it on.");
    await keeperOf(folder).apply(content, storage);
    session.document.contentReplaced();
  });
  host.defineSessionOperation("keeper.adopt", (session, args) => {
    const { folder, content, name, dirty } = args as {
      folder: KeptFolderRef;
      content: KeptContent;
      name: string;
      dirty: boolean;
    };
    return keeperOf(folder).adopt(session.document, content, name, dirty);
  });
}
