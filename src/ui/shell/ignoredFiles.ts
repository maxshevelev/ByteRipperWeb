/**
 * What the window says when a gesture brought more files than it can take.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.notifyIgnored
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.notifyJoinIgnored
 * @upstream-differs said in the status bar, where the port's alerts go (reportProblem), rather than in a modal alert
 */
export function ignoredFilesMessage(count: number, gesture: "open" | "join"): string {
  const noun = count === 1 ? "file was" : "files were";
  return gesture === "open"
    ? `Additional files ignored: ${count} ${noun} not opened because only two files can be compared at once.`
    : `Additional files ignored: ${count} ${noun} not joined because only one file can be joined at a time.`;
}
