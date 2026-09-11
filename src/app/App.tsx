import { AppShell } from "@/ui/shell/AppShell";

/**
 * The workspace. One per browser tab, by decision D11 — there are no in-app
 * tabs and no window management, so this component is the whole application
 * and it is never mounted twice.
 */
export function App() {
  return <AppShell />;
}
