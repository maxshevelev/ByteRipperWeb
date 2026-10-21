import type { AgentFileStat } from "@/platform/desktop/agentBridge";

/**
 * The desktop shell's files for the page's own use (`desktop/preload.cjs`): the full path of a file
 * the person opened — through the picker, the file input or a drop — and that file read again by
 * it. A browser tells a page no path, and has none of this.
 *
 * Unlike the agent's `file`, this is not behind the agent service's switch: it reads only what the
 * person opens again, as Open Recent does, and lists nothing.
 *
 * @web-only upstream holds every document's URL; the page holds a path only where the shell gives one
 */
export interface DesktopFiles {
  /** The full path of a file the person handed the page; nothing for one with no file behind it. */
  pathOf(file: File): string | undefined;
  file(request: { readonly op: "stat"; readonly path: string }): Promise<AgentFileStat>;
  file(request: {
    readonly op: "read";
    readonly path: string;
    readonly offset: number;
    readonly length: number;
  }): Promise<Uint8Array>;
}

let installed: { readonly files: DesktopFiles | undefined } | undefined;

/** The shell's files, where the page runs in the desktop shell; nothing in a browser. */
export function desktopFiles(): DesktopFiles | undefined {
  if (installed !== undefined) return installed.files;
  if (typeof window === "undefined") return undefined;
  return (window as { byteripperDesktop?: { files?: DesktopFiles } }).byteripperDesktop?.files;
}

/**
 * Whether the page runs in the desktop shell. What reopens files on its own — the workspace
 * brought back at launch, projects, Open Recent, the files an annotation is on from one visit to
 * the next — is the shell's alone. It reopens a file by the handle kept for it, which the shell
 * lets its page read without a question (`desktop/main.cjs` grants the app page every permission),
 * and by the file's full path where there is no handle. A browser keeps the same handle, but opens
 * it again only as far as it allows at the time — a question, a refusal it remembers — which is
 * not a feature to rely on.
 *
 * @web-only the browser edition and the shell differ here by the owner's decision (2026-10-21)
 */
export const inDesktopShell = (): boolean => desktopFiles() !== undefined;

/** Stands `files` in for the shell's, or with nothing puts the shell's back. */
export function installDesktopFilesForTesting(files?: DesktopFiles | null): void {
  installed = files === undefined ? undefined : { files: files ?? undefined };
}

/** The full path of `file`, where the shell can say it. */
export function pathOfFile(file: File): string | undefined {
  return desktopFiles()?.pathOf(file);
}

/** How much one read through the shell asks for: under its own ceiling of 16 MB. */
const CHUNK = 8 << 20;

/** What the shell's error says once the IPC wrapping is taken off. */
export const shellReason = (error: unknown): string =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "")
    : String(error);

/** Whether what the shell threw says there is nothing at the path. */
export const isMissingFile = (error: unknown): boolean =>
  /\b(ENOENT|ENOTDIR)\b/.test(shellReason(error));

/**
 * The file at `path` read through the shell, as a Blob — the workers take a Blob — read a chunk at
 * a time so no copy of a chunk outlives it. Throws what the shell threw.
 */
export async function readFileByPath(
  files: DesktopFiles,
  path: string
): Promise<{ readonly stat: AgentFileStat; readonly blob: Blob }> {
  const stat = await files.file({ op: "stat", path });
  if (stat.isDirectory) throw new Error(`${path} is a folder.`);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < stat.size; offset += CHUNK) {
    const bytes = await files.file({
      op: "read",
      path: stat.path,
      offset,
      length: Math.min(CHUNK, stat.size - offset),
    });
    if (bytes.length === 0) break;
    chunks.push(bytes.slice());
  }
  return { stat, blob: new Blob(chunks, { type: "application/octet-stream" }) };
}
