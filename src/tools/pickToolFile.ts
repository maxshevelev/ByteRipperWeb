/**
 * A file the user picks for a tool, read into memory: its name, for the tool to say which file
 * it read, and its bytes.
 *
 * Any file: a vendor names an update after the BIOS version, not after what it is, so nothing
 * filters the picker. A plain file input, as for a microcode (`pickMicrocode`): the file is
 * only ever read.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.requestFile
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.requestFileForTool
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.requestFile
 */
export function pickToolFile(): Promise<{ name: string; bytes: Uint8Array } | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";

    const finish = (picked: { name: string; bytes: Uint8Array } | undefined) => {
      input.remove();
      resolve(picked);
    };
    input.addEventListener("cancel", () => finish(undefined));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) {
        finish(undefined);
        return;
      }
      void file
        .arrayBuffer()
        .then((buffer) => finish({ name: file.name, bytes: new Uint8Array(buffer) }))
        .catch(() => finish(undefined));
    });

    document.body.append(input);
    input.click();
  });
}
