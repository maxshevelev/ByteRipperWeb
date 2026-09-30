import { useEffect, useState } from "react";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import type { Release } from "@/core/updates/releases";
import { saveNotice } from "@/platform/files/capabilities";
import { bookmarksStore } from "@/state/bookmarksStore";
import { checkForNewerRelease, offerUpdate } from "@/state/updateStore";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";
import { HelpButton } from "@/ui/help/HelpButton";
import { appNameAndVersion } from "@/ui/shell/appVersion";
import { bookmarkHeading, bookmarkRows } from "@/ui/shell/emptyWindow";

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
export function EmptyState({ onOpen }: { readonly onOpen: () => void }) {
  const { bookmarks } = useStore(bookmarksStore);
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
      <BookmarkSection bookmarks={bookmarks} />
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
