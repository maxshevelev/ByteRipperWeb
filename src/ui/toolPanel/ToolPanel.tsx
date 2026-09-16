import { useCallback, useEffect, useState } from "react";
import { showNotice } from "@/state/noticeStore";
import {
  activate,
  activeModule,
  DEFAULT_TOOL_PANEL_WIDTH,
  MAX_TOOL_PANEL_WIDTH,
  MIN_TOOL_PANEL_WIDTH,
  paneChoices,
  selectorEnabled,
  selectPane,
  setToolPanelWidth,
  toolController,
} from "@/state/toolController";
import { showTransientMessage } from "@/state/transientMessageStore";
import { useStore } from "@/state/useStore";
import { PANE_IDS, type PaneId, workspaceStore } from "@/state/workspaceStore";
import type { ToolContext } from "@/tools/toolModule";
import { CloseButton } from "@/ui/shell/CloseButton";
import { EdgeSplitter } from "@/ui/shell/EdgeSplitter";

/**
 * The tool panel's chrome: a header naming the tool and the file its session is
 * bound to, a close button, and the tool's own view below.
 *
 * The header answers the one question the panel would otherwise leave open —
 * which file this is — and is where that file is changed. A session is bound to
 * the pane it was opened for and does not follow the active pane, so in a
 * comparison the panel and the pane being typed in can be different files, and
 * what the header names is where the tool's writes go. Choosing the other pane
 * in its selector moves the tool there; clicking into that pane does not.
 *
 * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView
 */
export function ToolPanel({
  onReveal,
}: {
  readonly onReveal: (pane: "a" | "b", start: number, end: number) => void;
}) {
  const workspace = useStore(workspaceStore);
  const tools = useStore(toolController);
  const { boundPane, width } = tools;
  const tool = activeModule(tools);
  const slot = boundPane === undefined ? undefined : workspace.panes[boundPane];
  const choices = paneChoices(workspace.panes);
  const switchable = selectorEnabled(choices);
  const keyboardRing = useKeyboardInput();

  const reveal = useCallback(
    (start: number, end: number) => {
      if (boundPane !== undefined) onReveal(boundPane, start, end);
    },
    [onReveal, boundPane]
  );

  if (tool === undefined || boundPane === undefined || slot === undefined) return null;
  const context: ToolContext = {
    pane: boundPane,
    // What the session was handed as it started, from the same place the pane
    // and the width come from: it is the host that took it out of the box, and
    // the panel draws the session it belongs to.
    restored: tools.restored,
    reveal,
    // What the panel just did, in the line of the pane it is about — the same
    // two seconds and the same restore the window's own messages get.
    report: (text) => showTransientMessage(boundPane, text),
    // The window's own plate, through the presenter every other notice goes
    // through, so a tool's confirmation cannot come to look like another app's.
    // @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.showNotice
    showNotice,
  };

  return (
    <aside className="tool-panel" aria-label="Tools" style={{ width }}>
      {/* @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setTitle */}
      <header className="tool-panel-head">
        <ToolsIcon />
        <span className="tool-panel-title">{tool.title}</span>
        {/* The header answers the panel's open question — which file the tool
            reads and writes — and is where that file is changed: in a
            comparison, choosing the other pane here is how the tool is moved
            to it. The name and the chevron are one control, and it goes through
            `selectPane`, the door a pane dropped on the panel would use, so a
            session is never re-pointed underneath itself.
            The control is a native `<select>` doing the job upstream's
            `NSPopUpButton` does: the option it shows *is* its selection, which
            is the rule upstream has to re-assert by hand after every title
            change, and the keyboard reaches it for free. It is stretched
            invisibly over the name and the chevron — the two are drawn by this
            side — so a tap on either opens it, which a `<select>` whose box
            ended at the text would not do, and so the focus ring is drawn
            around the whole control rather than around the words alone.
            @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setPanes
            @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.onSelectPane
            @upstream-differs one control whose shown option is its tick, rather than a menu whose items each carry a tick state
            @web-only the tooltip and the accessible name — "Link to file panel": upstream's popup carries neither, and a control with no visible label of its own needs one here */}
        <span
          className={`tool-panel-file${keyboardRing ? " is-keyboard" : ""}`}
          title="Link to file panel"
        >
          <span className="tool-panel-file-name">{slot.name}</span>
          <svg
            className={`menu-chevron tool-panel-file-chevron${switchable ? "" : " is-off"}`}
            width="8"
            height="5"
            viewBox="0 0 8 5"
            aria-hidden="true"
          >
            <path
              d="M1 1l3 3 3-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          <select
            className="tool-panel-file-select"
            aria-label="Link to file panel"
            value={boundPane}
            disabled={!switchable}
            onChange={(event) => selectPane(event.target.value as PaneId)}
          >
            {choices.map((choice, index) => {
              const pane = PANE_IDS[index];
              // One entry per pane, so neither of these can be missing: the
              // guard is here for the type checker, not for a real case.
              if (pane === undefined) return null;
              return (
                <option key={pane} value={pane} disabled={!choice.isEnabled}>
                  {choice.fileName}
                </option>
              );
            })}
          </select>
        </span>
        {/* The panel's ✕ is Tools ▸ None by another route.
            @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.onClose */}
        <CloseButton label="Close the tool panel" onClick={() => activate(undefined)} />
      </header>

      {/* @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setContent */}
      <div className="tool-panel-body">
        <tool.View key={`${tool.id}:${boundPane}`} context={context} />
      </div>

      <EdgeSplitter
        edge="right"
        label="Resize the tool panel"
        width={width}
        min={MIN_TOOL_PANEL_WIDTH}
        max={MAX_TOOL_PANEL_WIDTH}
        initial={DEFAULT_TOOL_PANEL_WIDTH}
        onChange={setToolPanelWidth}
      />
    </aside>
  );
}

/**
 * Whether the last input came from the keyboard.
 *
 * Every other ring in the app is `:focus-visible`, which is the browser saying
 * the same thing, and for a `<button>` it says it right — a click on one leaves
 * no ring. A `<select>` is where that stops being true: a select is operated
 * with the keyboard, so Chromium marks one focus-visible however it was focused,
 * and a tap on the header would draw a ring no other control in the app draws.
 * So the file selector asks here instead, and draws its ring only while the
 * answer is the keyboard's — alongside `:focus-visible`, which is what says the
 * control is still the focused one.
 */
function useKeyboardInput(): boolean {
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

/**
 * The wrench the header carries, so the panel reads as the tools' own.
 *
 * @upstream-differs upstream's `wrench.and.screwdriver` symbol, drawn as a wrench: SF Symbols do not ship to a browser
 */
function ToolsIcon() {
  return (
    <svg className="tool-panel-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 1.5a4 4 0 0 0-3.8 5.2L1.9 11.5a1.4 1.4 0 0 0 2 2l4.8-4.8a4 4 0 0 0 5.2-3.8l-2.2 2.2-2.1-.6-.6-2.1z" />
    </svg>
  );
}
