import { inDesktopShell } from "@/platform/desktop/desktopFiles";

/**
 * What an earlier build of the page kept in this browser to reopen files by itself — the
 * workspaces, their kept bytes, the projects, Open Recent — dropped: the browser edition keeps
 * none of it (`inDesktopShell`), and what is kept and never read again is only taking room.
 *
 * @web-only the browser edition has no workspace restore, projects or Open Recent
 */
const DATABASES = [
  "byteripper-workspaces",
  "byteripper-workspace-bytes",
  "byteripper-projects",
  "byteripper-recent-files",
];

export async function forgetReopeningInBrowser(): Promise<void> {
  if (inDesktopShell() || typeof indexedDB === "undefined") return;
  for (const name of DATABASES) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
}
