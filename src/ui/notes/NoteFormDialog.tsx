import { useEffect, useRef, useState } from "react";
import { L } from "@/core/localization/localization";
import { MAX_NOTE, MAX_TITLE } from "@/state/agent/agentAnnotationTools";
import { closeNoteForm, noteFormStore } from "@/state/noteFormStore";
import { useStore } from "@/state/useStore";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * What Add Annotation… and Edit Annotation ask for: a title, and a note under it. The title and
 * the note are trimmed and cut to what an annotation holds; an empty title asks for nothing.
 *
 * @upstream ByteRipperApp/Notes/MainViewController+Notes.swift#NoteForm
 * @upstream ByteRipperApp/Notes/MainViewController+Notes.swift#NoteForm.values
 */
export function NoteFormDialog() {
  const request = useStore(noteFormStore);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (request === undefined) return;
    setTitle(request.title);
    setNote(request.note);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [request]);

  const submit = () => {
    if (request === undefined) return;
    const done = request.done;
    const trimmedTitle = [...title.trim()].slice(0, MAX_TITLE).join("");
    const trimmedNote = [...note.trim()].slice(0, MAX_NOTE).join("");
    closeNoteForm();
    if (trimmedTitle !== "") done(trimmedTitle, trimmedNote);
  };

  return (
    <Dialog open={request !== undefined} title={request?.message ?? ""} onClose={closeNoteForm}>
      <form
        className="dialog-body note-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="dialog-message">{request?.information ?? ""}</p>
        <input
          ref={titleRef}
          className="note-form-title"
          value={title}
          placeholder={L("Title")}
          aria-label={L("Title")}
          maxLength={MAX_TITLE}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <textarea
          className="note-form-note"
          value={note}
          rows={5}
          aria-label={L("Note")}
          onChange={(event) => setNote(event.currentTarget.value)}
        />
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={closeNoteForm}>
            {L("Cancel")}
          </button>
          <button type="submit" className="toolbar-button" disabled={title.trim() === ""}>
            {request?.button ?? ""}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
