/**
 * A web page has no menu bar (D12). The permanent buttons live here and
 * everything else will be reachable from the command palette; at M0 there is
 * nothing yet to command, so this is the title band alone.
 */
export function Toolbar() {
  return (
    <header className="toolbar">
      <span className="toolbar-title">ByteRipper</span>
      <span className="toolbar-subtitle">Web edition</span>
    </header>
  );
}
