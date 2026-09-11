/**
 * What the app says before it has been given anything.
 */
export function EmptyState({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <div className="empty-state">
      <p className="empty-state-headline">Open a file, or drop one here</p>
      <p className="empty-state-detail">
        Two dumps compare byte for byte by absolute offset. One is enough to start.
      </p>
      <button type="button" className="empty-state-button" onClick={onOpen}>
        Open a file…
      </button>
    </div>
  );
}
