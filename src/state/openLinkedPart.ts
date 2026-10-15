import { L } from "@/core/localization/localization";
import { CopyPartCodec, type PartCodec, PartRefusal } from "@/core/parts/partCodec";
import type { UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import { agentShell } from "@/state/agent/agentShell";
import { DocumentOrigin } from "@/state/documentOrigin";
import { documentPartReader } from "@/state/documentPartReader";
import { wishShowItemAt, wishTopLevelRowsOpen } from "@/state/opensTopLevelRows";
import { activate } from "@/state/toolController";
import {
  openPart,
  type PaneId,
  type PartId,
  paneState,
  raisePart,
  reportAlert,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * Opens a part of `parent`'s file as a panel over it — the one way a part opens,
 * whoever asks: a zone, a node of a tool's tree, a body a tool decompressed
 * (`Design/GAPS.md` G4, G49; upstream's `Design/FRAGMENT_PANELS_PLAN.md`).
 *
 * `name` is what the panel, its pill and its link call the part: what was
 * opened — the node, the zone — and nothing else. Not the dump's name, which
 * the link names, and not what was done to the bytes, which the codec's badge
 * says.
 *
 * `codec` is the whole of what the part is: the panel shows what it decodes
 * from `source`, and Update in Parent writes back what it encodes. The link is
 * made here rather than by each caller because making it reads the source out
 * of the parent: one place does that, and a part opened without it is a part
 * nothing can put back. The window's bookmarks reach the panel only when the
 * codec keeps the source's offsets (`marksFor`).
 *
 * Resolves to the part, or to nothing when the bytes could not be decoded —
 * which has then been said.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openPart
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openFragment
 * @upstream-differs every decode is awaited: a quick one settles at once, and a
 * body to decompress comes back from the worker, so the two need no separate
 * paths
 */
export async function openLinkedPart(options: {
  /** The pane the bytes came out of — a file slot, or another part. */
  readonly parent: PaneId;
  /** What the panel, its pill and its link are called. */
  readonly name: string;
  /** Where the bytes are in the parent: what the link points at. Half-open. */
  readonly source: readonly [number, number];
  /**
   * What a panel opened on the part should read its bytes as — the parent's
   * tree is what knows (`askFirmwareLayout`).
   */
  readonly layout?: UEFIRootLayout | undefined;
  /** What the part is, both ways; a copy of the source when nothing says otherwise. */
  readonly codec?: PartCodec | undefined;
  /**
   * A tool to switch on in the part's panel — UEFI Structure for a node taken out of its tree,
   * with the tree's first level open.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openPart
   */
  readonly tool?: string | undefined;
  /**
   * What to select in the part once it is up, in the part's own addresses: a Contents search
   * match. A part of the same bytes already open is raised and selected rather than opened twice.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.openPart
   */
  readonly selecting?: readonly [number, number] | undefined;
}): Promise<PartId | undefined> {
  const { parent, name, source } = options;
  const slot = paneState(parent);
  if (slot === undefined) return undefined;
  const codec = options.codec ?? new CopyPartCodec();
  if (options.selecting !== undefined) {
    const open = Object.entries(workspaceStore.getSnapshot().parts).find(([, held]) => {
      const origin = held?.origin;
      return (
        origin !== undefined &&
        origin.parent === parent &&
        origin.sourceRange[0] === source[0] &&
        origin.sourceRange[1] === source[1] &&
        origin.codec.constructor === codec.constructor &&
        held?.name === name
      );
    });
    if (open !== undefined) {
      const part = open[0] as PartId;
      raisePart(part);
      if (options.tool !== undefined) {
        // Raised again for another place: its tree goes to the node of that place too.
        wishShowItemAt(part, options.selecting[0], options.selecting[1]);
        activate(options.tool, part);
      }
      await select(part, options.selecting);
      return part;
    }
  }
  let bytes: Uint8Array;
  try {
    bytes = await codec.decode({
      content: documentPartReader(slot.document),
      source,
      name: slot.name,
      partName: name,
    });
  } catch (error) {
    reportAlert(
      error instanceof PartRefusal ? error.title.text : L("Those bytes could not be read."),
      error instanceof PartRefusal
        ? error.messageText.text
        : error instanceof Error
          ? error.message
          : String(error),
      "problem"
    );
    return undefined;
  }
  const origin = await DocumentOrigin.of({
    parent,
    source,
    partName: name,
    codec,
    ...(options.layout === undefined ? {} : { layout: options.layout }),
    content: bytes,
  });
  const part = openPart(bytes, name, origin);
  if (options.tool !== undefined) {
    wishTopLevelRowsOpen(part);
    // A match selected in the part: its tree opens to the node the match is in.
    if (options.selecting !== undefined) {
      wishShowItemAt(part, options.selecting[0], options.selecting[1]);
    }
    activate(options.tool, part);
  }
  if (options.selecting !== undefined) await select(part, options.selecting);
  return part;
}

/** Selects `[start, end)` of `part` and brings it on screen, through the shell's reveal. */
async function select(part: PartId, range: readonly [number, number]): Promise<void> {
  if (agentShell.reveal !== undefined) {
    await agentShell.reveal(part, range[0], range[1], true);
    return;
  }
  await paneState(part)?.typing.setSelection(range[0], range[1]);
}
