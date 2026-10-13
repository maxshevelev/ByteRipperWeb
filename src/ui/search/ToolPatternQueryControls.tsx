import { useEffect, useId, useRef } from "react";
import { noteToolPatternFound, toolPatternAttempts } from "@/state/searchStore";
import type { ToolPatternQuery } from "@/tools/toolModule";
import { PatternQueryControls } from "@/ui/search/PatternQueryControls";

/**
 * The Find bar's pattern controls, handed to a tool that searches bytes: the same field, menu,
 * encoding, Smart Search and case toggle, so the recent queries and the pattern library are the
 * dump's own.
 *
 * What it adds is the translation the tool needs: the field's request as the attempts to make,
 * in order, and what came of them back into the controls.
 *
 * @upstream ByteRipperApp/Tools/ToolPatternQueryControls.swift#ToolPatternQueryControls
 * @upstream ByteRipperApp/Tools/ToolPatternQueryControls.swift#ToolPatternQueryControls.focus
 * @upstream ByteRipperApp/Tools/ToolPatternQueryControls.swift#ToolPatternQueryControls.text
 * @upstream-differs one value for every tool, the controls a component the tool renders
 */
export const TOOL_PATTERN_QUERY: ToolPatternQuery = {
  Controls: function ToolPatternControls({ text, placeholder, onEdit, onSubmit, focusToken }) {
    const id = useId();
    const inputRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if (focusToken > 0) {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }, [focusToken]);
    return (
      // Return in the field submits the little form; it holds nothing else that could.
      <form
        className="tool-pattern-query"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <PatternQueryControls
          id={id}
          inputRef={inputRef}
          className="tool-pattern-input"
          text={text}
          placeholder={placeholder}
          onEdit={onEdit}
          onPicked={(search) => {
            onEdit(search.pattern);
            onSubmit();
          }}
          onEscape={() => onEdit("")}
        />
      </form>
    );
  },
  attempts: toolPatternAttempts,
  found: noteToolPatternFound,
};
