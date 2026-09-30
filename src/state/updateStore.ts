import { L } from "@/core/localization/localization";
import { compareAppVersions } from "@/core/updates/appVersion";
import { newerRelease, type Release, type ReleaseSource } from "@/core/updates/releases";
import { GitHubReleases } from "@/platform/net/githubReleases";
import { createStore } from "@/state/store";
import { reportAlert } from "@/state/workspaceStore";
import { appNameAndVersion, runningVersion } from "@/ui/shell/appVersion";
import { desktopBridge } from "@/ui/shell/desktopMenu";

/**
 * Whether a newer build has been published, and the desktop build's way of
 * moving to it.
 *
 * Two questions share one source. The landing screen asks quietly, once a day
 * at most, and says nothing when anything goes wrong — offline is the normal
 * state of a bench. **Check for Update…** is a person asking: it asks again,
 * and answers every way it can, including "you have the newest" and "could not
 * reach github.com", because the person is waiting for one.
 *
 * Installing is the desktop shell's: a page cannot replace the program that
 * runs it. The page asks, the shell downloads and checks the file and runs it
 * when the window has closed (`desktop/main.cjs`).
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.announceNewerRelease
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.releases
 * @upstream-differs upstream only announces; this edition's desktop build can also install, on request
 */

export type UpdateAsk =
  /** A newer build exists; asking whether to move to it. */
  | { readonly phase: "available"; readonly release: Release }
  /** The shell is downloading it. */
  | { readonly phase: "installing"; readonly release: Release };

export const updateStore = createStore<{ readonly ask: UpdateAsk | undefined }>({
  ask: undefined,
});

let source: ReleaseSource = new GitHubReleases();

/** Where the check is asked: the app's own source, and a stub in a test about it. */
export function setReleaseSource(next: ReleaseSource): void {
  source = next;
}

/**
 * The newer release the landing screen announces, or nothing.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.announceNewerRelease
 */
export const checkForNewerRelease = (): Promise<Release | undefined> =>
  newerRelease(source, runningVersion());

/** File ▸ Check for Update…: a person asking, and told the answer either way. */
export async function checkForUpdate(): Promise<void> {
  const running = runningVersion();
  let release: Release | undefined;
  try {
    release = await source.latestRelease({ refresh: true });
  } catch {
    reportAlert(
      L("Could Not Check for Updates"),
      L("github.com could not be reached. Check the internet connection and try again.")
    );
    return;
  }
  if (
    release === undefined ||
    running === undefined ||
    compareAppVersions(release.version, running) <= 0
  ) {
    reportAlert(L("No Update Available"), L("%1$@ is the latest version.", appNameAndVersion()));
    return;
  }
  updateStore.update((state) => ({ ...state, ask: { phase: "available", release } }));
}

/** The landing screen's Update: asks before it downloads and restarts. */
export function offerUpdate(release: Release): void {
  updateStore.update((state) => ({ ...state, ask: { phase: "available", release } }));
}

/** The reader said no, or asked for nothing more. */
export function dismissUpdate(): void {
  updateStore.update((state) => ({ ...state, ask: undefined }));
}

/**
 * The reader said yes. An installed desktop build hands the release to the
 * shell; anything else — a page, a portable `.exe` — opens the release's page,
 * where the download is.
 */
export async function acceptUpdate(release: Release): Promise<void> {
  const bridge = desktopBridge();
  if (bridge === undefined || !bridge.canInstallUpdate) {
    dismissUpdate();
    window.open(release.page, "_blank", "noopener");
    return;
  }
  updateStore.update((state) => ({ ...state, ask: { phase: "installing", release } }));
  const result = await bridge.installUpdate(release.version.text);
  dismissUpdate();
  if (result.status === "cancelled") return;
  reportAlert(
    L("The Update Could Not Be Installed"),
    result.reason === "checksum"
      ? L("The downloaded file does not match the release's checksum, so it was not run.")
      : result.reason === "download"
        ? L("The update could not be downloaded. Check the internet connection and try again.")
        : L("This release has no installer for Windows. Its page has the download.")
  );
}
