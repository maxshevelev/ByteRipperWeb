/// <reference lib="webworker" />
import { setJournalStoreProvider } from "@/core/edit/undoJournal";
import type { HostMessage, ViewMessage } from "@/core/session/sessionProtocol";
import { OpfsRecordJournalStore } from "@/platform/files/opfsRecordJournalStore";
import { OpfsScratchStore } from "@/platform/files/opfsScratchStore";
import { portLine } from "@/platform/sessions/portLine";
import { ShellDisk, ShellKeptFolder } from "@/platform/sessions/shellDisk";
import { makeSessionHost } from "@/state/sessions/hostSetup";

/**
 * The session host (`Design/FILE_SESSIONS.md`, S7): one `SharedWorker` for every window of the
 * app — the shell's windows, a browser's tabs — holding every file session, so a session is the
 * same object whichever window shows it, and a pane moved between windows is a view moved, not a
 * document rebuilt.
 *
 * Its undo journals are kept a write per file in the origin-private file system, where a
 * `SharedWorker` can write; in the shell its kept content is written by the main process, through
 * a port a window hands over.
 */
declare const self: SharedWorkerGlobalScope;

const disk = new ShellDisk();
if (OpfsScratchStore.isAvailable()) setJournalStoreProvider(() => new OpfsRecordJournalStore());

const host = makeSessionHost({
  folderOf: (ref) => (disk.available ? new ShellKeptFolder(disk, ref) : undefined),
  removeAllKept: async (except) => {
    if (disk.available)
      await disk.ask({ folder: { kind: "session", workspace: "all" }, op: "removeAll", except });
  },
});

self.onconnect = (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  const line = portLine<HostMessage, ViewMessage>(port);
  let disconnect: (() => void) | undefined;
  // A window says two things on its own line besides its sessions: the shell's port, and the Web
  // Lock it holds while it lives — a port says nothing when its page goes, so the host waits on
  // the lock, and when it is let go the window is gone and so are the sessions only it showed.
  const listen = line.listen.bind(line);
  line.listen = (receive) =>
    listen((message) => {
      const raw = message as unknown as { kind?: string; port?: MessagePort; lock?: string };
      if (raw.kind === "shellPort") {
        if (raw.port !== undefined) disk.add(raw.port);
        return;
      }
      if (raw.kind === "alive" && typeof raw.lock === "string") {
        void navigator.locks.request(raw.lock, async () => {
          disconnect?.();
          host.closeUnshown();
        });
        return;
      }
      receive(message);
    });
  disconnect = host.connect(line);
};
