import { useEffect, useState } from "react";
import { hexAddress } from "@/core/text/hexText";
import { parseOffset } from "@/core/text/offsetParser";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * Add Cut / Split Here (§21.3).
 *
 * A cut is an offset and, optionally, a name for the piece that starts there —
 * which is the piece the cut creates, not the one it ends. Upstream shows this
 * as a popover hanging off the byte; a browser has no popover worth the
 * machinery, and the offset is in the title, which says the same thing.
 *
 * The offset is validated as it is typed, against the two ways a cut can be
 * impossible: outside the file, or exactly where one already is.
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

  useEffect(() => {
    if (!open) return;
    setText(`0x${hexAddress(presetOffset)}`);
    setName("");
  }, [open, presetOffset]);

  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.offsetField */
  const parsed = text.trim() === "" ? undefined : parseOffset(text);
  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.editedOffset */
  const value = parsed?.ok === true ? parsed.value : undefined;
  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.controlTextDidChange */
  const problem =
    parsed === undefined
      ? "Type the offset the new piece starts at."
      : !parsed.ok
        ? "Type a decimal number, or hex as 1F or 0x1F."
        : value === undefined || value <= 0 || value >= fileSize
          ? "A cut has to fall inside the file, past its first byte."
          : existingCuts.includes(value)
            ? "There is already a cut there."
            : undefined;

  /** @upstream ByteRipperApp/Segments/CutEditPopover.swift#CutEditPopoverController.commit */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (value === undefined || problem !== undefined) return;
    onCut(value, name.trim());
    onClose();
  };

  return (
    <Dialog open={open} title="Add a cut" onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <label className="dialog-field">
          Cut at
          <input
            autoFocus={open}
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="dialog-field">
          Name the piece that starts there
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Optional"
            spellCheck={false}
          />
        </label>
        <p className="dialog-help">{problem ?? "The piece before the cut keeps its own name."}</p>
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="toolbar-button" disabled={problem !== undefined}>
            Cut
          </button>
        </div>
      </form>
    </Dialog>
  );
}
