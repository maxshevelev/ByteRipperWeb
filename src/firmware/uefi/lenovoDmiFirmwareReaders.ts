import type { ImageReader } from "@/firmware/imageReader";
import { LenovoDMIArea } from "@/firmware/lenovoDmi/lenovoDmiArea";
import { keyId, type LenovoDMIKey } from "@/firmware/lenovoDmi/lenovoDmiFormat";
import { keyReferences } from "@/firmware/lenovoDmi/lenovoDmiKeyReferences";
import { allDMIStores } from "@/firmware/uefi/dmiStore";
import { guidText } from "@/firmware/uefi/efiGuid";
import type { SpaceReaders } from "@/firmware/uefi/spaceReaders";
import type { UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Which drivers of the image ask for which entries of Lenovo's DMI store — the
 * firmware's own answer to "what is this entry for".
 *
 * Read off the image itself rather than written down from one dump: the drivers
 * differ from platform to platform (an IdeaPad has no RGB keyboard driver to read
 * `0x0015`), and a list taken from one machine would be a claim about another. Every
 * PE and TE image in the tree is searched for the keys it names
 * (`keyReferences`).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIFirmwareReaders.swift#LenovoDMIFirmwareReaders
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIFirmwareReaders.swift#LenovoDMIFirmwareReaders.init
 */
export class LenovoDMIFirmwareReaders {
  /**
   * The drivers that name each key, by the name the image gives them — the UI
   * section's, or the file's GUID — sorted; keyed by `keyId`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIFirmwareReaders.swift#LenovoDMIFirmwareReaders.drivers
   */
  readonly drivers: ReadonlyMap<string, readonly string[]>;

  constructor(drivers: ReadonlyMap<string, readonly string[]>) {
    this.drivers = drivers;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIFirmwareReaders.swift#LenovoDMIFirmwareReaders.drivers */
  driversOf(key: LenovoDMIKey): readonly string[] {
    return this.drivers.get(keyId(key)) ?? [];
  }

  /**
   * Searches each driver under `roots` — a tree opened all the way down, compressed
   * sections included — for keys under `namespaces`: the namespaces the store holds,
   * so a key under one the store does not use is not looked for.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIFirmwareReaders.swift#LenovoDMIFirmwareReaders.find
   */
  static find(
    roots: readonly UEFINode[],
    readers: SpaceReaders,
    namespaces: readonly (readonly number[])[]
  ): LenovoDMIFirmwareReaders {
    const found = new Map<string, Set<string>>();
    // Each code section belongs to the file nearest above it: a driver inside a
    // compressed volume is that driver, not the file the volume is stored in.
    const walk = (node: UEFINode, file: UEFINode | undefined) => {
      const owner = node.kind === "file" ? node : file;
      if (
        node.kind === "section" &&
        owner !== undefined &&
        (node.name.includes("PE32") || node.name.includes("TE"))
      ) {
        const code = readers.readerFor(node.space)?.bytes(node.body);
        if (code !== undefined) {
          const name =
            owner.name.length > 0
              ? owner.name
              : owner.guid === undefined
                ? ""
                : guidText(owner.guid);
          for (const key of keyReferences(code, namespaces)) {
            const id = keyId(key);
            const names = found.get(id) ?? new Set<string>();
            names.add(name);
            found.set(id, names);
          }
        }
      }
      for (const child of node.children) walk(child, owner);
    };
    for (const root of roots) walk(root, undefined);
    return new LenovoDMIFirmwareReaders(
      new Map([...found].map(([id, names]) => [id, [...names].sort()]))
    );
  }

  /**
   * The namespaces the Lenovo stores among `roots` hold entries under.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/LenovoDMIFirmwareReaders.swift#LenovoDMIFirmwareReaders.namespaces
   */
  static namespaces(roots: readonly UEFINode[], reader: ImageReader): number[][] {
    const found = new Map<string, number[]>();
    for (const store of allDMIStores(roots)) {
      if (store.kind !== "lenovoDMIStore") continue;
      const stored = reader.bytes(store.range);
      const area = stored === undefined ? undefined : LenovoDMIArea.read(stored, store.range.start);
      for (const block of area?.blocks ?? []) {
        for (const entry of block.entries) {
          found.set(entry.key.namespace.join(","), [...entry.key.namespace]);
        }
      }
    }
    return [...found.values()];
  }
}
