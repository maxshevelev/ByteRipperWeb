import { L } from "@/core/localization/localization";
import { compareAppVersions, parseAppVersion } from "@/core/updates/appVersion";
import {
  type Release,
  type ReleaseAnnouncement,
  type ReleaseSource,
  releaseToAnnounce,
} from "@/core/updates/releases";
import { GitHubReleases, HeldReleases, ReleaseCheckError } from "@/platform/net/githubReleases";
import { createStore } from "@/state/store";
import { reportAlert } from "@/state/workspaceStore";
import { appNameAndVersion, runningVersion } from "@/ui/shell/appVersion";
import { type DesktopBridge, desktopBridge, type UpdateProgress } from "@/ui/shell/desktopMenu";

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
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.announceRelease
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.releases
 * @upstream-differs upstream only announces; this edition's desktop build can also install, on request
 */

export type UpdateAsk =
  /** A newer build exists; asking whether to move to it. */
  | { readonly phase: "available"; readonly release: Release }
  /** The shell is fetching it, and says how far it has got. */
  | { readonly phase: "installing"; readonly release: Release; readonly progress: UpdateProgress };

export const updateStore = createStore<{ readonly ask: UpdateAsk | undefined }>({
  ask: undefined,
});

/**
 * The desktop shell asks for the page: its request is not the page's. A page's
 * fetch to `api.github.com` is one of sixty an hour for its network and has to
 * be allowed by GitHub's CORS rules; the shell follows the release page's own
 * redirect (`desktop/update.cjs`), which has neither limit.
 */
async function askShell(bridge: DesktopBridge): Promise<Release | undefined> {
  let latest: Awaited<ReturnType<DesktopBridge["latestRelease"]>>;
  try {
    latest = await bridge.latestRelease();
  } catch {
    throw new ReleaseCheckError("network");
  }
  const version = latest === undefined ? undefined : parseAppVersion(latest.tag);
  if (latest === undefined || version === undefined) return undefined;
  return { version, page: latest.page, assets: [] };
}

const shell = desktopBridge();
let source: ReleaseSource =
  shell === undefined ? new GitHubReleases() : new HeldReleases(() => askShell(shell));

/** Where the check is asked: the app's own source, and a stub in a test about it. */
export function setReleaseSource(next: ReleaseSource): void {
  source = next;
}

/**
 * The newer release the landing screen announces, or nothing: the build
 * running is not newer than itself, and a build made after the newest release
 * was published is not told to go back to the older one.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.announceRelease
 */
export const checkForNewerRelease = async (): Promise<Release | undefined> => {
  const announcement = await releaseToAnnounce(source, runningVersion());
  return announcement === undefined || announcement.isRunningBuild
    ? undefined
    : announcement.release;
};

/**
 * The announcement the landing screen's notes are drawn from, asked the
 * page's own way: the page fetches github.com's API, whose answer carries the
 * release's body — the shell's redirect, which the check above uses, carries
 * only the tag. Held one request a day like the check, and asked in the
 * background: it answers when it answers, and nothing is printed while it has
 * not. In the desktop shell this is the page's fetch, not the shell's — the
 * notes are not the update, so they take the page's allowance rather than
 * spending the shell's.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.announceRelease
 * @upstream-differs upstream draws the line and the notes from one source; the
 * notes here come from the page's own API answer, because the shell's redirect
 * carries no body
 */
const notesSource: ReleaseSource = new GitHubReleases();

export const releaseAnnouncementForNotes = (): Promise<ReleaseAnnouncement | undefined> =>
  releaseToAnnounce(notesSource, runningVersion());

/**
 * What to tell a person whose check failed, for the reason it failed: a network
 * that is down is theirs to look at, a limit that is spent only has to wait, and
 * an answer that is an error is GitHub's own trouble.
 */
export function checkFailure(error: unknown, now: number = Date.now()): string {
  if (error instanceof ReleaseCheckError) {
    if (error.kind === "rateLimit") {
      const minutes =
        error.retryAt === undefined
          ? undefined
          : Math.max(1, Math.ceil((error.retryAt - now) / 60_000));
      return minutes === undefined
        ? L("GitHub is limiting requests from this network for now. Try again in about an hour.")
        : L(
            "GitHub is limiting requests from this network for now. Try again in %1$@ minutes.",
            String(minutes)
          );
    }
    if (error.kind === "status") {
      return L("github.com answered %1$@. Try again in a few minutes.", String(error.status ?? ""));
    }
  }
  return L("github.com could not be reached. Check the internet connection and try again.");
}

/** File ▸ Check for Update…: a person asking, and told the answer either way. */
export async function checkForUpdate(): Promise<void> {
  const running = runningVersion();
  let release: Release | undefined;
  try {
    release = await source.latestRelease({ refresh: true });
  } catch (error) {
    reportAlert(L("Could Not Check for Updates"), checkFailure(error));
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

/** Cancel while the file comes down. */
export function cancelInstall(): void {
  desktopBridge()?.cancelUpdate();
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
  const show = (progress: UpdateProgress) =>
    updateStore.update((state) => ({ ...state, ask: { phase: "installing", release, progress } }));
  show({ phase: "preparing" });
  const stopListening = bridge.onUpdateProgress(show);
  const result = await bridge.installUpdate(release.version.text);
  stopListening();
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
