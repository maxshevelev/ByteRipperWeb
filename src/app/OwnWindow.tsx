import { useEffect } from "react";
import { L } from "@/core/localization/localization";
import {
  desktopOwnWindows,
  type OwnWindowKind,
  windowLaunch,
} from "@/platform/desktop/desktopWindows";
import { restoreAnnotations } from "@/state/agent/agentAnnotationStore";
import { agentService } from "@/state/agent/agentService";
import { hostAgentForWindows, openAgentSettingsInFront } from "@/state/agent/agentWindows";
import { shareAnnotationsAcrossWindows, startNotesWindow } from "@/state/agent/annotationWindows";
import { startHelpWindow } from "@/state/helpStore";
import { languageStore } from "@/state/settingsStore";
import { useStore } from "@/state/useStore";
import { AgentWindow } from "@/ui/agent/AgentWindow";
import { HelpPanel } from "@/ui/help/HelpPanel";
import { NoteFormDialog } from "@/ui/notes/NoteFormDialog";
import { NotesPanel } from "@/ui/notes/NotesPanel";

/**
 * One of the app's own windows in the desktop shell — the help book, the annotations, the agent's
 * log — which a browser tab holds as a panel of its dock (`Design/DESKTOP_WINDOWS.md`, D7). The
 * page holds no workspace: only what the kind shows.
 *
 * @upstream Packages/HelpUI/Sources/HelpUI/HelpWindowController.swift#HelpWindowController
 * @upstream-differs a page of its own in the window, the kind named by the window's launch
 */
export function OwnWindow({ kind }: { readonly kind: OwnWindowKind }) {
  // Everything here is built from words, so a language changed in any window rebuilds it.
  const language = useStore(languageStore);

  useEffect(() => {
    if (kind === "help") return startHelpWindow(windowLaunch()?.show);
    if (kind === "notes") {
      // What was kept, then the other windows' annotations, which they hand a window that asks.
      void restoreAnnotations().then(shareAnnotationsAcrossWindows);
      return startNotesWindow(windowLaunch()?.show);
    }
    if (kind === "agent") {
      // The service itself runs here, for the whole app, whether the window is shown or not.
      hostAgentForWindows();
      void agentService.start();
    }
    return undefined;
  }, [kind]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the title is words, which the language changes
  useEffect(() => {
    document.title =
      kind === "help" ? L("ByteRipper Help") : kind === "notes" ? L("Annotations") : L("Agent");
  }, [kind, language]);

  // ⌘W / Ctrl+W closes the window, as File ▸ Close Window does a window of the workspace: the menu
  // bar a Mac shows over this window is the workspace window's, whose commands are its own.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        desktopOwnWindows()?.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="own-window" key={language}>
      {kind === "help" ? <HelpPanel /> : null}
      {kind === "agent" ? <AgentWindow onSettings={openAgentSettingsInFront} /> : null}
      {kind === "notes" ? (
        <>
          <NotesPanel />
          <NoteFormDialog />
        </>
      ) : null}
    </div>
  );
}
