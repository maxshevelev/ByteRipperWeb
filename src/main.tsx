import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { restoreSettings } from "@/state/workspaceStore";
import "@/ui/theme/theme.css";
import "@/app/app.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html is missing its #root element");

// The remembered preferences first, so the dump is never drawn at the default
// size and then again at the chosen one. Reading them never fails: a browser
// that will not persist answers with the defaults.
void restoreSettings().finally(() => {
  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
