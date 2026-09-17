import { useCallback, useRef } from "react";
import { usePointerDrag } from "@/ui/shell/pointerDrag";
import { boundaryTarget, draggedWidth, type TableColumn } from "@/ui/toolPanel/columnWidths";

/**
 * The handle on a table's column boundary that moves it.
 *
 * One component for every panel's table, because the gesture is the same in all
 * of them: the boundary follows the pointer, the column on its left grows by
 * what the pointer travelled, and its neighbour gives it up. Which of the two
 * actually changes is `boundaryTarget`'s answer, since one column per table is
 * as wide as the panel leaves it and not the reader.
 *
 * It sits inside the header cell it belongs to, against that cell's right edge,
 * so a panel places one by rendering it in the cell — no measuring of where the
 * columns are, and the head of a virtualised table costs nothing extra.
 *
 * Keyboard-reachable for the reason every other handle here is: a layout only a
 * pointer can change is a layout some people cannot change.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPanelTable.swift#ToolPanelTable
 */

export interface ColumnResizerProps {
  /** The whole table's columns, in order. */
  readonly columns: readonly TableColumn[];
  /** Where this boundary is: the right edge of `columns[index]`. */
  readonly index: number;
  /** The table's widths, as they stand. Which of them this drag moves is the
   * table's answer, not the caller's — see `boundaryTarget`. */
  readonly widths: Readonly<Record<string, number>>;
  /** Receives the width asked for; clamping it is this component's job. */
  readonly onChange: (id: string, width: number) => void;
  /** Where a double-click, Home or Enter puts it back. */
  readonly onReset: () => void;
}

export function ColumnResizer({ columns, index, widths, onChange, onReset }: ColumnResizerProps) {
  const target = boundaryTarget(columns, index);
  const column = target === undefined ? undefined : columns.find((one) => one.id === target.id);
  const width = target === undefined ? 0 : (widths[target.id] ?? 0);

  // Where the column was when the press landed. A payload the drag reads, not a
  // second opinion about whether it is running — `usePointerDrag` owns that.
  const atPress = useRef(0);

  // The gesture is `usePointerDrag`'s, as it is for the pane divider and the
  // panel edges: the column cannot be dragged by a pointer that is only
  // passing over the handle.
  const drag = usePointerDrag<HTMLDivElement>(
    (start, event) => {
      if (target === undefined || column === undefined) return;
      onChange(
        target.id,
        draggedWidth(atPress.current, event.clientX - start.clientX, column, target.sign)
      );
    },
    () => {
      atPress.current = width;
    }
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (target === undefined || column === undefined) return;
      const step = event.shiftKey ? 24 : 8;
      if (event.key === "ArrowLeft") onChange(target.id, width - step * target.sign);
      else if (event.key === "ArrowRight") onChange(target.id, width + step * target.sign);
      else if (event.key === "Home" || event.key === "Enter") onReset();
      else return;
      event.preventDefault();
    },
    [target, column, width, onChange, onReset]
  );

  // Nothing to its right: the table's own edge, which is not a boundary.
  if (target === undefined || column === undefined) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged
    <div
      className="column-resizer"
      role="separator"
      tabIndex={0}
      aria-label={`Resize the ${column.title.length === 0 ? "second" : column.title} column`}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={column.min}
      aria-valuemax={column.min + 1000}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      onLostPointerCapture={drag.onLostPointerCapture}
      onDoubleClick={(event) => {
        // The header cell beside it is a click target of its own in some panels.
        event.stopPropagation();
        onReset();
      }}
      onKeyDown={onKeyDown}
    />
  );
}
