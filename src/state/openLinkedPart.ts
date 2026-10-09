import { L } from "@/core/localization/localization";
import { CopyPartCodec, type PartCodec, PartRefusal } from "@/core/parts/partCodec";
import type { UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import { DocumentOrigin } from "@/state/documentOrigin";
import { documentPartReader } from "@/state/documentPartReader";
import { wishTopLevelRowsOpen } from "@/state/opensTopLevelRows";
import { activate } from "@/state/toolController";
import { openPart, type PaneId, type PartId, paneState, reportAlert } from "@/state/workspaceStore";

/**
 * Opens a part of `parent`'s file as a panel over it — the one way a part opens,
 * whoever asks: a zone, a node of a tool's tree, a body a tool decompressed
 * (`Design/GAPS.md` G4, G49; upstream's `Design/FRAGMENT_PANELS_PLAN.md`).
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
  /** What the panel and its pill are called. */
  readonly name: string;
  /** Where the bytes are in the parent: what the link points at. Half-open. */
  readonly source: readonly [number, number];
  /**
   * What the part is called in the parent, for the link's own sentence. The
   * part's name without the parent's stem in front of it, when the caller has
   * nothing better to say.
   */
  readonly partName?: string | undefined;
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
}): Promise<PartId | undefined> {
  const { parent, name, source } = options;
  const slot = paneState(parent);
  if (slot === undefined) return undefined;
  const codec = options.codec ?? new CopyPartCodec();
  const partName = options.partName ?? partNameOf(name, slot.name);
  let bytes: Uint8Array;
  try {
    bytes = await codec.decode({
      content: documentPartReader(slot.document),
      source,
      name: slot.name,
      partName,
    });
  } catch (error) {
    reportAlert(
      error instanceof PartRefusal ? error.title : L("Those bytes could not be read."),
      error instanceof Error ? error.message : String(error),
      "problem"
    );
    return undefined;
  }
  const origin = await DocumentOrigin.of({
    parent,
    source,
    partName,
    codec,
    ...(options.layout === undefined ? {} : { layout: options.layout }),
    content: bytes,
  });
  const part = openPart(bytes, name, origin);
  if (options.tool !== undefined) {
    wishTopLevelRowsOpen(part);
    activate(options.tool, part);
  }
  return part;
}

/**
 * What a part is a part *of*, for the link's own sentence: its name without the
 * dump's stem in front and the extension behind — `bios_LZMA section.bin` out
 * of `bios.rom` is "LZMA section".
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.partName
 */
export function partNameOf(name: string, parentName: string): string {
  const dot = name.lastIndexOf(".");
  const part = dot <= 0 ? name : name.slice(0, dot);
  const parentDot = parentName.lastIndexOf(".");
  const stem = `${parentDot <= 0 ? parentName : parentName.slice(0, parentDot)}_`;
  return part.startsWith(stem) && part.length > stem.length ? part.slice(stem.length) : part;
}
