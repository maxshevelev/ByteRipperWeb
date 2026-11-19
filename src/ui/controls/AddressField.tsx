import {
  type InputHTMLAttributes,
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { L } from "@/core/localization/localization";
import { recentAddressEntries } from "@/state/addressHistoryStore";
import {
  type AddressHistoryRow,
  addressHistoryRows,
  addressResultText,
} from "@/ui/controls/addressEvaluation";
import { CaretAtEndInput } from "@/ui/controls/CaretAtEndInput";

/**
 * The one field an address or a length is typed in (issue #9): Go To, Select
 * Block, a bookmark's address, a cut's.
 *
 * It takes a number as it always did, and a sum — `0x1FE000 + 4096` — where
 * the number is still arithmetic (`offsetExpression.ts`). What was typed is
 * never rewritten: the sum stays in the field to be read again and corrected,
 * and what it comes to is drawn beside it, at the field's right edge, in
 * heavier type — **that** is the number the form acts on. A lone number typed
 * without its `0x` gets the same treatment, because `40` and `0x40` are the
 * mistake this field exists to make visible.
 *
 * At the right edge is the list of what was typed before
 * (`addressHistoryStore.ts`), also under **↓**. Picking an entry only fills the
 * field; acting on it is still the form's own key.
 *
 * The field does not select its whole text when the keyboard focuses it: the
 * caret lands after the text, so a field that opens as `0x` is ready for hex
 * digits (§10), and one that opens with an address is ready for `+ 0x40`.
 *
 * What the text comes to is read through `addressEvaluation.ts`, by the form as by
 * the field.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.historyButton
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.resultLabel
 * @upstream-differs an input with the result and the arrow laid over its right edge, and the list as a listbox under it, where upstream narrows an NSTextFieldCell and pops up an NSMenu
 */
export interface AddressFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "ref"> {
  readonly value: string;
  /** Every edit: typing, deleting, an entry picked from the list. */
  readonly onChange: (text: string) => void;
  /** The form refuses what the field holds: its digits turn red, and the result with them. */
  readonly invalid?: boolean | undefined;
  /**
   * Return pressed in the field with its list away — before the form's own
   * submit, which it does not stop. A form that waits for an unfinished sum
   * while it is typed names it now.
   */
  readonly onReturn?: (() => void) | undefined;
  readonly ref?: Ref<HTMLInputElement> | undefined;
  /** For the field's wrapper; the input's own is `inputClassName`. */
  readonly className?: string | undefined;
  readonly inputClassName?: string | undefined;
}

// help: editing.address-arithmetic
export function AddressField({
  value,
  onChange,
  invalid = false,
  onReturn,
  ref,
  className,
  inputClassName,
  disabled = false,
  onKeyDown,
  onBlur,
  ...input
}: AddressFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      inputRef.current = element;
      if (typeof ref === "function") ref(element);
      else if (ref !== null && ref !== undefined) ref.current = element;
    },
    [ref]
  );
  const listId = useId();
  /** The list as it was read when it dropped down, and the row under the highlight. */
  const [rows, setRows] = useState<readonly AddressHistoryRow[] | undefined>(undefined);
  const [active, setActive] = useState(-1);
  const open = rows !== undefined;
  const rootRef = useRef<HTMLDivElement | null>(null);

  /** @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.resultText */
  const result = addressResultText(value);

  /**
   * The text stops short of the result and the arrow, so a long sum scrolls
   * beside the result rather than under it. Measured as the result changes, and
   * at once rather than a frame later: the field has to make room before the
   * next key lands.
   *
   * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.layout
   */
  const resultRef = useRef<HTMLSpanElement | null>(null);
  const [resultWidth, setResultWidth] = useState(0);
  useLayoutEffect(() => {
    setResultWidth(result === "" ? 0 : (resultRef.current?.offsetWidth ?? 0));
  }, [result]);

  const close = useCallback(() => {
    setRows(undefined);
    setActive(-1);
  }, []);

  /**
   * The list of recent entries, each row a sum with what it comes to, or an
   * address. Read when it drops down: another form, or another tab, may have
   * added to it since.
   *
   * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.showHistory
   * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.presentHistory
   */
  const showHistory = (highlight: number) => {
    if (disabled) return;
    const entries = addressHistoryRows(recentAddressEntries());
    setRows(entries);
    setActive(entries.length === 0 ? -1 : highlight);
  };

  // A press anywhere else puts the list away, as a menu does.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && root.contains(event.target)) return;
      close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  /**
   * Fills the field with an entry of the list, as if it had been typed: the form
   * re-validates, nothing is acted on, and **⌘Z** takes it back. The entry goes
   * in as an edit of the field's own — the browser's undo holds it — with the
   * focus brought to the field first, since the list's arrow never takes it.
   *
   * @upstream ByteRipperApp/Controls/AddressField.swift#AddressField.pick
   */
  const pick = (entry: string) => {
    close();
    const field = inputRef.current;
    if (field !== null && !field.disabled) {
      field.focus({ preventScroll: true });
      field.select();
      // The input event it raises is what tells React, and the form, of the edit.
      if (document.execCommand("insertText", false, entry) && field.value === entry) return;
    }
    onChange(entry);
  };

  /**
   * The field's own keys. ↓ drops the list down, as the arrow does — after the
   * form, whose handler runs first and may take the key for itself; while it is
   * up, ↓ and ↑ walk the rows, and Return takes the row under the highlight —
   * and only that, filling the field. With nothing under the highlight, Return
   * is the form's. With the list away, Escape is the form's; with it up, Escape
   * only puts the list away.
   *
   * @upstream ByteRipperApp/Controls/AddressField.swift#AddressFieldEditor
   * @upstream ByteRipperApp/Controls/AddressField.swift#AddressFieldEditor.moveDown
   */
  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    switch (event.key) {
      case "ArrowDown":
        if (!plain) return;
        event.preventDefault();
        if (!open) showHistory(0);
        else if (rows.length > 0) setActive((index) => Math.min(index + 1, rows.length - 1));
        return;
      case "ArrowUp":
        if (!open) return;
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
        return;
      case "Enter": {
        const row = open && active >= 0 ? rows[active] : undefined;
        if (row !== undefined) {
          event.preventDefault();
          pick(row.entry);
          return;
        }
        if (open) {
          // Upstream's list is a menu, which takes Return for itself: with nothing in it chosen,
          // Return only puts it away, and the form is not submitted from under it.
          event.preventDefault();
          event.stopPropagation();
          close();
          return;
        }
        onReturn?.();
        return;
      }
      case "Escape":
        if (!open) return;
        // The list goes away; the form stays — the next Escape is the form's.
        event.preventDefault();
        event.stopPropagation();
        close();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`address-field${className === undefined ? "" : ` ${className}`}`}
      data-invalid={invalid ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
    >
      <CaretAtEndInput
        {...input}
        ref={setInputRef}
        className={inputClassName}
        value={value}
        disabled={disabled}
        // Typing is the field's own business: the list goes away, as a
        // combobox's does while it is typed in.
        onChange={(event) => {
          onChange(event.target.value);
          close();
        }}
        onKeyDown={onFieldKeyDown}
        onBlur={(event) => {
          close();
          onBlur?.(event);
        }}
        aria-invalid={invalid}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="none"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        style={{ paddingRight: `calc(1.5rem + ${resultWidth === 0 ? 4 : resultWidth + 6}px)` }}
      />
      {/* The number the form acts on, read first: the text's own colour — red
          with it when a form refuses the address — in heavier type, behind a
          quiet `=`. Read, never pressed: a press on it is a press on the field. */}
      {result === "" ? null : (
        <span ref={resultRef} className="address-field-result" aria-hidden="true">
          <span className="address-field-equals">=</span>
          {result.slice(1)}
        </span>
      )}
      {/* The arrow at the field's right edge: what says this field has a list.
          Never the focus — the press keeps the caret in the field, so Return
          after a pick still acts from where it was typed. */}
      <button
        type="button"
        className="address-field-arrow"
        tabIndex={-1}
        disabled={disabled}
        aria-hidden="true"
        title={L("Addresses and sums entered before")}
        onPointerDown={(event) => {
          event.preventDefault();
          if (disabled) return;
          if (open) close();
          else {
            inputRef.current?.focus({ preventScroll: true });
            showHistory(-1);
          }
        }}
      >
        ▾
      </button>
      {open ? (
        <div
          id={listId}
          className="menu-popup address-field-popup"
          role="listbox"
          aria-label={L("Addresses and sums entered before")}
        >
          {rows.length === 0 ? (
            <div
              className="address-field-option is-empty"
              tabIndex={-1}
              role="option"
              aria-disabled="true"
              aria-selected={false}
            >
              {L("Nothing entered yet")}
            </div>
          ) : (
            rows.map((row, index) => (
              <div
                key={row.entry}
                id={`${listId}-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={active === index}
                className={`address-field-option${active === index ? " is-active" : ""}`}
                // Chosen on the press, which also keeps the focus in the field;
                // the keyboard walks the rows through the combobox.
                onPointerDown={(event) => {
                  event.preventDefault();
                  pick(row.entry);
                }}
                onPointerEnter={() => setActive(index)}
              >
                {row.entry}
                {row.result === undefined ? null : (
                  <>
                    <span className="address-field-equals"> = </span>
                    <strong>{row.result}</strong>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
