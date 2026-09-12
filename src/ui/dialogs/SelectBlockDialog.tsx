import { useEffect, useId, useState } from "react";
import { parseOffset } from "@/core/text/offsetParser";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * Select Block (§10.2).
 *
 * Two ways to say the same range, because both are how people have the number
 * to hand: an end address, read off another tool's output, or a length, read
 * off a datasheet. The option that is not active keeps its text, so switching
 * back and forth costs nothing.
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

type Mode = "end" | "length";

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

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
  const [mode, setMode] = useState<Mode>("end");
  const group = useId();

  useEffect(() => {
    if (!open) return;
    setStart(presetStart === undefined ? "0x" : hex(presetStart));
    setEnd("0x");
    setLength("0x");
    // With the start already filled in, the length is the user's job, so that
    // is the active option and the field the keyboard lands in.
    setMode(presetStart === undefined ? "end" : "length");
  }, [open, presetStart]);

  const startValue = offsetIn(start);
  const problem = validate();

  function validate(): string | undefined {
    if (startValue === undefined) return "That start offset could not be read.";
    if (startValue > fileSize) return "The start is past the end of the file.";
    if (mode === "end") {
      const endValue = offsetIn(end);
      if (endValue === undefined) return "That end offset could not be read.";
      if (startValue > endValue) return "The start must not come after the end.";
      // End names the last byte, so it has to be a byte the file holds.
      if (endValue >= fileSize) return `This file ends at ${hex(fileSize - 1)}.`;
      return undefined;
    }
    if (offsetIn(length) === undefined) return "That length could not be read.";
    return undefined;
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (problem !== undefined || startValue === undefined) return;
    if (mode === "end") {
      const endValue = offsetIn(end);
      if (endValue === undefined) return;
      // The inclusive end becomes the half-open one, here and nowhere else.
      onSelect(startValue, Math.min(endValue + 1, fileSize));
    } else {
      const count = offsetIn(length);
      if (count === undefined) return;
      onSelect(startValue, Math.min(startValue + count, fileSize));
    }
    onClose();
  };

  /** The two boundary shortcuts read the Start field and nothing else. */
  const toBoundary = (which: "beginning" | "end") => {
    if (startValue === undefined || startValue > fileSize) return;
    if (which === "beginning") onSelect(0, startValue);
    else onSelect(startValue, fileSize);
    onClose();
  };

  const startBad = startValue === undefined || startValue > fileSize;

  return (
    <Dialog open={open} title="Select block" onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        {presetStart === undefined ? (
          <p className="dialog-help">
            Select a byte range by absolute offsets. End is the block's last byte.
          </p>
        ) : null}

        <label className="dialog-field">
          Start
          <input
            autoFocus={presetStart === undefined}
            value={start}
            onChange={(event) => setStart(event.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="dialog-field is-radio">
          <label className="dialog-radio">
            <input
              type="radio"
              name={group}
              checked={mode === "end"}
              onChange={() => setMode("end")}
            />
            End
          </label>
          <input
            value={end}
            disabled={mode !== "end"}
            onChange={(event) => setEnd(event.target.value)}
            spellCheck={false}
            aria-label="End offset"
          />
        </div>

        <div className="dialog-field is-radio">
          <label className="dialog-radio">
            <input
              type="radio"
              name={group}
              checked={mode === "length"}
              onChange={() => setMode("length")}
            />
            Length
          </label>
          <input
            autoFocus={presetStart !== undefined}
            value={length}
            disabled={mode !== "length"}
            onChange={(event) => setLength(event.target.value)}
            spellCheck={false}
            aria-label="Length"
          />
        </div>

        <p className="dialog-help">{problem ?? "Decimal, or hex as 1F or 0x1F."}</p>

        <div className="dialog-actions">
          <button
            type="button"
            className="toolbar-button"
            disabled={startBad}
            onClick={() => toBoundary("beginning")}
            title="Select from the file's start to the position above"
          >
            To Beginning
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={startBad}
            onClick={() => toBoundary("end")}
            title="Select from the position above to the file's end"
          >
            To End
          </button>
          <span className="toolbar-spacer" />
          <button type="button" className="toolbar-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="toolbar-button" disabled={problem !== undefined}>
            Select
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** An empty field is not a zero: it is nothing yet, and nothing is not valid. */
function offsetIn(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "0x" || trimmed === "0X") return undefined;
  const parsed = parseOffset(trimmed);
  return parsed.ok ? parsed.value : undefined;
}
