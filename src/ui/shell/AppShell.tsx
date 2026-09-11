import { EmptyState } from "@/ui/shell/EmptyState";
import { StatusBar } from "@/ui/shell/StatusBar";
import { Toolbar } from "@/ui/shell/Toolbar";

/**
 * Header, workspace, status bar — the three bands the app never loses, whatever
 * is loaded into it. The workspace band is where the panes will mount from M2;
 * until then it holds the empty state.
 */
export function AppShell() {
  return (
    <div className="app-shell">
      <Toolbar />
      <main className="app-workspace">
        <EmptyState />
      </main>
      <StatusBar />
    </div>
  );
}
