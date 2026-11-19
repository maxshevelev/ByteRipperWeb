import { useEffect, useId, useState } from "react";
import { hexNumber } from "@/core/hexText/hexText";
import { L } from "@/core/localization/localization";
import { AddressField } from "@/ui/controls/AddressField";
import { addressValue, recordAddressInHistory } from "@/ui/controls/addressEvaluation";
import { Dialog } from "@/ui/dialogs/Dialog";
import {
  type SelectBlockField,
  type SelectBlockLine,
  type SelectBlockMode,
  selectBlockModeSwitched,
  selectBlockNote,
  selectBlockStartError,
  selectBlockTyped,
  validateSelectBlock,
} from "@/ui/dialogs/selectBlock";

/**
 * Select Block (§10.2).
 *
 * Two ways to say the same range, because both are how people have the number
 * to hand: an end address, read off another tool's output, or a length, read
 * off a datasheet. The option that is not active keeps its text, so switching
 * back and forth costs nothing.
 *
 * Each field is the app's address field (`AddressField`), so each takes a sum
 * as well as a number, and the sum being typed is read back on the message's
 * line (issue #9). The checks are `selectBlock.ts`'s.
 *
 * **End is the block's last byte, and the conversion happens here.** Inside the
 * application a range is half-open `[start, end)`; a person reading a dump
 * means "up to and including that address", and every tool they came from means
 * that too. This is the edge the rule names.
 *
 * Reached from the dump's right-click menu with the clicked address already in
 * Start, in which case the length is the only thing left to say and the keyboard
 * starts there.
 */

export interface SelectBlockDialogProps {
  readonly open: boolean;
  readonly fileSize: number;
  /** Pre-fills Start — a right-click brought the address with it. */
  readonly presetStart?: number | undefined;
  readonly onSelect: (start: number, end: number) => void;
  readonly onClose: () => void;
}

/** Nothing typed yet, nothing wrong yet. */
const QUIET_LINE: SelectBlockLine = { lastEdited: undefined, error: undefined };

/**
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.startField
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.endField
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.lengthField
 * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.addAddressRow
 */
export function SelectBlockDialog({
  open,
  fileSize,
  presetStart,
  onSelect,
  onClose,
}: SelectBlockDialogProps) {
  const [start, setStart] = useState("0x");
  const [end, setEnd] = useState("0x");
  const [length, setLength] = useState("0x");
  const [mode, setMode] = useState<SelectBlockMode>("end");
  /**
   * The message's line: the error last found, or the field whose sum it reads
   * back. Updated as a key is typed or the option switched, as upstream's is —
   * not on every render, so switching the option over a field nobody has
   * typed in raises no error of its own.
   *
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.errorLabel
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.noteLabel
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.showError
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.showNote
   */
  const [line, setLine] = useState<SelectBlockLine>(QUIET_LINE);
  const group = useId();

  useEffect(() => {
    if (!open) return;
    // A preset past 4 GB comes into the field whole.
    setStart(presetStart === undefined ? "0x" : hexNumber(presetStart));
    setEnd("0x");
    setLength("0x");
    // With the start already filled in, the length is the user's job, so that
    // is the active option and the field the keyboard lands in.
    setMode(presetStart === undefined ? "end" : "length");
    setLine(QUIET_LINE);
  }, [open, presetStart]);

  const form = { start, end, length, mode, fileSize };

  /** @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.updateLiveError */
  const type = (field: SelectBlockField, text: string) => {
    const next = { ...form, [field]: text };
    if (field === "start") setStart(text);
    else if (field === "end") setEnd(text);
    else setLength(text);
    setLine(selectBlockTyped(next, field));
  };

  /** @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.modeRadioChanged */
  const choose = (next: SelectBlockMode) => {
    setMode(next);
    setLine((current) => selectBlockModeSwitched({ ...form, mode: next }, current));
  };

  /** Shown on the line: an error, never with the sum read back beside it. */
  const showError = (message: string) => setLine((current) => ({ ...current, error: message }));

  /**
   * A sum the selection was made from goes into the fields' list, so it can be
   * picked again and corrected — the start last, so it is the entry the list
   * opens on. A plain number does not: the list would fill with every length
   * ever typed.
   *
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.keepSums
   */
  const keepSums = (texts: readonly string[]) => {
    for (const text of [...texts].reverse()) recordAddressInHistory(text);
  };

  /**
   * OK refuses with what is wrong, named on the line — an unfinished sum among
   * it, which the line waited on while it was typed.
   *
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.validate
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.handleSubmit
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.validate
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.onSubmit
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.handleSubmit
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.submitPressed
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SheetViewController.submitButton
   */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateSelectBlock(form);
    const startValue = addressValue(start);
    if (problem !== undefined || startValue === undefined) {
      showError(problem ?? L("Invalid start offset."));
      return;
    }
    if (mode === "end") {
      const endValue = addressValue(end);
      if (endValue === undefined) return;
      keepSums([start, end]);
      // The inclusive end becomes the half-open one, here and nowhere else.
      onSelect(startValue, Math.min(endValue + 1, fileSize));
    } else {
      const count = addressValue(length);
      if (count === undefined) return;
      keepSums([start, length]);
      onSelect(startValue, Math.min(startValue + count, fileSize));
    }
    onClose();
  };

  /**
   * The two boundary shortcuts read the Start field and nothing else, and refuse
   * with what is wrong in it.
   *
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.toBeginningButton
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.toEndButton
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.toBeginningPressed
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.toEndPressed
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.submitToBeginning
   * @upstream ByteRipperApp/Documents/SheetControllers.swift#SelectBlockSheetController.submitToEnd
   */
  const toBoundary = (which: "beginning" | "end") => {
    const problem = selectBlockStartError(form);
    const startValue = addressValue(start);
    if (problem !== undefined || startValue === undefined) {
      showError(problem ?? L("Invalid start offset."));
      return;
    }
    recordAddressInHistory(start);
    if (which === "beginning") onSelect(0, startValue);
    else onSelect(startValue, fileSize);
    onClose();
  };

  const note = line.error === undefined ? selectBlockNote(form, line.lastEdited) : undefined;

  return (
    <Dialog open={open} title={L("Select Block")} onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        {presetStart === undefined ? (
          <p className="dialog-help">
            {L("Select a byte range by absolute offsets. End is the block's last byte.")}
          </p>
        ) : null}

        <div className="dialog-field">
          {L("Start")}
          <AddressField
            autoFocus={presetStart === undefined}
            value={start}
            onChange={(text) => type("start", text)}
            aria-label={L("Start")}
          />
        </div>

        <div className="dialog-field is-radio">
          <label className="dialog-radio">
            <input
              type="radio"
              name={group}
              checked={mode === "end"}
              onChange={() => choose("end")}
            />
            {L("End")}
          </label>
          <AddressField
            value={end}
            disabled={mode !== "end"}
            onChange={(text) => type("end", text)}
            aria-label={L("End offset")}
          />
        </div>

        <div className="dialog-field is-radio">
          <label className="dialog-radio">
            <input
              type="radio"
              name={group}
              checked={mode === "length"}
              onChange={() => choose("length")}
            />
            {L("Length")}
          </label>
          <AddressField
            autoFocus={presetStart !== undefined}
            value={length}
            disabled={mode !== "length"}
            onChange={(text) => type("length", text)}
            aria-label={L("Length")}
          />
        </div>

        {/* One line for the error, the sum read back, or how to type a number:
            never two of them at once. */}
        <p className="dialog-help" aria-live="polite">
          {line.error !== undefined ? (
            line.error
          ) : note !== undefined ? (
            <span className="address-breakdown">{note}</span>
          ) : (
            L("Decimal, or hex as 1F or 0x1F.")
          )}
        </p>

        <div className="dialog-actions">
          <button
            type="button"
            className="toolbar-button"
            onClick={() => toBoundary("beginning")}
            title={L("Select from the file's start to the position above")}
          >
            {L("To Beginning")}
          </button>
          <button
            type="button"
            className="toolbar-button"
            onClick={() => toBoundary("end")}
            title={L("Select from the position above to the file's end")}
          >
            {L("To End")}
          </button>
          <span className="toolbar-spacer" />
          <button type="button" className="toolbar-button" onClick={onClose}>
            {L("Cancel")}
          </button>
          <button type="submit" className="toolbar-button">
            {L("Select")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
