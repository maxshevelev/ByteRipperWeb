import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { OwnWindow } from "@/app/OwnWindow";
import { ownWindowKind } from "@/platform/desktop/desktopWindows";
import { installOpfsJournals } from "@/platform/files/opfsJournalStore";
import { loadBundledMapsInPage } from "@/platform/mapData/bundledMaps";
import { loadRestoresWorkspace } from "@/state/settingsStore";
import { settleWorkspaceIdentity } from "@/state/workspace/workspaceIdentity";
import { restoreSettings } from "@/state/workspaceStore";
import { publishFieldMenu } from "@/ui/shell/desktopMenu";
import "@/ui/theme/theme.css";
import "@/app/app.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html is missing its #root element");

// The remembered preferences first, so the dump is never drawn at the default
// size and then again at the chosen one. Reading them never fails: a browser
// that will not persist answers with the defaults.
// And which workspace this tab is — a fresh tab may take up one left by a tab since closed — before
// anything kept under it is read (`Design/WORKSPACE.md`).
// One of the app's own windows in the desktop shell holds no workspace at all (D7).
// Every document's undo history keeps the bytes of its changes on disk, not in memory.
// And the compiled maps, which the page reads too: the ME panel's Configuration tab and its
// FPF and strap groups are named through them, from the analysis the worker sends.
installOpfsJournals();

const own = ownWindowKind();
const settled = Promise.all([
  restoreSettings(),
  loadBundledMapsInPage(),
  own === undefined
    ? loadRestoresWorkspace().then((restores) => settleWorkspaceIdentity(restores))
    : undefined,
]);
void settled.finally(() => {
  // In the language the settings chose, which is the one the page draws in.
  publishFieldMenu();
  createRoot(host).render(
    <StrictMode>{own === undefined ? <App /> : <OwnWindow kind={own} />}</StrictMode>
  );
});
