import { useCallback, useState } from "react";
import {
  channelOrder,
  rowMarkChannel,
  rowMarkMeaning,
  type ToolRowMark,
} from "@/tools/toolRowMarks";
import { RowMarkIcon } from "@/ui/toolPanel/RowMarkIcon";
import { DisclosureChevron } from "./DisclosureChevron";

/**
 * The legend every panel that marks its rows carries (`Design/ROW_MARKS.md`
 * §6): a disclosure strip inside the panel's own pane, one line collapsed, a
 * line per mark the panel draws expanded, with the Show Markings switch in its
 * header.
 *
 * Its lines come from the same catalogue the rows are dressed from, so what it
 * says a mark means is what the rows mean by it. Both of its states are
 * remembered per panel.
 *
 * Upstream builds this in AppKit and lays it out between a list and the pane's
 * bottom edge; here the strip is a grid row of the pane it belongs to, and the
 * list above it is the only thing that gives way — which is the same rule
 * (`install(below:in:)`) said in a layout the browser already has.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarksLegend.swift#ToolRowMarksLegend
 * @upstream-differs `verdicts`, a panel's own symbol-and-tint lines, is not
 * ported: every verdict this port draws is already a mark of the catalogue
 * (`ToolRowMark`), so a panel has none of its own to splice in
 */

/** Room above the header and below the last line. */
const MARGIN = 6;
/** Between the header and the list. */
const BODY_GAP = 8;
/** Between the list's lines. */
const LINE_SPACING = 5;

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarksLegend.swift#ToolRowMarksLegend.expandedKey */
export const expandedKey = (panel: string): string => `byteripper.rowMarksLegendExpanded.${panel}`;

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarksLegend.swift#ToolRowMarksLegend.showsMarkingsKey */
export const showsMarkingsKey = (panel: string): string => `byteripper.rowMarksShown.${panel}`;

function stored(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "true";
  } catch {
    return fallback;
  }
}

function store(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // A private window that refuses storage is a legend that forgets, which is
    // what it does the first time either way.
  }
}

/**
 * Whether the panel paints its rows, remembered per panel.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarksLegend.swift#ToolRowMarksLegend.showsMarkings
 */
export function useShowsMarkings(panel: string): [boolean, (shows: boolean) => void] {
  const [shows, setShows] = useState(() => stored(showsMarkingsKey(panel), true));
  const set = useCallback(
    (value: boolean) => {
      setShows(value);
      store(showsMarkingsKey(panel), value);
    },
    [panel]
  );
  return [shows, set];
}

/**
 * The marks in the order a legend lists them: by channel, and by the order the
 * panel named them inside one.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarksLegend.swift#ToolRowMarksLegend.rebuildEntries
 */
export function orderedMarks(marks: readonly ToolRowMark[]): readonly ToolRowMark[] {
  return [...marks].sort(
    (left, right) => channelOrder(rowMarkChannel(left)) - channelOrder(rowMarkChannel(right))
  );
}

/**
 * Whether the Show Markings switch is offered at all: only to a panel that
 * paints something it could hide. The icons stay whatever it says, so a panel
 * whose marks are all icons has nothing for a switch to do.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarksLegend.swift#ToolRowMarksLegend.offersShowMarkings
 */
export function offersShowMarkings(marks: readonly ToolRowMark[]): boolean {
  return marks.some((mark) => {
    const channel = rowMarkChannel(mark);
    return channel === "background" || channel === "rail";
  });
}

// help: panel.row-marks-legend
export function ToolRowMarksLegend({
  panel,
  marks,
  showsMarkings,
  onShowsMarkingsChange,
}: {
  /** The key the legend's states are remembered under. */
  readonly panel: string;
  /** Every mark this panel draws — and nothing it does not. */
  readonly marks: readonly ToolRowMark[];
  readonly showsMarkings: boolean;
  readonly onShowsMarkingsChange: (shows: boolean) => void;
}) {
  // Collapsed until the reader opens it: a reader who has learnt the marks
  // stops paying the room.
  const [isExpanded, setIsExpanded] = useState(() => stored(expandedKey(panel), false));
  const setExpanded = useCallback(
    (expanded: boolean) => {
      setIsExpanded(expanded);
      store(expandedKey(panel), expanded);
    },
    [panel]
  );

  // Only to a panel that paints something the switch could hide: the icons stay
  // whatever the switch says.
  const paints = offersShowMarkings(marks);
  const lines = orderedMarks(marks);

  return (
    <div
      className="tool-row-marks-legend"
      style={{
        paddingTop: MARGIN,
        paddingBottom: MARGIN,
        // A hidden list takes its gap with it, so shut the strip is the header
        // and its margins alone.
        gap: isExpanded ? BODY_GAP : 0,
      }}
    >
      <div className="tool-row-marks-header">
        <button
          type="button"
          className="tool-row-marks-disclosure"
          aria-expanded={isExpanded}
          aria-label="Legend"
          onClick={() => setExpanded(!isExpanded)}
        >
          <DisclosureChevron open={isExpanded} />
        </button>
        <button
          type="button"
          className="tool-row-marks-title"
          onClick={() => setExpanded(!isExpanded)}
        >
          Legend
        </button>
        {paints ? (
          <label className="tool-row-marks-switch">
            <input
              type="checkbox"
              checked={showsMarkings}
              onChange={(event) => onShowsMarkingsChange(event.currentTarget.checked)}
            />
            Show markings
          </label>
        ) : null}
      </div>
      {isExpanded ? (
        <ul className="tool-row-marks-lines" style={{ rowGap: LINE_SPACING }}>
          {lines.map((mark) => (
            <LegendLine key={mark} mark={mark} showsMarkings={showsMarkings} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One line: the mark drawn exactly as a row draws it, and what it means.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarksLegend.swift#ToolRowMarksLegend.addLine
 */
function LegendLine({
  mark,
  showsMarkings,
}: {
  readonly mark: ToolRowMark;
  readonly showsMarkings: boolean;
}) {
  const channel = rowMarkChannel(mark);
  const isPaint = channel === "background" || channel === "rail";
  // With the markings off, the paint the switch hid stays listed, greyed, so
  // the switch explains what it has hidden.
  const hidden = isPaint && !showsMarkings;
  return (
    <li className="tool-row-marks-line" data-hidden={hidden ? "" : undefined}>
      <span className="tool-row-marks-sample">
        {channel === "background" ? (
          <span className="tool-row-marks-swatch" data-tint={mark} />
        ) : channel === "rail" ? (
          <span className="tool-row-marks-swatch" data-tint={mark} data-rail="" />
        ) : (
          <RowMarkIcon mark={mark} />
        )}
      </span>
      <span className="tool-row-marks-meaning">{rowMarkMeaning(mark)}</span>
    </li>
  );
}
