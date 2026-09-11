import { saveExplanation, saveVerb } from "@/platform/files/capabilities";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";

/**
 * The bottom band. From M3 it carries the live `12 differing · 2048 same`
 * summary, and from M6 the minimap build progress; every wait on the network is
 * announced here too, with a cancel (D10).
 *
 * What it already carries is the capability difference D7 insists the user be
 * told about rather than discover: in a browser that cannot write back to a
 * file, saving downloads a copy, and this says so before anyone tries.
 */
export function StatusBar() {
  const state = useStore(workspaceStore);
  const verb = saveVerb(state.capabilities);

  return (
    <footer className="status-bar">
      {state.problem === undefined ? (
        <span className="status-slot">
          {state.paneA === undefined
            ? "No file open"
            : `${state.paneA.name} · ${state.paneA.document.size.toLocaleString()} bytes`}
        </span>
      ) : (
        <span className="status-slot status-slot-problem">{state.problem}</span>
      )}

      <span className="status-spacer" />
      <span className="status-slot status-slot-muted" title={saveExplanation(state.capabilities)}>
        {verb === "Save" ? "Saves in place" : "Saves by downloading a copy"}
      </span>
      <span className="status-slot status-slot-muted">Files never leave this machine</span>
    </footer>
  );
}
