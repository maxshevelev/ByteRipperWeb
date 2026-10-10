import { type ReactNode, useState } from "react";
import { L } from "@/core/localization/localization";
import { largeDetailStore } from "@/state/largeDetailStore";
import { useStore } from "@/state/useStore";
import { PaneDivider } from "@/ui/shell/PaneDivider";

/**
 * A page of the Agent window that has details: its list above, the details of the row in focus
 * below, and the divider between them — the tool panels' split (`.tool-split`), so the details are
 * the same pane with the same large view. While the large view is open the details pane folds
 * away and the list takes the height, as a tool panel's does.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.buildContent
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.split
 * @upstream-differs the share the list takes is kept between launches, as a tool panel's is here
 */
export function AgentSplit({
  name,
  list,
  details,
  hidden,
}: {
  /** Which page's split it is, for the share it keeps. */
  readonly name: "log" | "tools";
  readonly list: ReactNode;
  readonly details: ReactNode;
  readonly hidden?: boolean;
}) {
  const large = useStore(largeDetailStore).open;
  const key = `AgentSplitShare ${name}`;
  const [share, setShare] = useState(() => storedShare(key));
  const change = (next: number) => {
    setShare(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // A private window may refuse to store it; the split still applies here.
    }
  };
  return (
    <div
      className="tool-split agent-split"
      hidden={hidden}
      // A click on the list, its head or its divider leaves the large view open: the reader is
      // choosing the row the card shows.
      data-detail-owner=""
      data-detail-large={large && hidden !== true ? "" : undefined}
      style={{
        gridTemplateRows:
          large && hidden !== true
            ? "minmax(0, 1fr) 0 0"
            : `minmax(0, ${share}fr) 6px minmax(0, ${1 - share}fr)`,
      }}
    >
      {list}
      <PaneDivider
        layout="stacked"
        fraction={share}
        onChange={change}
        initial={DEFAULT_SHARE}
        label={L("Resize the detail")}
      />
      {details}
    </div>
  );
}

/** The list's share at first: upstream's details pane is 170 points under a list that fills. */
const DEFAULT_SHARE = 0.62;

function storedShare(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_SHARE;
  } catch {
    return DEFAULT_SHARE;
  }
}
