/**
 * The bottom band. From M3 it carries the live `12 differing · 2048 same`
 * summary, and from M6 the minimap build progress; every wait on the network
 * is announced here too, with a cancel (D10).
 */
export function StatusBar() {
  return (
    <footer className="status-bar">
      <span className="status-slot">No file open</span>
      <span className="status-spacer" />
      <span className="status-slot status-slot-muted">Files never leave this machine</span>
    </footer>
  );
}
