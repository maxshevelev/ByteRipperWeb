import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { loadRestoresWorkspace } from "@/state/settingsStore";
import { settleWorkspaceIdentity } from "@/state/workspace/workspaceIdentity";
import { restoreSettings } from "@/state/workspaceStore";
import "@/ui/theme/theme.css";
import "@/app/app.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html is missing its #root element");

// The remembered preferences first, so the dump is never drawn at the default
// size and then again at the chosen one. Reading them never fails: a browser
// that will not persist answers with the defaults.
// And which workspace this tab is — a fresh tab may take up one left by a tab since closed — before
// anything kept under it is read (`Design/WORKSPACE.md`).
const settled = Promise.all([
  restoreSettings(),
  loadRestoresWorkspace().then((restores) => settleWorkspaceIdentity(restores)),
]);
void settled.finally(() => {
  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
