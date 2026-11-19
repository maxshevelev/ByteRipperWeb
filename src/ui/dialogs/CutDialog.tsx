import { useEffect, useState } from "react";
import { hexNumber } from "@/core/hexText/hexText";
import { L } from "@/core/localization/localization";
import { AddressField } from "@/ui/controls/AddressField";
import {
  addressProblemMessage,
  evaluateAddress,
  recordAddressInHistory,
} from "@/ui/controls/addressEvaluation";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * Add Cut / Split Here (§21.3).
 *
 * A cut is an offset and, optionally, a name for the piece that starts there —
 * which is the piece the cut creates, not the one it ends. Upstream shows this
 * as a popover hanging off the byte; a browser has no popover worth the
 * machinery, and the offset is in the title, which says the same thing.
 *
 * The offset is the app's address field (`AddressField`), so it takes a sum as
 * well as a number (issue #9). It is validated as it is typed, against the two
 * ways a cut can be impossible: outside the file, or exactly where one already
 * is. A sum still being typed is not wrong yet: the field waits for the rest,
 * and Return on it names it.
 *
 * The popover says its problems by turning the field red; a dialog with the
 * dump out of sight has to say them in words, so this form's words — the title,
 * the labels, the problems — are its own and carry their own translations
 * (`Cancel` and the sum's are upstream's). The field turns red as well.
 */
export interface CutDialogProps {
  readonly open: boolean;
  readonly fileSize: number;
  /** Where the caret or the right-clicked byte was. */
  readonly presetOffset: number;
  /** The cuts already made, so a duplicate is refused before it is tried. */
  readonly existingCuts: readonly number[];
  readonly onCut: (offset: number, name: string) => void;
  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.cancel */
  readonly onClose: () => void;
}

/**
 * @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.presentCutEditPopover
 * @upstream-differs a dialog, not a popover beside the cut
 */
export function CutDialog({
  open,
  fileSize,
  presetOffset,
  existingCuts,
  onCut,
  onClose,
}: CutDialogProps) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  /** Return was pressed on the text as it stands: an unfinished sum is then wrong. */
  const [acted, setActed] = useState(false);

  useEffect(() => {
    if (!open) return;
    // A prefill past 4 GB comes into the field whole.
    setText(hexNumber(presetOffset));
    setName("");
    setActed(false);
  }, [open, presetOffset]);

  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.offsetField */
  const evaluation = text.trim() === "" ? undefined : evaluateAddress(text);
  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.editedOffset */
  const value = evaluation?.ok === true ? evaluation.value : undefined;
  /**
   * A sum that ends at its operator is not wrong while it is typed. Acted on —
   * Return — it is.
   *
   * @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.updateOffsetValidation
   */
  const waiting = evaluation?.ok === false && evaluation.reason === "incomplete" && !acted;
  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.controlTextDidChange */
  const problem =
    evaluation === undefined
      ? L("Type the offset the new piece starts at.")
      : waiting
        ? undefined
        : !evaluation.ok
          ? (addressProblemMessage(text) ?? L("Type a decimal number, or hex as 1F or 0x1F."))
          : value === undefined || value <= 0 || value >= fileSize
            ? L("A cut has to fall inside the file, past its first byte.")
            : existingCuts.includes(value)
              ? L("There is already a cut there.")
              : undefined;

  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.commit */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (value === undefined || problem !== undefined) return;
    recordAddressInHistory(text);
    onCut(value, name.trim());
    onClose();
  };

  return (
    <Dialog open={open} title={L("Add a cut")} onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <div className="dialog-field">
          {L("Cut at")}
          <AddressField
            autoFocus={open}
            value={text}
            onChange={(next) => {
              setText(next);
              setActed(false);
            }}
            onReturn={() => setActed(true)}
            invalid={problem !== undefined}
            aria-label={L("Cut at")}
          />
        </div>
        <label className="dialog-field">
          {L("Name the piece that starts there")}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={L("Optional")}
            spellCheck={false}
          />
        </label>
        <p className="dialog-help">
          {problem ?? L("The piece before the cut keeps its own name.")}
        </p>
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
            {L("Cancel")}
          </button>
          <button
            type="submit"
            className="toolbar-button"
            disabled={problem !== undefined || value === undefined}
          >
            {L("Cut")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
