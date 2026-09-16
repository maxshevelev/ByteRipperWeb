import type { Alert } from "@/state/workspaceStore";

/**
 * What the window says when a gesture brought more files than it can take.
 *
 * Titles above messages, as upstream has them: "Additional files ignored" is
 * what happened, and the sentence under it is why. The two variants differ in
 * the reason only, because that is the only thing that differs: opening takes
 * two files, joining takes one.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.notifyIgnored
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.notifyJoinIgnored
 */
export function ignoredFilesAlert(count: number, gesture: "open" | "join"): Alert {
  const noun = count === 1 ? "file was" : "files were";
  return {
    title: "Additional files ignored",
    message:
      gesture === "open"
        ? `${count} ${noun} not opened because only two files can be compared at once.`
        : `${count} ${noun} not joined because only one file can be joined at a time.`,
  };
}
