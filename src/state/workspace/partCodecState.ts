import { LocalizedText, type LocalizedTextWire } from "@/core/localization/localization";
import { CopyPartCodec, type PartCodec, ReadOnlyPartCodec } from "@/core/parts/partCodec";
import { LenovoDMIBlockCodec } from "@/firmware/lenovoDmi/lenovoDmiValue";
import type { LENVBlock } from "@/firmware/lenovoDmi/lenvBlock";
import type { RebuildTarget } from "@/firmware/uefi/uefiRebuild";
import type { PaneId } from "@/state/paneId";
import { UEFIPartCodec } from "@/state/uefiPartCodec";

/**
 * A part's codec as the workspace writes it down, and back (`Design/WORKSPACE.md`, "Parts"). A
 * codec this does not know is not written, and its part does not come back.
 *
 * @upstream ByteRipperApp/Workspace/PartCodecState.swift#PartCodecState
 */
export type PartCodecState =
  | { readonly kind: "copy" }
  | {
      readonly kind: "readOnly";
      readonly bytes: readonly number[];
      readonly title: LocalizedTextWire;
      readonly reason: LocalizedTextWire;
      readonly transform?: string | undefined;
    }
  | {
      readonly kind: "uefi";
      readonly target: RebuildTarget;
      readonly compression?: string | undefined;
    }
  | { readonly kind: "lenovoDMI"; readonly encodes: boolean; readonly key: number };

/** @upstream ByteRipperApp/Workspace/PartCodecState.swift#PartCodecState.init */
export function partCodecState(codec: PartCodec): PartCodecState | undefined {
  if (codec instanceof ReadOnlyPartCodec) {
    return {
      kind: "readOnly",
      bytes: [...codec.bytes],
      title: codec.title.toWire(),
      reason: codec.reason.toWire(),
      transform: codec.transform,
    };
  }
  if (codec instanceof CopyPartCodec) return { kind: "copy" };
  if (codec instanceof UEFIPartCodec) {
    return { kind: "uefi", target: codec.target, compression: codec.compression };
  }
  if (codec instanceof LenovoDMIBlockCodec) {
    return { kind: "lenovoDMI", encodes: codec.encodes, key: codec.key };
  }
  return undefined;
}

/**
 * The codec a state stands for, reading from `pane` — the parent as it is now, whose worker a
 * UEFI part's codec asks.
 *
 * @upstream ByteRipperApp/Workspace/PartCodecState.swift#PartCodecState.codec
 */
export function codecOf(state: PartCodecState, pane: PaneId): PartCodec {
  switch (state.kind) {
    case "copy":
      return new CopyPartCodec();
    case "readOnly":
      return new ReadOnlyPartCodec(
        Uint8Array.from(state.bytes),
        LocalizedText.fromWire(state.title),
        LocalizedText.fromWire(state.reason),
        state.transform
      );
    case "uefi":
      return new UEFIPartCodec({ pane, target: state.target, compression: state.compression });
    case "lenovoDMI":
      return new LenovoDMIBlockCodec({
        encoding: state.encodes ? "encoded" : "plain",
        xorKey: state.key,
      } as LENVBlock);
  }
}
