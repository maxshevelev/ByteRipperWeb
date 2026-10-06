import { useEffect, useState } from "react";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import { releaseSummary } from "@/core/updates/releaseNotes";
import type { Release } from "@/core/updates/releases";
import { saveNotice } from "@/platform/files/capabilities";
import { bookmarksStore } from "@/state/bookmarksStore";
import { recentFilesStore } from "@/state/recentFilesStore";
import {
  checkForNewerRelease,
  offerUpdate,
  releaseAnnouncementForNotes,
} from "@/state/updateStore";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";
import { HelpButton } from "@/ui/help/HelpButton";
import { appNameAndVersion } from "@/ui/shell/appVersion";
import { bookmarkHeading, bookmarkRows, leftSection } from "@/ui/shell/emptyWindow";

/**
 * What the window says before it has been given anything: a large icon that
 * opens the file picker, the headline and the hint — and, while the workspace
 * is keeping marks, the marks.
 *
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.onOpenFiles
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.init
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.setUp
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.contentStack
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.openButton
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.iconColor
 * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#EmptyStateColors
 * @upstream Packages/AppPalette/Sources/AppPalette/SemanticColors.swift#EmptyStateColors.icon
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.headlineGap
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.maxIconSize
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.currentIconSize
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.updateIconSize
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.visibleBottomInset
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.viewDidMoveToWindow
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.layout
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.setDropHighlighted
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.draggingEntered
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.draggingUpdated
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.draggingExited
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.draggingEnded
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.prepareForDragOperation
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.performDragOperation
 * @upstream-differs the icon scales with the viewport's shorter side in CSS and is drawn without padding, so the headline gap needs no measuring; the window takes the drop (AppShell) and this view is outlined while files are over it
 * @web-only the hint's second line: what this browser does on save and that the
 * files never leave the machine. Upstream says the save kind beside the pane's
 * status and nothing at all about where the bytes go; the landing screen is the
 * one place with no file open, which is where both belong
 */
export function EmptyState({
  onOpen,
  onOpenRecent,
}: {
  readonly onOpen: () => void;
  /** A row of the recent files was clicked: the index into File ▸ Open Recent's list. */
  readonly onOpenRecent: (index: number) => void;
}) {
  const { bookmarks } = useStore(bookmarksStore);
  const recent = useStore(recentFilesStore).rows;
  const left = leftSection(bookmarks.length, recent.length);
  const { capabilities } = useStore(workspaceStore);

  return (
    <div className="empty-state">
      <button
        type="button"
        className="empty-state-icon"
        onClick={onOpen}
        aria-label={L("Open File")}
        title={L("Open File")}
      >
        <OpenFileGlyph />
      </button>
      {/* help: shell.empty-state */}
      <p className="empty-state-headline">{L("Drop files here")}</p>
      <p className="empty-state-detail">{L("Up to two files can be compared side by side.")}</p>
      <p className="empty-state-detail">
        {/* help: platform.save-capability */}
        {`${L("Files never leave this machine.")} ${saveNotice(capabilities)}`}
        {/* The one screen where a reader arrives with "what is this for", which
            is the question the overview answers.
            @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.setUp */}
        <HelpButton link={topicLink(TOPIC.overview)} />
      </p>
      {/* The version belongs to the hint rather than being another line of
          it, so it sits closer (upstream's versionGap).
          @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.versionGap */}
      <p className="empty-state-version">{appNameAndVersion()}</p>
      <NewerRelease />
      {/* The bottom: the marks and the release's own words. While there are
          marks the two share the row, each its half; while there are none the
          notes stand alone. */}
      <div
        className={
          left !== undefined ? "empty-state-bottom empty-state-bottom--split" : "empty-state-bottom"
        }
      >
        <BookmarkSection bookmarks={bookmarks} />
        {left === "recents" ? <RecentFilesSection rows={recent} onOpen={onOpenRecent} /> : null}
        <ReleaseNotes />
      </div>
    </div>
  );
}

/**
 * A newer build, announced under the version it is newer than: one line, and
 * beside it the way to move to it. Upstream's line is a link to the release's
 * page; here the window can do the update itself — the desktop build installs
 * it, a page opens where the download is — so the line offers that, and asks
 * before it does (`offerUpdate`).
 *
 * Asked in the background and never waited for — the screen is drawn first and
 * the line arrives after it, when it arrives at all. Nothing on this screen
 * reports a check that failed: offline is the normal state of a bench.
 *
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.showAvailableRelease
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.releaseLineText
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.openReleasePage
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.releaseLineForTesting
 * @upstream-differs the line offers the update rather than linking to the release's page
 */
function NewerRelease() {
  const [release, setRelease] = useState<Release | undefined>();

  useEffect(() => {
    let current = true;
    void checkForNewerRelease().then((found) => {
      // The answer is older than the question: a file may have been opened since.
      if (current) setRelease(found);
    });
    return () => {
      current = false;
    };
  }, []);

  if (release === undefined) return null;
  return (
    <p className="empty-state-release">
      {L("Version %1$@ is available", release.version.text)}
      {" · "}
      <button
        type="button"
        className="empty-state-update"
        onClick={() => offerUpdate(release)}
        title={L("Update to version %1$@", release.version.text)}
      >
        {L("Update")}
      </button>
    </p>
  );
}

/**
 * The release's own words under the version: the first paragraph of its notes,
 * asked in the background like the newer-build line and never waited for. The
 * text is the release's own, as written on github.com, so it reads in the
 * language the release was written in rather than the reader's. The heading
 * says which of the two cases the release is in: the build the reader runs, or
 * one newer than it. Hidden while there is nothing to show — no release, no
 * body, no network, and a release the reader is newer than, which is told
 * nothing.
 *
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.showReleaseNotes
 */
function ReleaseNotes() {
  // The release's data, not its words: the heading is asked in the render, so
  // a language the reader changes in Settings re-draws it — the words would
  // otherwise freeze in the language that was current when the notes arrived.
  const [info, setInfo] = useState<{
    readonly version: string;
    readonly isRunningBuild: boolean;
    readonly text: string;
  } | null>(null);

  useEffect(() => {
    let current = true;
    void releaseAnnouncementForNotes().then((announcement) => {
      // The answer is older than the question: a file may have been opened since.
      if (!current || announcement === undefined) return;
      const text = releaseSummary(announcement.release);
      if (text === "") return;
      setInfo({
        version: announcement.release.version.text,
        isRunningBuild: announcement.isRunningBuild,
        text,
      });
    });
    return () => {
      current = false;
    };
  }, []);

  if (info === null) return null;
  const heading = info.isRunningBuild
    ? L("What's new in version %1$@", info.version)
    : L("What's new in the new version %1$@", info.version);
  return (
    <section className="empty-state-release-notes" aria-label={heading}>
      {/* help: shell.empty-state.release-notes */}
      <h2 className="empty-state-release-notes-heading">{heading}</h2>
      <p className="empty-state-release-notes-body">{info.text}</p>
    </section>
  );
}

/**
 * The recent files, on the bottom row's left: the same list as File ▸ Open Recent, put
 * where a window with nothing in it is looking — the usual next step is to open what was
 * open yesterday. One row a file, most recent first, a click opens it in the active pane.
 * The bookmarks take the place when the window has any.
 *
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.makeRecentSection
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.setRecentFiles
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.openRecentRow
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.onOpenRecent
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.recentRowTitle
 * @upstream-differs a row is the file's name alone: the page never sees the folder it came from
 */
function RecentFilesSection({
  rows,
  onOpen,
}: {
  readonly rows: readonly { readonly name: string }[];
  readonly onOpen: (index: number) => void;
}) {
  return (
    <section className="empty-state-recent" aria-label={L("Recent Files")}>
      {/* help: shell.empty-state.recent-files */}
      <h2 className="empty-state-recent-heading">{L("Recent Files")}</h2>
      <div className="empty-state-recent-list">
        {rows.map((row, index) => (
          <button
            key={row.name}
            type="button"
            className="empty-state-recent-row"
            title={L("Open “%1$@”", row.name)}
            onClick={() => onOpen(index)}
          >
            {row.name}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The marks, under the hint: the answer to what an empty window is *for*.
 * Hidden while there are none.
 *
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.makeBookmarkSection
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.bookmarkSection
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.bookmarkHeading
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.bookmarkGrid
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.bookmarkScroll
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.bookmarkScrollHeight
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.bookmarkScrollWidth
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.maxBookmarkListHeight
 * @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.bookmarkSectionGap
 * @upstream-differs a CSS grid with a maximum height scrolls itself, so there are no size constraints to keep in step
 */
function BookmarkSection({
  bookmarks,
}: {
  readonly bookmarks: Parameters<typeof bookmarkRows>[0];
}) {
  if (bookmarks.length === 0) return null;
  return (
    <section className="empty-state-bookmarks" aria-label={L("Bookmarks")}>
      <h2 className="empty-state-bookmarks-heading">{bookmarkHeading(bookmarks.length)}</h2>
      <div className="empty-state-bookmarks-list">
        {bookmarkRows(bookmarks).map((row) => (
          <div key={row.address} className="empty-state-bookmark">
            <span className="empty-state-bookmark-address">{row.address}</span>
            <span className="empty-state-bookmark-name">{row.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Upstream's `plus.viewfinder`: a frame's four corners round a plus. */
function OpenFileGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
      <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
      <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
      <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}
