import { type InputHTMLAttributes, type Ref, useRef } from "react";

/**
 * A text field that does not select its whole text when the keyboard brings
 * the focus to it: the caret lands after the text, so what the field offers
 * can be added to as well as replaced. A browser's default, on Tab, is to
 * select it all — which would have the first digit typed replace the `0x` a
 * field opens with. A press in the field still puts the caret where it was
 * pressed.
 *
 * The one copy of that focus behaviour: the address field (`AddressField`) and
 * the Fill dialog's byte field both are one of these.
 *
 * @upstream ByteRipperApp/Controls/CaretAtEndTextField.swift#CaretAtEndTextField
 * @upstream ByteRipperApp/Controls/CaretAtEndTextField.swift#CaretAtEndTextField.becomeFirstResponder
 */
export function CaretAtEndInput({
  ref,
  onFocus,
  onBlur,
  onPointerDown,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { readonly ref?: Ref<HTMLInputElement> | undefined }) {
  /** A press is about to focus the field, and places the caret itself. */
  const pressed = useRef(false);
  return (
    <input
      ref={ref}
      {...input}
      onPointerDown={(event) => {
        pressed.current = true;
        onPointerDown?.(event);
      }}
      onFocus={(event) => {
        const field = event.currentTarget;
        if (!pressed.current) {
          const end = field.value.length;
          // After the browser's own select-all on a keyboard focus.
          requestAnimationFrame(() => {
            if (document.activeElement === field) field.setSelectionRange(end, end);
          });
        }
        pressed.current = false;
        onFocus?.(event);
      }}
      onBlur={(event) => {
        // A press in a field that already had the focus focused nothing.
        pressed.current = false;
        onBlur?.(event);
      }}
    />
  );
}
