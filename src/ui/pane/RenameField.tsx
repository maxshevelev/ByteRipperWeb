import { useEffect, useRef } from "react";

/**
 * The header's name as a field, in the place the name was: the name is changed
 * where it is read rather than in a dialog raised to hold one short string.
 *
 * It opens holding the name the header showed, all of it selected. Return
 * takes what was typed, Escape leaves the name as it was, and clicking away
 * takes it too — losing what was typed to a stray click is the worse surprise.
 * The model refuses a name of nothing, so a field closed by accident cannot
 * blank the header.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.beginRenaming
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.endRenaming
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.controlTextDidEndEditing
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.control
 * @upstream-differs an input element in the header; closing it is reported once, however it closed
 */
export function RenameField({
  name,
  onEnd,
}: {
  readonly name: string;
  readonly onEnd: (typed: string, commit: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Closing takes the field away, which blurs it — and a blur is a commit. The
  // first way it closed is the one that counts.
  const ended = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const end = (commit: boolean) => {
    if (ended.current) return;
    ended.current = true;
    onEnd(ref.current?.value ?? name, commit);
  };

  return (
    <input
      ref={ref}
      className="pane-name-field"
      defaultValue={name}
      aria-label="File name"
      spellCheck={false}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          end(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          end(false);
        }
      }}
      onBlur={() => end(true)}
    />
  );
}
