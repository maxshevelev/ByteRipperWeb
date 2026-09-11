import { useEffect, useState } from "react";
import { parseOffset } from "@/core/text/offsetParser";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * Go To Position.
 *
 * The parser is `src/core/text/offsetParser.ts`, which already knows every
 * spelling this accepts and refuses — `0x1F`, `1F`, `4096` — and refuses a
 * value too large to address rather than rounding it into a different offset.
 * The dialog's job is only to say so before the user presses Return.
 */
export interface GoToDialogProps {
  readonly open: boolean;
  readonly fileSize: number;
  readonly onGo: (offset: number) => void;
  readonly onClose: () => void;
}

export function GoToDialog({ open, fileSize, onGo, onClose }: GoToDialogProps) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const parsed = text.trim() === "" ? undefined : parseOffset(text);
  const problem =
    parsed === undefined
      ? undefined
      : !parsed.ok
        ? parsed.reason === "outOfRange"
          ? "That number is too large to be an offset."
          : "Type a decimal number, or hex as 1F or 0x1F."
        : parsed.value > fileSize
          ? `This file ends at 0x${fileSize.toString(16).toUpperCase()}.`
          : undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (parsed === undefined || !parsed.ok || problem !== undefined) return;
    onGo(parsed.value);
    onClose();
  };

  return (
    <Dialog open={open} title="Go to position" onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <label className="dialog-field">
          Offset
          {/* A modal opened by a shortcut exists to be typed into, and the
              dialog's own focus trap keeps the focus contained. */}
          <input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="0x1000"
            inputMode="text"
            spellCheck={false}
            aria-describedby="goto-help"
          />
        </label>
        <p className="dialog-help" id="goto-help">
          {problem ?? "Decimal, or hex as 1F or 0x1F."}
        </p>
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="toolbar-button"
            disabled={parsed === undefined || !parsed.ok || problem !== undefined}
          >
            Go
          </button>
        </div>
      </form>
    </Dialog>
  );
}
