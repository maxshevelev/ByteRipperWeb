import type { KeptFile, KeptFolder } from "@/core/workspace/keptFolder";

/**
 * The shell's disk as the session host reaches it from its worker (`Design/FILE_SESSIONS.md`, S7):
 * a port to the main process, which writes the kept content of the workspace under the profile and
 * of the open project in its folder (`desktop/hostDisk.cjs`). A worker has no preload, so the port
 * came through a window, and outlives it. Every window hands one; the newest is used, and one that
 * stops answering is let go for the next.
 *
 * @web-only upstream's app writes its own files
 */
export class ShellDisk {
  private readonly ports: MessagePort[] = [];
  private readonly waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private next = 0;

  /** Whether any window has handed a port: whether this host runs in the shell at all. */
  get available(): boolean {
    return this.ports.length > 0;
  }

  /** Takes a port a window handed over. */
  add(port: MessagePort): void {
    port.onmessage = (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
      const { id, value, error } = event.data;
      const one = this.waiting.get(id);
      this.waiting.delete(id);
      if (error === undefined) one?.resolve(value);
      else one?.reject(new Error(error));
    };
    port.start();
    this.ports.push(port);
  }

  ask(request: Record<string, unknown>): Promise<unknown> {
    const port = this.ports.at(-1);
    if (port === undefined) return Promise.reject(new Error("No shell to write to."));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      // A write's bytes are copied rather than transferred: the journal keeps them until the write
      // has landed, and answers reads from them meanwhile.
      port.postMessage({ id, ...request });
    });
  }
}

/** A folder the main process keeps, as a host names it. @web-only see {@link ShellDisk} */
export type ShellFolderRef =
  | { readonly kind: "session"; readonly workspace: string }
  | { readonly kind: "project"; readonly project: string };

/**
 * A kept folder the shell writes: the workspace's of a window, under the profile, or the open
 * project's `Kept/`.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.keptFolder
 * @upstream-differs written by the main process for a host in a worker
 */
export class ShellKeptFolder implements KeptFolder {
  readonly id: string;
  private readonly disk: ShellDisk;
  private readonly folder: ShellFolderRef;

  constructor(disk: ShellDisk, folder: ShellFolderRef) {
    this.disk = disk;
    this.folder = folder;
    this.id =
      folder.kind === "session"
        ? `shell:session:${folder.workspace}`
        : `shell:project:${folder.project}`;
  }

  file(name: string): KeptFile {
    const ask = (request: Record<string, unknown>) =>
      this.disk.ask({ folder: this.folder, name, ...request });
    return {
      write: async (at, bytes) => {
        await ask({ op: "write", at, bytes });
      },
      read: async (at, count) =>
        ((await ask({ op: "read", at, count })) as Uint8Array | undefined) ?? new Uint8Array(0),
      truncate: async (length) => {
        await ask({ op: "truncate", at: length });
      },
      synchronize: async () => {
        await ask({ op: "sync" });
      },
      size: async () => (await ask({ op: "size" })) as number | undefined,
      close: () => undefined,
    };
  }

  async removeExcept(names: ReadonlySet<string>): Promise<void> {
    await this.disk.ask({ folder: this.folder, op: "removeExcept", names: [...names] });
  }

  /** The whole folder: the window's workspace was discarded. */
  async remove(): Promise<void> {
    await this.disk.ask({ folder: this.folder, op: "remove" });
  }
}
