import { Sha256 } from "@/core/crypto/sha256";
import { desktopFiles } from "@/platform/desktop/desktopFiles";
import type { OpenedFile } from "@/platform/files/openedFile";

/**
 * The SHA-256 of a whole file, hex: read by the shell by its path where it has one — one request,
 * at the main process's speed — and otherwise read here a slice at a time, `progress` told each
 * slice.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/FileDigest.swift#FileDigest.sha256
 * @upstream-differs two ways to the bytes: the shell's by path, the page's through the file it
 * was handed
 */
export async function fileSha256(
  file: Pick<OpenedFile, "path" | "source" | "size">,
  progress?: (fraction: number) => void
): Promise<string> {
  const files = desktopFiles();
  if (file.path !== undefined && files !== undefined) {
    return files.file({ op: "hash", path: file.path });
  }
  const hasher = new Sha256();
  const slice = 8 << 20;
  for (let at = 0; at < file.size; at += slice) {
    const end = Math.min(file.size, at + slice);
    hasher.update(new Uint8Array(await file.source.slice(at, end).arrayBuffer()));
    progress?.(end / Math.max(1, file.size));
  }
  return Array.from(hasher.digest(), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
