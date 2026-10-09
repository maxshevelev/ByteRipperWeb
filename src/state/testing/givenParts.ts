import { CopyPartCodec, type PartCodec } from "@/core/parts/partCodec";
import { GivenBytesCodec } from "@/core/testing/partCodecs";
import type { UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import { openLinkedPart } from "@/state/openLinkedPart";
import type { PaneId, PartId } from "@/state/workspaceStore";

/**
 * A part with the test's own bytes in it, going back through `back` — a copy
 * unless the test says otherwise.
 *
 * @upstream ByteRipperTests/PartCodecTestSupport.swift#ToolHost.openPart
 * @upstream ByteRipperTests/PartCodecTestSupport.swift#PaneToolHost.openPart
 */
export async function openGivenPart(options: {
  readonly parent: PaneId;
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly source: readonly [number, number];
  readonly partName?: string;
  readonly layout?: UEFIRootLayout;
  readonly back?: PartCodec;
}): Promise<PartId> {
  const part = await openLinkedPart({
    parent: options.parent,
    name: options.name,
    source: options.source,
    partName: options.partName,
    layout: options.layout,
    codec: new GivenBytesCodec(options.bytes, options.back ?? new CopyPartCodec()),
  });
  if (part === undefined) throw new Error("the part did not open");
  return part;
}
