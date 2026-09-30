import { L } from "@/core/localization/localization";
import { acceptUpdate, cancelInstall, dismissUpdate, updateStore } from "@/state/updateStore";
import { useStore } from "@/state/useStore";
import { ConfirmDialog } from "@/ui/dialogs/ConfirmDialog";
import { Dialog } from "@/ui/dialogs/Dialog";
import { appNameAndVersion } from "@/ui/shell/appVersion";
import { desktopBridge, type UpdateProgress } from "@/ui/shell/desktopMenu";

/**
 * The two questions of **Check for Update…**: whether to move to the newer
 * build, and — while the desktop shell fetches it — how far it has got.
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
      {/* The window is held while the file comes down — and says what it is
          doing, because a silent wait of a minute reads as a hang. Escape and the
          box's edge do nothing: the one way out is Cancel. */}
      <Dialog
        open={ask?.phase === "installing"}
        title={L("Updating to Version %1$@", version)}
        onClose={() => {}}
      >
        <div className="dialog-body">
          {ask?.phase === "installing" ? <InstallProgress progress={ask.progress} /> : null}
          <div className="dialog-actions">
            <button
              type="button"
              className="toolbar-button"
              onClick={cancelInstall}
              disabled={ask?.phase === "installing" && ask.progress.phase === "install"}
            >
              {L("Cancel")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** A megabyte count as a reader says it: "42.5 MB". */
const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * What the shell is doing and, while the file comes down, a bar for how much of
 * it has. A phase with no measure — asking GitHub, checking the file, closing
 * the window — is a bar that moves without a value, so there is always
 * something on the screen that says the app has not stopped.
 */
function InstallProgress({ progress }: { readonly progress: UpdateProgress }) {
  const total = progress.total ?? 0;
  const received = progress.received ?? 0;
  const measured = progress.phase === "download" && total > 0;
  const words =
    progress.phase === "preparing"
      ? L("Contacting GitHub…")
      : progress.phase === "download"
        ? measured
          ? L("Downloading… %1$@ of %2$@", megabytes(received), megabytes(total))
          : L("Downloading…")
        : progress.phase === "verify"
          ? L("Checking the download…")
          : L("Closing ByteRipper. The installer opens next and starts it again.");
  return (
    <>
      <p className="dialog-message" aria-live="polite">
        {words}
      </p>
      <progress
        className="update-progress"
        max={measured ? total : undefined}
        value={measured ? received : undefined}
        aria-label={words}
      />
    </>
  );
}
