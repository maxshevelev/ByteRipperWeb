/**
 * Handing a file to the browser's download flow.
 *
 * The route for everything this application cannot write in place: a whole
 * document in Firefox and Safari (D7), a ZIP of segments anywhere without a
 * directory picker, one selected range saved out.
 */

/**
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.exportFile
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.exportFileForTool
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.exportFile
 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked on a later turn: revoking synchronously races the download the
    // click just started, and the browser then has nothing to fetch.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
