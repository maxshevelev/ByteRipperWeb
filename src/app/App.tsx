import { languageStore } from "@/state/settingsStore";
import { useStore } from "@/state/useStore";
import { AppShell } from "@/ui/shell/AppShell";

/**
 * The workspace. One per browser tab, by decision D11 — there are no in-app
 * tabs and no window management, so this component is the whole application
 * and it is never mounted twice.
 *
 * @upstream ByteRipperApp/App/AppMain.swift#ByteRipperMain
 * @upstream ByteRipperApp/App/AppMain.swift#ByteRipperMain.main
 * @upstream-differs main.tsx mounts the App
 */
export function App() {
  // **The chrome is rebuilt when the language changes, and nothing else is.**
  //
  // A label, a menu item and a column heading are all words read when they were
  // built, so the honest way to change language is to build them again.
  // Upstream answers this with *Relaunch Now*; a reload here would ask for
  // every open dump again, so the shell is remounted instead and the stores
  // behind it — the files, the bookmarks, the undo — are untouched
  // (`Design/LOCALIZATION.md`).
  //
  // @web-only upstream rebuilds its menu bar and offers the relaunch for the rest
  const language = useStore(languageStore);
  return <AppShell key={language} />;
}
