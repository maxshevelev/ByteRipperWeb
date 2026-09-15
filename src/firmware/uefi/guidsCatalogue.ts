import { type EFIGUID, guidFromText, guidKey } from "@/firmware/uefi/efiGuid";

/**
 * The UEFI GUID catalogue: a GUID and the name the community has given it.
 *
 * Half of what a tree shows is a lookup: a volume's file system, a file's
 * identity, a section's definition are GUIDs, and the same GUID means the same
 * thing in every image. This is the big, living catalogue UEFITool keeps on
 * GitHub — hundreds of names the hard-coded table only sketches — and the
 * structure tree names a node by it when it can.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/GuidsCatalogue.swift#GuidsCatalogue
 */
export class GuidsCatalogue {
  /**
   * Keyed by the GUID's text form; a GUID with no name is simply absent.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/GuidsCatalogue.swift#GuidsCatalogue.names
   */
  readonly names: ReadonlyMap<string, string>;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/GuidsCatalogue.swift#GuidsCatalogue.init */
  constructor(names: ReadonlyMap<string, string>) {
    this.names = names;
  }

  /**
   * The empty catalogue: what the tree shows before a download has landed. A
   * node with a GUID then shows the GUID itself, and the names fill in once a
   * fresh `common/guids.csv` arrives.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/GuidsCatalogue.swift#GuidsCatalogue.empty
   */
  static readonly empty = new GuidsCatalogue(new Map());

  /**
   * The name a GUID has here, or nothing when the catalogue has none for it —
   * the caller then shows the GUID itself.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/GuidsCatalogue.swift#GuidsCatalogue.name
   */
  nameOf(candidate: EFIGUID): string | undefined {
    return this.names.get(guidKey(candidate));
  }

  /**
   * Parses a `common/guids.csv`: homogeneous `UUID,Name` lines, no header, no
   * quoting.
   *
   * A line that is not a GUID and a name is skipped, not an error — a trailing
   * blank line is not worth failing a catalogue over. The name is everything
   * after the first comma, so a name that itself contains a comma survives.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/GuidsCatalogue.swift#GuidsCatalogue.parse
   */
  static parse(text: string): GuidsCatalogue {
    const names = new Map<string, string>();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const comma = trimmed.indexOf(",");
      if (comma < 0) continue;
      const parsed = guidFromText(trimmed.slice(0, comma).trim());
      if (parsed === undefined) continue;
      const name = trimmed.slice(comma + 1).trim();
      if (name.length === 0) continue;
      names.set(guidKey(parsed), name);
    }
    return new GuidsCatalogue(names);
  }
}
