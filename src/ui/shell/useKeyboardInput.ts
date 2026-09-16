import { useEffect, useState } from "react";

/**
 * Whether the last input came from the keyboard.
 *
 * Every other ring in the app is `:focus-visible`, which is the browser saying
 * the same thing, and for a `<button>` it says it right — a click on one leaves
 * no ring. A `<select>` is where that stops being true: a select is operated
 * with the keyboard, so Chromium marks one focus-visible however it was focused,
 * and a tap would draw a ring no other control in the app draws. So the controls
 * that are selects ask here instead, and draw their ring only while the answer
 * is the keyboard's — alongside `:focus-visible`, which is what says the field
 * really is focused.
 *
 * The listeners are on the capture phase so nothing can stop them: this is about
 * what the user did, not about what the focused field made of it.
 *
 * @web-only there is no such question in AppKit: the system decides whether a
 * focus ring is drawn, and a web page has to be told
 */
export function useKeyboardInput(): boolean {
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const fromKeyboard = () => setKeyboard(true);
    const fromPointer = () => setKeyboard(false);
    window.addEventListener("keydown", fromKeyboard, true);
    window.addEventListener("pointerdown", fromPointer, true);
    return () => {
      window.removeEventListener("keydown", fromKeyboard, true);
      window.removeEventListener("pointerdown", fromPointer, true);
    };
  }, []);
  return keyboard;
}
