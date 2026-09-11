/**
 * What the app says before it has been given anything. File opening arrives in
 * M2 together with the pane that would display it, so this is deliberately not
 * a button that does nothing.
 */
export function EmptyState() {
  return (
    <div className="empty-state">
      <p className="empty-state-headline">Open a file, or drop one here</p>
      <p className="empty-state-detail">
        Two dumps compare byte for byte by absolute offset. One is enough to start.
      </p>
    </div>
  );
}
