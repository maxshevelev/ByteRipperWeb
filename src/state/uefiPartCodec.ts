import { L, LocalizedText } from "@/core/localization/localization";
import {
  type PartBadge,
  type PartCodec,
  type PartParent,
  PartRefusal,
  type PartUpdate,
} from "@/core/parts/partCodec";
import type { RebuildCaution, RebuildTarget } from "@/firmware/uefi/uefiRebuild";
import { askFirmwareRebuild, readSpaceBytes } from "@/state/firmwareStore";
import type { PaneId } from "@/state/workspaceStore";

/**
 * A part of an image that the rebuild planner lays out again on the way back
 * (`Design/UEFI/UPDATE_IN_PARENT.md` §6): a node of the file — a volume, a file,
 * a section — or what a compressed section decompressed to, or a node inside
 * that.
 *
 * Decoding reads the target's bytes in its space: the file's own for a node of
 * the file, the decompressed buffer for one inside a compressed section.
 * Encoding hands the panel's bytes to the planner, which compresses them again
 * the way the section was, resizes what has to be resized, and refuses with
 * numbers when the result does not fit.
 *
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.init
 * @upstream-differs carries the parent's pane where upstream carries the tree's
 * readers: a buffer is decompressed, and the planner run, in that pane's
 * firmware worker, which is where the tree and its buffers are. Nothing it
 * holds outlives the pane — the link refuses an update once the pane is closed
 * or holds another file, before the codec is asked anything
 */
export class UEFIPartCodec implements PartCodec {
  /** @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.target */
  readonly target: RebuildTarget;
  /**
   * The compression the bytes came out of — `LZMA`, `Tiano` — for the badge;
   * nothing for a node of the file, which is the file's own bytes.
   *
   * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.compression
   */
  readonly compression: string | undefined;
  /** The pane the part is taken out of, whose worker reads and plans. */
  private readonly pane: PaneId;
  /** @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.isImmediate */
  readonly isImmediate = false;

  constructor(options: {
    readonly pane: PaneId;
    readonly target: RebuildTarget;
    readonly compression?: string | undefined;
  }) {
    this.pane = options.pane;
    this.target = options.target;
    this.compression = options.compression;
  }

  private get isFile(): boolean {
    return this.target.space.length === 0;
  }

  /**
   * A node of the file is a slice of it; a buffer is decompressed.
   *
   * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.decodesImmediately
   */
  get decodesImmediately(): boolean {
    return this.isFile;
  }

  /**
   * A node of the file is the file's bytes, at the file's offsets; a
   * decompressed buffer is not.
   *
   * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.keepsOffsets
   */
  get keepsOffsets(): boolean {
    return this.isFile;
  }

  /**
   * A decompressed body says what it was compressed with. A node of the file is
   * the file's bytes, but it goes back through the planner — it may change
   * length, and the volume around it is laid out again — which the badge says
   * too.
   *
   * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.badge
   */
  get badge(): PartBadge {
    if (this.isFile) {
      return {
        text: L("Structure", { context: "part badge" }),
        explanation: L(
          "A structure of the image. Update in Parent lays the image out again around it, so its length may change."
        ),
      };
    }
    return {
      text: this.transform ?? L("Decompressed", { context: "part badge" }),
      explanation: L(
        "Decompressed from the file. Update in Parent compresses it again the way the section was compressed."
      ),
    };
  }

  /**
   * What a decompressed buffer was compressed with; a node of the file is the file's bytes.
   *
   * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.transform
   */
  get transform(): string | undefined {
    if (this.isFile) return undefined;
    return this.compression ?? L("Decompressed", { context: "part badge" });
  }

  /** @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.decode */
  async decode(parent: PartParent): Promise<Uint8Array> {
    const range = this.target.range;
    if (this.isFile) {
      const [start, end] = range === undefined ? parent.source : [range.start, range.end];
      return parent.content.read(start, end - start);
    }
    const bytes = await readSpaceBytes(
      this.pane,
      this.target.space,
      range === undefined ? undefined : [range.start, range.end]
    );
    if (bytes === undefined) {
      throw new PartRefusal(
        LocalizedText.of("Those bytes could not be read."),
        LocalizedText.of("A compressed section on the way to the part no longer decompresses.")
      );
    }
    return bytes;
  }

  /**
   * The planner, over the parent's whole file as it is now, in the parent's own
   * worker — which reads the protected ranges in the parse the plan makes
   * anyway (§6.4).
   *
   * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.encode
   */
  async encode(part: Uint8Array, parent: PartParent): Promise<PartUpdate> {
    const accepting = [...(parent.overrides ?? [])].flatMap((token) => {
      const caution = cautionOfToken(token);
      return caution === undefined ? [] : [caution];
    });
    const answer = await askFirmwareRebuild(
      this.pane,
      part,
      this.target,
      (phase, fraction) => parent.progress?.(phase, fraction),
      accepting
    );
    const plan = answer?.plan;
    if (answer?.caution !== undefined) throw refusalForCaution(answer.caution);
    if (plan === undefined) {
      throw new PartRefusal(
        LocalizedText.of("“%1$@” cannot be put back", parent.partName),
        answer?.refusal === undefined
          ? LocalizedText.of("Nothing was changed in %1$@.", parent.name)
          : LocalizedText.verbatim(answer.refusal)
      );
    }
    return {
      offset: plan.offset,
      bytes: plan.bytes,
      source: plan.source,
      notes:
        plan.warnings.length === 0
          ? [LocalizedText.of("Nothing was written inside a Boot Guard or vendor protected range.")]
          : plan.warnings.map(LocalizedText.verbatim),
    };
  }
}

/**
 * A caution of the planner, in the reader's language, with the choice to go on past it.
 *
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.refusal
 */
// help: pane.header.update-in-parent.psp-bios
export function refusalForCaution(caution: RebuildCaution): PartRefusal {
  return new PartRefusal(
    LocalizedText.of("The PSP may not accept “%1$@” after the change", caution.name),
    LocalizedText.of(
      "“%1$@” is the BIOS image the PSP decompresses itself at start-up. ByteRipper can compress it again, but the properties of the PSP's decompressor and the way the PSP checks the integrity of the original zlib block are not known. It is therefore not known whether the PSP will accept the changed image. If it does not, the board may not start.\n\nUpdate Anyway compresses the image again and writes it in place of the original. Keep a copy of the original dump.",
      caution.name
    ),
    { button: LocalizedText.of("Update Anyway"), token: tokenOfCaution(caution) }
  );
}

const PSP_BIOS_IMAGE = "psp-bios-image:";

/** @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.token */
export function tokenOfCaution(caution: RebuildCaution): string {
  return PSP_BIOS_IMAGE + caution.name;
}

/** @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartCodec.swift#UEFIPartCodec.caution */
export function cautionOfToken(token: string): RebuildCaution | undefined {
  if (!token.startsWith(PSP_BIOS_IMAGE)) return undefined;
  return { kind: "pspBIOSImage", name: token.slice(PSP_BIOS_IMAGE.length) };
}
