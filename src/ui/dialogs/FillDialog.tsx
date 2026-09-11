import { useEffect, useState } from "react";
import { formatHex, parseHex } from "@/core/text/hexText";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * Fill Selection.
 *
 * The pattern is read by the same parser the clipboard uses, so `DE AD`,
 * `DEAD` and `0xDE 0xAD` all mean the same thing — and prose does not quietly
 * mean a byte.
 */
export interface FillDialogProps {
  readonly open: boolean;
  /** How many bytes the fill would cover, for the sentence that says so. */
  readonly byteCount: number;
  readonly onFill: (pattern: Uint8Array) => void;
  readonly onClose: () => void;
}

export function FillDialog({ open, byteCount, onFill, onClose }: FillDialogProps) {
  const [text, setText] = useState("00");

  useEffect(() => {
    if (open) setText("00");
  }, [open]);

  const pattern = parseHex(text);
  const preview =
    pattern === undefined || byteCount === 0
      ? undefined
      : formatHex(
          new Uint8Array(Math.min(byteCount, 16)).map((_, i) => pattern[i % pattern.length] ?? 0)
        );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pattern === undefined) return;
    onFill(pattern);
    onClose();
  };

  return (
    <Dialog open={open} title="Fill selection" onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <label className="dialog-field">
          Pattern
          <input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="00"
            spellCheck={false}
            aria-describedby="fill-help"
          />
        </label>
        <p className="dialog-help" id="fill-help">
          {pattern === undefined
            ? "Hexadecimal byte pairs: 00, DE AD, or 0xDE 0xAD."
            : `Repeated across ${byteCount.toLocaleString()} ${byteCount === 1 ? "byte" : "bytes"}.`}
        </p>
        {preview === undefined ? null : <pre className="dialog-preview">{preview}…</pre>}
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="toolbar-button" disabled={pattern === undefined}>
            Fill
          </button>
        </div>
      </form>
    </Dialog>
  );
}
