import { useEffect, useRef, useState } from "react";
import { L } from "@/core/localization/localization";
import { friendlySize } from "@/core/text/byteSize";
import { strandingSentence } from "@/state/partUpdate";
import type { PaneLayout, SlotId } from "@/state/workspaceStore";
import { Dialog } from "@/ui/dialogs/Dialog";

/** What the dialog shows of one pane: the file it holds and what replacing it would cost. */
export interface PaneChoice {
  readonly slot: SlotId;
  readonly name: string;
  readonly size: number;
  /** It holds edits not yet saved, which replacing it throws away. */
  readonly dirty: boolean;
  /** How many fragment panels were opened out of it, which lose their way back. */
  readonly linkedParts: number;
}

/**
 * Which pane gives way to a file that has to open while both hold one: the window drawn small,
 * the panes where they are on screen — side by side or one above the other — each with the file it
 * holds, whether it has unsaved edits, and the panels taken out of it. A pane is chosen by a click
 * on it; the chosen one shows the file going and the file coming, and the button says what it
 * does, so what is lost is read before it is lost and asked about once.
 *
 * @web-only upstream opens the file in a tab of its own; the web has two panes and no tabs
 */
export function PaneChoiceDialog({
  incoming,
  layout,
  panes,
  onChoose,
  onCancel,
}: {
  /** The file to open, or `undefined` while nothing is asked. */
  readonly incoming: string | undefined;
  readonly layout: PaneLayout;
  readonly panes: readonly PaneChoice[];
  readonly onChoose: (slot: SlotId) => void;
  readonly onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<SlotId | undefined>(undefined);

  const cancel = useRef<HTMLButtonElement | null>(null);

  // The focus starts on Cancel, not on the first pane: `showModal` would put it on the first tile,
  // whose ring reads as a pane already chosen when none is. The dialog's own effect, a child's,
  // has opened it by the time this runs.
  useEffect(() => {
    if (incoming === undefined) return;
    setChosen(undefined);
    cancel.current?.focus();
  }, [incoming]);

  const picked = panes.find((one) => one.slot === chosen);
  const confirmLabel =
    picked?.dirty === true
      ? L("Replace and Discard Edits")
      : picked !== undefined && picked.linkedParts > 0
        ? picked.linkedParts === 1
          ? L("Replace and Break Link")
          : L("Replace and Break Links")
        : L("Open Here");
  const destructive = picked !== undefined && (picked.dirty || picked.linkedParts > 0);

  return (
    <Dialog
      open={incoming !== undefined}
      title={L("Where should “%1$@” open?", incoming ?? "")}
      onClose={onCancel}
      className="pane-choice-dialog"
    >
      <div className="dialog-body">
        <p className="dialog-message">
          {L(
            "Both panes hold a file. Choose the pane “%1$@” opens in; the file there is closed.",
            incoming ?? ""
          )}
        </p>
        <div
          className={`pane-choice-window is-${layout}`}
          role="radiogroup"
          aria-label={L("Panes")}
        >
          {panes.map((pane) => {
            const isChosen = pane.slot === chosen;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a pane drawn as a tile is the radio, not a dot beside a label
              <button
                key={pane.slot}
                type="button"
                role="radio"
                aria-checked={isChosen}
                className={`pane-choice${isChosen ? " is-chosen" : ""}`}
                onClick={() => setChosen(pane.slot)}
              >
                <span className={`pane-choice-name${isChosen ? " is-leaving" : ""}`}>
                  {pane.name}
                </span>
                <span className="pane-choice-size">{friendlySize(pane.size)}</span>
                <span className={`pane-choice-state${pane.dirty ? " is-bad" : ""}`}>
                  {pane.dirty ? `● ${L("Unsaved changes")}` : L("No unsaved changes")}
                </span>
                {pane.linkedParts > 0 ? (
                  <span className="pane-choice-state is-caution">
                    {strandingSentence(pane.linkedParts)}
                  </span>
                ) : null}
                {isChosen ? (
                  <span className="pane-choice-incoming">
                    <span aria-hidden="true">↓ </span>
                    {incoming}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {picked?.dirty === true ? (
          <p className="pane-choice-warning">
            {L("The unsaved changes in “%1$@” are lost.", picked.name)}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button ref={cancel} type="button" className="toolbar-button" onClick={onCancel}>
            {L("Cancel")}
          </button>
          <button
            type="button"
            className={destructive ? "toolbar-button is-destructive" : "toolbar-button"}
            disabled={picked === undefined}
            onClick={() => {
              if (picked !== undefined) onChoose(picked.slot);
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
