import { editStore } from "@/state/editStore";
import { useStore } from "@/state/useStore";
import {
  closePart,
  type PartId,
  partPane,
  raisePart,
  togglePart,
  workspaceStore,
} from "@/state/workspaceStore";
import { type DockItem, FragmentDockStrip } from "@/ui/fragments/FragmentDockStrip";
import { FragmentPanel, FragmentPanelHost } from "@/ui/fragments/FragmentPanelView";
import { HexPane } from "@/ui/pane/HexPane";

/**
 * The workspace's fragment panels: the dock of pills, and the one panel that is
 * up over the panes (`Design/GAPS.md` G48).
 *
 * It is a fragment of two grid items rather than one box, because the two
 * belong in different rows of the shell: the panel lies over the panes, the
 * dock takes a row of its own under them.
 *
 * What is *not* here is anything about the part's own life — which bytes it
 * holds, where they came from, what closing it should ask. That is the store's
 * (`openPart` and its neighbours), and the asking is G49's.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels
 */
export function FragmentPanels() {
  const state = useStore(workspaceStore);
  // The pill's dot is the part's own dirtiness, which the workspace store does
  // not change for — that is exactly what this tick is for.
  useStore(editStore);

  // Brings the pills in line with what the panels hold: names, the one that is
  // up, and which of them have bytes the parent has not got back.
  //
  // @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.refreshDock
  const items: DockItem[] = state.dock.panels.map((id) => ({
    id,
    title: state.parts[partPane(id)]?.name ?? "",
    isUp: state.dock.expanded === id,
    // Upstream asks the origin whether the parent has the bytes back; until the
    // link exists (G4) the part's own unsaved work is the honest answer, which
    // is upstream's own fallback.
    hasChanges: state.parts[partPane(id)]?.document.isDirty ?? false,
  }));
  if (items.length === 0) return null;

  const up = state.dock.expanded;
  const pane: PartId | undefined = up === undefined ? undefined : partPane(up);
  const part = pane === undefined ? undefined : state.parts[pane];

  return (
    <>
      {pane !== undefined && part !== undefined ? (
        <FragmentPanelHost>
          <FragmentPanel>
            <HexPane
              key={pane}
              paneId={pane}
              // The part's own name is all the header has to say: there is no
              // slot to name, and the panel is the only place it can be.
              label={part.name}
              name={part.name}
              document={part.document}
              typing={part.typing}
              wordSize={state.wordSize}
              // The panel in front is the pane in front: it is the only one in
              // it. Which commands that pulls with it is G49's.
              isActive
              onActivate={() => raisePart(pane)}
              onClose={() => closePart(pane)}
            />
          </FragmentPanel>
        </FragmentPanelHost>
      ) : null}
      <FragmentDockStrip
        items={items}
        onSelect={(id) => togglePart(partPane(id))}
        onClose={(id) => closePart(partPane(id))}
      />
    </>
  );
}
