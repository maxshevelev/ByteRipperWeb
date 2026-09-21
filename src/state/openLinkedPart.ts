import type { UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import type { RebuildTarget } from "@/firmware/uefi/uefiRebuild";
import { DocumentOrigin, type OriginKind } from "@/state/documentOrigin";
import { openPart, type PaneId, type PartId, paneState } from "@/state/workspaceStore";

/**
 * Opening a part with the link back to where its bytes came from — the one
 * route every command that opens a part takes (`Design/GAPS.md` G4, G49).
 *
 * The link is made here rather than by each caller because making it reads the
 * source out of the parent: one place does that, and a part opened without it
 * is a part nothing can put back.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openPartForTool
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openFragment
 */
export async function openLinkedPart(options: {
  /** The pane the bytes came out of — a file slot, or another part. */
  readonly parent: PaneId;
  readonly bytes: Uint8Array;
  /** What the panel and its pill are called. */
  readonly name: string;
  /**
   * Where the bytes are in the parent. A part opened without one — nothing
   * offers that today — is a document like any other, with no way home.
   */
  readonly source?: readonly [number, number] | undefined;
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
  /**
   * How the bytes stand to the source: its own, copied out, or what it
   * decompresses to — which goes back compressed again.
   */
  readonly kind?: OriginKind | undefined;
  /**
   * Where the bytes go back to through the rebuild planner, when the part is
   * something the image can be laid out again around
   * (`Design/UEFI/UPDATE_IN_PARENT.md` §6).
   */
  readonly rebuildTarget?: RebuildTarget | undefined;
}): Promise<PartId> {
  const { parent, bytes, name, source } = options;
  const origin =
    source === undefined
      ? undefined
      : await DocumentOrigin.of({
          parent,
          source,
          partName: options.partName ?? partNameOf(name, paneState(parent)?.name ?? ""),
          ...(options.layout === undefined ? {} : { layout: options.layout }),
          ...(options.kind === undefined ? {} : { kind: options.kind }),
          ...(options.rebuildTarget === undefined ? {} : { rebuildTarget: options.rebuildTarget }),
          content: bytes,
        });
  return openPart(bytes, name, origin);
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
