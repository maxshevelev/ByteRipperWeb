import { saveExplanation, saveVerb } from "@/platform/files/capabilities";
import { diffStore } from "@/state/diffStore";
import { editStore } from "@/state/editStore";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";

/**
 * The bottom band.
 *
 * It carries the live `12 differing · 2048 same` summary, the capability
 * difference D7 insists the user be told about rather than discover, and from
 * M6 the minimap build progress. Every wait on the network will be announced
 * here too, with a cancel (D10).
 */
export function StatusBar() {
  const state = useStore(workspaceStore);
  const diff = useStore(diffStore);
  // Subscribed for the nudge; the document itself is the truth.
  useStore(editStore);
  const active = state.panes[state.activePane];
  const hasHandle = active?.file.handle !== undefined;
  const verb = saveVerb(state.capabilities, hasHandle);

  return (
    <footer className="status-bar">
      {state.problem === undefined ? (
        <span className="status-slot">{fileSummary(state)}</span>
      ) : (
        <span className="status-slot status-slot-problem">{state.problem}</span>
      )}

      <span className="status-divider" />
      <span className="status-slot status-slot-diff">{comparisonSummary(diff)}</span>

      <span className="status-spacer" />
      <span
        className="status-slot status-slot-muted"
        title={saveExplanation(state.capabilities, hasHandle)}
      >
        {verb === "Save" ? "Saves in place" : "Saves by downloading a copy"}
      </span>
      <span className="status-slot status-slot-muted">Files never leave this machine</span>
    </footer>
  );
}

function fileSummary(state: ReturnType<typeof workspaceStore.getSnapshot>): string {
  const a = state.panes.a;
  const b = state.panes.b;
  if (a === undefined && b === undefined) return "No file open";
  const parts = [a, b]
    .filter((pane): pane is NonNullable<typeof pane> => pane !== undefined)
    .map((pane) => `${pane.name} · ${pane.document.size.toLocaleString()} bytes`);
  return parts.join("   ");
}

/**
 * The summary a bench actually reads.
 *
 * "Identical" is its own sentence rather than "0 differing", because that is
 * the answer the whole application exists to give and it should not have to be
 * inferred from a zero.
 */
function comparisonSummary(diff: ReturnType<typeof diffStore.getSnapshot>): string {
  switch (diff.status) {
    case "idle":
      return "";
    case "scanning":
      return `Comparing… ${Math.round(diff.progress * 100)}%`;
    case "failed":
      return diff.problem ?? "The comparison failed.";
    case "ready":
      return diff.differingBytes === 0
        ? `Identical · ${diff.sameBytes.toLocaleString()} bytes`
        : `${diff.differingBytes.toLocaleString()} differing · ${diff.sameBytes.toLocaleString()} same`;
  }
}
