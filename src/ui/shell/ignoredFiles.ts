import { L } from "@/core/localization/localization";
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
  const noun = count === 1 ? L("file was") : L("files were");
  return {
    title: L("Additional files ignored"),
    message:
      gesture === "open"
        ? L("%1$@ %2$@ not opened because only two files can be compared at once.", count, noun)
        : L("%1$@ %2$@ not joined because only one file can be joined at a time.", count, noun),
  };
}
