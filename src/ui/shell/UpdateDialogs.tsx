import { L } from "@/core/localization/localization";
import { acceptUpdate, dismissUpdate, updateStore } from "@/state/updateStore";
import { useStore } from "@/state/useStore";
import { ConfirmDialog } from "@/ui/dialogs/ConfirmDialog";
import { Dialog } from "@/ui/dialogs/Dialog";
import { appNameAndVersion } from "@/ui/shell/appVersion";
import { desktopBridge } from "@/ui/shell/desktopMenu";

/**
 * The two questions of **Check for Update…**: whether to move to the newer
 * build, and — while the desktop shell downloads it — what is happening.
 *
 * @web-only upstream announces a newer build and leaves the rest to the reader
 */
export function UpdateDialogs() {
  const { ask } = useStore(updateStore);
  const installable = desktopBridge()?.canInstallUpdate === true;
  const release = ask?.release;
  const version = release?.version.text ?? "";

  return (
    <>
      <ConfirmDialog
        open={ask?.phase === "available"}
        title={L("Version %1$@ Is Available", version)}
        message={
          installable
            ? L(
                "You are running %1$@. Download the new version and restart ByteRipper to install it? Unsaved changes are asked about first.",
                appNameAndVersion()
              )
            : L(
                "You are running %1$@. Open its page on GitHub to download it?",
                appNameAndVersion()
              )
        }
        confirmLabel={installable ? L("Install and Restart") : L("Open Page")}
        onConfirm={() => {
          if (release !== undefined) void acceptUpdate(release);
        }}
        onCancel={dismissUpdate}
      />
      {/* Nothing to click while the file comes down: the window closes itself,
          or the shell says why it did not. */}
      <Dialog
        open={ask?.phase === "installing"}
        title={L("Downloading the Update…")}
        onClose={() => {}}
      >
        <div className="dialog-body">
          <p className="dialog-message">
            {L("Version %1$@ is being downloaded. ByteRipper restarts when it is ready.", version)}
          </p>
        </div>
      </Dialog>
    </>
  );
}
