import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlySize } from "@/core/text/byteSize";
import { hexAddress } from "@/core/text/hexText";
import { subtypeName, typeName } from "@/firmware/uefi/uefiTypes";
import {
  expandFirmwareNode,
  firmwareStore,
  fixFirmwareChecksum,
  parsePaneFirmware,
  pathKey,
  resolveFirmwareAddresses,
} from "@/state/firmwareStore";
import { useStore } from "@/state/useStore";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import type { WireNode } from "@/workers/protocol";

/**
 * UEFI Structure: the image as a tree.
 *
 * The two expensive containers — a region's raw-area scan and a volume's file
 * walk — are never opened until a row is. That is the whole shape of this
 * panel: opening a 16 MB image shows its top level at once, and the file bodies
 * are read when somebody looks at them.
 *
 * The tree is virtualised, because a firmware image is routinely a few thousand
 * nodes and a row per node is a few thousand elements the browser would lay out
 * on every scroll.
 */

/** One row as the list draws it: a node and how deep it sits. */
interface Row {
  readonly node: WireNode;
  readonly depth: number;
  readonly key: string;
}

const ROW_HEIGHT = 22;
/** Rows kept above and below the viewport, so a flick never shows a gap. */
const OVERSCAN = 8;

function rowsOf(nodes: readonly WireNode[], open: ReadonlySet<string>, depth = 0): Row[] {
  const rows: Row[] = [];
  for (const node of nodes) {
    const key = pathKey(node.id);
    rows.push({ node, depth, key });
    if (open.has(key)) rows.push(...rowsOf(node.children, open, depth + 1));
  }
  return rows;
}

function UefiStructureView({ context }: { readonly context: ToolContext }) {
  const state = useStore(firmwareStore).panes[context.pane];
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  // The pane's image, parsed when the panel first asks for it.
  useEffect(() => {
    void parsePaneFirmware(context.pane);
  }, [context.pane]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => rowsOf(state?.roots ?? [], open), [state?.roots, open]);

  const toggle = useCallback(
    (row: Row) => {
      const key = row.key;
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      // Asking is idempotent and the store drops a second ask, so opening a row
      // whose children are already in hand costs nothing.
      if (row.node.isExpandable) expandFirmwareNode(context.pane, row.node.id);
    },
    [context.pane]
  );

  /**
   * Whether this node is the one a checksum diagnostic is about.
   *
   * By offset, because that is how a diagnostic locates itself: it is raised
   * while the node is still being built, and an offset inside the header is the
   * node the complaint belongs to.
   */
  const isFlagged = useCallback(
    (node: WireNode) =>
      (state?.diagnostics ?? []).some(
        (one) =>
          one.message.includes("checksum") &&
          one.offset >= node.header[0] &&
          one.offset < Math.max(node.header[1], node.body[1])
      ),
    [state?.diagnostics]
  );

  /**
   * The revision of the volume a node sits in, which the fixed body checksum
   * follows. Found by walking down to the node, because a file does not carry
   * its volume's revision and reading it back off the image would be the same
   * lookup one level further away.
   */
  const volumeRevisionFor = useCallback(
    (path: readonly number[]) => {
      let nodes = state?.roots ?? [];
      let revision = 2;
      for (const index of path) {
        const next = nodes[index];
        if (next === undefined) break;
        if (next.kind === "volume" && next.subtype !== undefined) revision = next.subtype;
        nodes = next.children;
      }
      return revision;
    },
    [state?.roots]
  );

  const choose = useCallback(
    (row: Row) => {
      setSelected(row.key);
      // The whole node, header through tail — what a reader clicking a row in a
      // structure tree means by it.
      context.reveal(row.node.header[0], Math.max(row.node.body[1], row.node.tail[1]));
    },
    [context]
  );

  if (state === undefined || state.status === "parsing") {
    return (
      <div className="tool-empty">
        <p>Reading the image…</p>
        <progress value={state?.fraction ?? 0} max={1} />
      </div>
    );
  }
  if (state.status === "failed") {
    return <div className="tool-empty">{state.problem ?? "That image could not be parsed."}</div>;
  }
  if (rows.length === 0) {
    return <div className="tool-empty">Nothing in this file looks like firmware.</div>;
  }

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  return (
    <div className="uefi-tool">
      <div
        className="uefi-tree"
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          className="uefi-tree-spacer"
          role="tree"
          aria-label="Firmware structure"
          style={{ height: rows.length * ROW_HEIGHT }}
        >
          {visible.map((row, index) => (
            <TreeRow
              key={row.key}
              row={row}
              top={(first + index) * ROW_HEIGHT}
              isOpen={open.has(row.key)}
              isSelected={selected === row.key}
              isExpanding={state.expanding.has(row.key)}
              onToggle={() => toggle(row)}
              onChoose={() => choose(row)}
              onMenu={(event) => {
                choose(row);
                // Upstream offers exactly one command here, and only on a node
                // whose checksum is wrong — a clean row gets no menu at all,
                // which is why there is nothing else in this list.
                openContextMenu(event, [
                  isFlagged(row.node)
                    ? {
                        label: "Fix Checksum",
                        onSelect: () => {
                          void fixFirmwareChecksum(
                            context.pane,
                            row.node.id,
                            volumeRevisionFor(row.node.id)
                          ).then((count) => {
                            if (count === 0) context.report("There was nothing to put back.");
                          });
                        },
                      }
                    : undefined,
                ]);
              }}
            />
          ))}
        </div>
      </div>

      <footer className="uefi-status">
        <span>{rows.length.toLocaleString()} rows</span>
        <span>{friendlySize(state.size)}</span>
        {state.diagnostics.length > 0 ? (
          <span className="uefi-diagnostics" title={state.diagnostics[0]?.message}>
            {state.diagnostics.length} problem
            {state.diagnostics.length === 1 ? "" : "s"}
          </span>
        ) : null}
        <button
          type="button"
          className="toolbar-button is-quiet"
          onClick={() => resolveFirmwareAddresses(context.pane)}
          title="Work out where this image is mapped, from its Volume Top File"
        >
          {state.addressDiff === undefined
            ? "Find the mapping"
            : `Mapped at ${hexAddress(state.addressDiff)}`}
        </button>
      </footer>
    </div>
  );
}

function TreeRow({
  row,
  top,
  isOpen,
  isSelected,
  isExpanding,
  onToggle,
  onChoose,
  onMenu,
}: {
  readonly row: Row;
  readonly top: number;
  readonly isOpen: boolean;
  readonly isSelected: boolean;
  readonly isExpanding: boolean;
  readonly onToggle: () => void;
  readonly onChoose: () => void;
  readonly onMenu: (event: React.MouseEvent) => void;
}) {
  const node = row.node;
  const hasChildren = node.children.length > 0 || node.isExpandable;
  const size = Math.max(node.body[1], node.tail[1]) - node.header[0];

  return (
    <div
      className="uefi-row"
      // A tree of nodes is what this is, and a row in it is a treeitem: the
      // depth and the disclosure state are what a reader who cannot see the
      // indentation needs said.
      role="treeitem"
      // Focusable, because a treeitem that is not is a row a keyboard cannot
      // reach; -1 keeps the tab stop on the tree itself rather than putting one
      // on every one of a few thousand rows.
      tabIndex={-1}
      aria-level={row.depth + 1}
      aria-selected={isSelected}
      {...(hasChildren ? { "aria-expanded": isOpen } : {})}
      data-selected={isSelected ? "" : undefined}
      style={{ top, paddingLeft: `${row.depth * 14 + 6}px` }}
      onContextMenu={onMenu}
    >
      <button
        type="button"
        className="uefi-twist"
        onClick={onToggle}
        disabled={!hasChildren}
        aria-label={isOpen ? "Collapse" : "Expand"}
      >
        {hasChildren ? (isExpanding ? "…" : isOpen ? "▾" : "▸") : ""}
      </button>
      <button type="button" className="uefi-name" onClick={onChoose} title={node.guid}>
        {node.name}
      </button>
      <span className="uefi-type">{describe(node)}</span>
      <span className="uefi-offset">{hexAddress(node.header[0])}</span>
      <span className="uefi-size">{friendlySize(size)}</span>
    </div>
  );
}

/** The Type and Subtype columns UEFITool shows, in one cell. */
function describe(node: WireNode): string {
  const type = typeOf(node);
  const sub = node.subtype === undefined ? undefined : subtypeName(type, node.subtype);
  return sub === undefined ? typeName(type) : `${typeName(type)} · ${sub}`;
}

/**
 * The item type for a node that crossed the wire.
 *
 * The classification itself is `src/firmware/uefi/itemClassification.ts`, which
 * works on a parsed node; here the node is a wire value, so the kind is matched
 * back to the same table.
 */
const WIRE_ITEM_TYPES: Readonly<Record<string, number>> = {
  capsule: 0x3d,
  intelImage: 0x3e,
  uefiImage: 0x3e,
  region: 0x3f,
  flashDescriptor: 0x3f,
  padding: 0x40,
  volume: 0x41,
  file: 0x42,
  section: 0x43,
  freeSpace: 0x44,
  vssStore: 0x45,
  vss2Store: 0x46,
  ftwStore: 0x47,
  fdcStore: 0x48,
  sysFStore: 0x49,
  evsaStore: 0x4a,
  flashMapStore: 0x4b,
  cmdbStore: 0x4e,
  vssEntry: 0x51,
  sysFEntry: 0x52,
  evsaEntry: 0x53,
  flashMapEntry: 0x54,
  microcode: 0x57,
  slicData: 0x58,
  nonUEFIData: 0x42,
};

function typeOf(node: WireNode): number {
  return WIRE_ITEM_TYPES[node.kind] ?? 0x42;
}

export const uefiStructureTool: ToolModule = {
  id: "uefi-structure",
  title: "UEFI Structure",
  summary: "The image as a tree: regions, volumes, files and sections.",
  View: UefiStructureView,
};
