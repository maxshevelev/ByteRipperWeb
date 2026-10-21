import { afterEach, describe, expect, it } from "vitest";
import { LocalizedText } from "@/core/localization/localization";
import { CopyPartCodec, ReadOnlyPartCodec } from "@/core/parts/partCodec";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { openGivenPart } from "@/state/testing/givenParts";
import { closePart, openEmptyInPane, paneState, workspaceStore } from "@/state/workspaceStore";
import { partTransform } from "@/ui/fragments/partTransform";

/**
 * What a pill says the part's bytes went through. Upstream reads the pills off
 * the strip; here the item the strip is given is worked out from the
 * workspace, so that is what is read.
 *
 * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests
 */

afterEach(() => {
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

async function fileInA(): Promise<void> {
  openEmptyInPane("a", "bios.bin");
  await paneState("a")?.document.insert(0, new Uint8Array(0x400));
}

const readOnly = (bytes: Uint8Array, reason: string, transform: string): ReadOnlyPartCodec =>
  new ReadOnlyPartCodec(
    bytes,
    LocalizedText.verbatim("No"),
    LocalizedText.verbatim(reason),
    transform
  );

describe("a pill's codec", () => {
  /**
   * A part whose bytes went through a codec wears the codec's word on its pill, after the
   * name — which no longer says it; one that is the file's own bytes wears none.
   *
   * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testAPillWearsTheCodecItsBytesWentThrough
   */
  it("is the codec its bytes went through, and nothing for the file's own", async () => {
    await fileInA();
    const copy = await openGivenPart({
      parent: "a",
      bytes: new Uint8Array(0x20),
      name: "part",
      source: [0x100, 0x120],
    });
    const bytes = new TextEncoder().encode("text");
    const codec = readOnly(bytes, "Nothing packs it again.", "bzip2");
    const overrides = await openGivenPart({
      parent: "a",
      bytes,
      name: "Overrides",
      source: [0x200, 0x220],
      back: codec,
    });
    const state = workspaceStore.getSnapshot();

    expect(partTransform(state, copy)).toBeUndefined();
    expect(partTransform(state, overrides)).toEqual({
      text: "bzip2",
      explanation: codec.badge.explanation,
    });
  });

  /**
   * A node opened out of a decompressed part holds decompressed bytes as much as the part
   * does: its pill wears the part's codec, though its own only copies, and the pointer says
   * where the codec was.
   *
   * @upstream ByteRipperTests/FragmentPanelTests.swift#FragmentPanelTests.testAPartOfADecompressedPartWearsItsCodec
   */
  it("is the decompressed part's for a part taken out of it", async () => {
    await fileInA();
    const section = await openGivenPart({
      parent: "a",
      bytes: new Uint8Array(0x40).fill(0x11),
      name: "Section",
      source: [0x200, 0x220],
      back: readOnly(new Uint8Array(0x40).fill(0x11), "A test body.", "LZMA"),
    });
    const driver = await openGivenPart({
      parent: section,
      bytes: new Uint8Array(0x10).fill(0x11),
      name: "Driver",
      source: [0x10, 0x20],
      back: new CopyPartCodec(),
    });
    const state = workspaceStore.getSnapshot();

    expect(partTransform(state, section)?.text).toBe("LZMA");
    // The node is as decompressed as the body it came out of.
    expect(partTransform(state, driver)).toEqual({
      text: "LZMA",
      explanation:
        "Part of “Section”, whose bytes were converted with LZMA when taken out of the file.",
    });
  });
});
