import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlySize } from "@/core/text/byteSize";
import { hexAddress } from "@/core/text/hexText";
import { guidFromText } from "@/firmware/uefi/efiGuid";
import { fileTypeName } from "@/firmware/uefi/fileParser";
import type { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { sectionTypeName } from "@/firmware/uefi/sectionParser";
import { subtypeName, typeName } from "@/firmware/uefi/uefiTypes";
import {
  askFirmwareDetail,
  expandFirmwareNode,
  firmwareNodeAt,
  firmwareStore,
  fixFirmwareChecksum,
  parsePaneFirmware,
  pathKey,
  resolveFirmwareAddresses,
} from "@/state/firmwareStore";
import { cancelGuidCatalogue, catalogueStore, loadGuidCatalogue } from "@/state/guidCatalogue";
import { useStore } from "@/state/useStore";
import { clearZones, publishZones } from "@/state/zoneStore";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import type { FirmwareDetailResponse, WireNode } from "@/workers/protocol";

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
  const catalogue = useStore(catalogueStore);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  // The pane's image, parsed when the panel first asks for it. The zones go
  // when the panel does: a gutter still marking a tool nobody has open is a
  // promise about bytes nothing is watching.
  useEffect(() => {
    void parsePaneFirmware(context.pane);
    return () => clearZones(context.pane);
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
      askFirmwareDetail(context.pane, row.node.id);
      // The extent of what is selected, and of what is directly inside it — so
      // the minimap's gutter shows where this thing is and how it is made up.
      // The whole tree would be thousands of brackets and no information.
      publishZones(context.pane, {
        zones: [row.node, ...row.node.children].map((node) => ({
          id: pathKey(node.id),
          name: node.name,
          start: node.header[0],
          end: Math.max(node.body[1], node.tail[1]),
        })),
        focus: row.key,
      });
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
              named={nameOf(row.node, catalogue.catalogue)}
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

      {state.detail === undefined || pathKey(state.detail.node) !== selected ? null : (
        <NodeDetail detail={state.detail} node={firmwareNodeAt(state.roots, state.detail.node)} />
      )}

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
          onClick={() =>
            catalogue.status === "loading" ? cancelGuidCatalogue() : loadGuidCatalogue()
          }
          title={
            catalogue.fetchedAt === undefined
              ? "Download the GUID names from UEFITool"
              : `Fetched ${new Date(catalogue.fetchedAt).toLocaleString()}`
          }
        >
          {catalogue.status === "loading"
            ? "Downloading names… cancel"
            : catalogue.status === "ready"
              ? `${catalogue.catalogue.names.size.toLocaleString()} names`
              : "Get GUID names"}
        </button>
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

/**
 * What the selected node is, in the words the format uses.
 *
 * The address matters more than the offset for most of what this tree holds —
 * a FIT entry, a reset vector and a Boot Guard range are all written as
 * addresses — so it is shown whenever the image says where it is mapped, and
 * plainly absent when it does not. Not zero, and not a guess.
 */
function NodeDetail({
  detail,
  node,
}: {
  readonly detail: FirmwareDetailResponse;
  readonly node: WireNode | undefined;
}) {
  if (node === undefined) return null;
  const end = Math.max(node.body[1], node.tail[1]);
  const hexWord = (value: number, digits = 8) =>
    `0x${value.toString(16).toUpperCase().padStart(digits, "0")}`;

  return (
    <div className="uefi-detail">
      <dl className="uefi-fields">
        <dt>Offset</dt>
        <dd>{hexAddress(node.header[0])}</dd>
        <dt>Size</dt>
        <dd>
          {friendlySize(end - node.header[0])} ({(end - node.header[0]).toLocaleString()} bytes)
        </dd>
        {detail.address === undefined ? null : (
          <>
            <dt>Address</dt>
            <dd>{hexWord(detail.address)}</dd>
          </>
        )}
        {node.guid === undefined ? null : (
          <>
            <dt>GUID</dt>
            <dd className="uefi-guid">{node.guid}</dd>
          </>
        )}
        {node.isFixed ? (
          <>
            <dt>Fixed</dt>
            <dd>Cannot be moved when the image is rebuilt</dd>
          </>
        ) : null}
      </dl>

      {detail.descriptor === undefined ? null : (
        <div className="uefi-descriptor">
          <p className="uefi-fields-head">Reserved vector</p>
          <p className="uefi-bytes">{detail.descriptor.reservedVector}</p>

          {detail.descriptor.biosAccess.length === 0 ? null : (
            <>
              {/* The question behind "why can't my programmer write this area
                  from inside the OS". */}
              <p className="uefi-fields-head">What the BIOS master may do</p>
              <table className="panel-table uefi-table">
                <thead>
                  <tr>
                    <th scope="col">Region</th>
                    <th scope="col">Read</th>
                    <th scope="col">Write</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.descriptor.biosAccess.map((row) => (
                    <tr key={row.region}>
                      <th scope="row">{row.region}</th>
                      <td>{row.read ? "yes" : "no"}</td>
                      <td>{row.write ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {detail.descriptor.masters.length === 0 ? null : (
            <>
              <p className="uefi-fields-head">Masters</p>
              <table className="panel-table uefi-table">
                <tbody>
                  {detail.descriptor.masters.map((master) => (
                    <tr key={master.name}>
                      <th scope="row">{master.name}</th>
                      <td>read {hexWord(master.read, detail.descriptor?.maskDigits ?? 3)}</td>
                      <td>write {hexWord(master.write, detail.descriptor?.maskDigits ?? 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {detail.descriptor.chips.length === 0 ? null : (
            <>
              {/* The chips this firmware was built to drive — the other half of
                  "is the chip I am about to solder on one it knows". */}
              <p className="uefi-fields-head">Flash chips</p>
              <ul className="uefi-chips">
                {detail.descriptor.chips.map((chip) => (
                  <li key={chip.jedecId}>
                    {hexWord(chip.jedecId, 6)} {chip.name ?? "(not in the catalogue)"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TreeRow({
  row,
  top,
  isOpen,
  isSelected,
  isExpanding,
  named,
  onToggle,
  onChoose,
  onMenu,
}: {
  readonly row: Row;
  readonly named: string;
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
        {named}
      </button>
      <span className="uefi-type">{describe(node)}</span>
      <span className="uefi-offset">{hexAddress(node.header[0])}</span>
      <span className="uefi-size">{friendlySize(size)}</span>
    </div>
  );
}

/**
 * What to call a node.
 *
 * The parser's own name wins, because it is the better one when it exists: a
 * user-interface section's string, or a GUID from the table this build carries.
 * The downloaded catalogue fills in the rest — the hundreds of GUIDs nobody
 * hard-codes — and where it has nothing either, the GUID itself is shown, which
 * is more use than a type repeated in the next column.
 */
function nameOf(node: WireNode, catalogue: GuidsCatalogue): string {
  const generic =
    node.subtype !== undefined &&
    ((node.kind === "file" && node.name === fileTypeName(node.subtype)) ||
      (node.kind === "section" && node.name === sectionTypeName(node.subtype)));
  if (!generic || node.guid === undefined) return node.name;
  const parsed = guidFromText(node.guid);
  const known = parsed === undefined ? undefined : catalogue.nameOf(parsed);
  return known ?? node.guid;
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
