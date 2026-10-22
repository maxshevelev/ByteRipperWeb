import { afterEach, describe, expect, it, vi } from "vitest";

// A handle a test can make is an object of functions, which no port clones; the browser's own
// crosses to a worker as itself. The page's line to its host carries them here without cloning.
vi.stubGlobal(
  "MessageChannel",
  class {
    readonly port1: { onmessage?: (event: { data: unknown }) => void } & Record<string, unknown>;
    readonly port2: { onmessage?: (event: { data: unknown }) => void } & Record<string, unknown>;
    constructor() {
      const end = () => ({}) as { onmessage?: (event: { data: unknown }) => void };
      const one = end();
      const two = end();
      const to = (other: typeof one) => (data: unknown) =>
        setTimeout(() => other.onmessage?.({ data }));
      this.port1 = Object.assign(one, { postMessage: to(two), close: () => undefined });
      this.port2 = Object.assign(two, { postMessage: to(one), close: () => undefined });
    }
  }
);

const { openInPane, savePane, workspaceStore } = await import("@/state/workspaceStore");

/**
 * A save is the session's: the page asks where it goes, and the host writes the bytes and takes
 * the checkpoint that says they are saved in one turn of the session's requests
 * (`Design/FILE_SESSIONS.md`, S5).
 */

/** A file behind a handle, whose writable is published over it when it closes. */
function diskFile(name: string, bytes: number[]) {
  let content = Uint8Array.from(bytes);
  const handle = {
    kind: "file",
    name,
    queryPermission: async () => "granted",
    getFile: async () => new File([content.slice()], name),
    createWritable: async (options?: { keepExistingData?: boolean }) => {
      let swap = options?.keepExistingData === true ? content.slice() : new Uint8Array(0);
      let cursor = 0;
      const place = (at: number, data: Uint8Array) => {
        if (at + data.length > swap.length) {
          const grown = new Uint8Array(at + data.length);
          grown.set(swap);
          swap = grown;
        }
        swap.set(data, at);
        cursor = at + data.length;
      };
      return {
        write: async (chunk: Uint8Array | { position: number; data: Uint8Array }) => {
          if (chunk instanceof Uint8Array) place(cursor, chunk);
          else place(chunk.position, new Uint8Array(chunk.data));
        },
        truncate: async (size: number) => {
          swap = swap.slice(0, size);
        },
        close: async () => {
          content = swap;
        },
        abort: async () => undefined,
      };
    },
  } as unknown as FileSystemFileHandle;
  return { handle, bytes: () => [...content] };
}

afterEach(() => {
  workspaceStore.update((state) => ({ ...state, panes: { a: undefined, b: undefined } }));
});

describe("a save", () => {
  it("writes the session's bytes back to its file, and leaves it clean with its history", async () => {
    const disk = diskFile("bios.bin", [0, 1, 2, 3, 4, 5, 6, 7]);
    workspaceStore.update((state) => ({
      ...state,
      capabilities: { canSaveInPlace: true, canWriteDroppedFiles: true, canPickDirectory: true },
    }));
    const file = await disk.handle.getFile();
    openInPane("a", {
      name: "bios.bin",
      size: file.size,
      lastModified: 0,
      source: file,
      handle: disk.handle,
    });
    const document = workspaceStore.getSnapshot().panes.a?.document;
    if (document === undefined) throw new Error("the pane did not open");
    await document.overwrite(2, Uint8Array.of(0xaa, 0xbb));
    expect(document.isDirty).toBe(true);

    const outcome = await savePane("a");

    expect(outcome.kind).toBe("savedInPlace");
    expect(disk.bytes()).toEqual([0, 1, 0xaa, 0xbb, 4, 5, 6, 7]);
    expect(document.isDirty).toBe(false);
    expect(document.canUndo, "a save keeps what can be taken back").toBe(true);
    await document.undo();
    expect(document.isDirty, "and undoing past it is a change again").toBe(true);
  });
});
