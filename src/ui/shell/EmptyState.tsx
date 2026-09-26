import { TOPIC, topicLink } from "@/core/help/helpIds";
import { saveNotice } from "@/platform/files/capabilities";
import { bookmarksStore } from "@/state/bookmarksStore";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";
import { HelpButton } from "@/ui/help/HelpButton";
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
        aria-label="Open File"
        title="Open File"
      >
        <OpenFileGlyph />
      </button>
      <p className="empty-state-headline">Drop files here</p>
      <p className="empty-state-detail">Up to two files can be compared side by side.</p>
      <p className="empty-state-detail">
        {`Files never leave this machine. ${saveNotice(capabilities)}`}
        {/* The one screen where a reader arrives with "what is this for", which
            is the question the overview answers.
            @upstream ByteRipperApp/Window/EmptyStateView.swift#EmptyStateView.helpButton */}
        <HelpButton link={topicLink(TOPIC.overview)} />
      </p>
      <BookmarkSection bookmarks={bookmarks} />
    </div>
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
    <section className="empty-state-bookmarks" aria-label="Bookmarks">
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
