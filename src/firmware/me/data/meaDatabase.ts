import type { FirmwareFamily } from "@/firmware/me/models/firmwareFacts";

/**
 * The firmware database the ME half consults to turn a manifest's RSA public
 * key into a family, and its signature into a catalogued firmware row.
 *
 * Kept the way upstream keeps it: the whole text as lines, searched per query
 * rather than indexed. A few thousand lines make a linear scan free, and the
 * lookup stays *byte for byte* what upstream's is — a substring match, split on
 * underscores, first hit wins. Indexing it would be faster and would quietly
 * differ, and this file's whole job is to agree.
 *
 * Ported from `Packages/MEFirmware/Data/MEADatabase.swift`.
 */

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.CSECells */
export interface CSECells {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.CSECells.sku */
  readonly sku: string | undefined;
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.CSECells.stepping */
  readonly stepping: string | undefined;
  /**
   * The token as the database spells it: `YPDM`, `NPDM`, `UPDM1`, `UPDM2`, `UPDM`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.CSECells.pdm
   */
  readonly pdm: string | undefined;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase */
export class MEADatabase {
  /**
   * The revision from the file's own header, when it has one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.revision
   */
  readonly revision: number | undefined;
  /**
   * Every non-empty line, verbatim — the search corpus.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.lines
   */
  readonly lines: readonly string[];
  /**
   * The public-key hashes the database knows to be pre-production keys.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.preProductionKeyHashes
   */
  readonly preProductionKeyHashes: ReadonlySet<string>;

  /**
   * The lines joined, with each line's start beside it.
   *
   * Every lookup here is "the first line containing this hash", and one
   * `indexOf` over the joined text finds it where a walk of the lines does the
   * same work a thousand times. The hashes searched for carry no newline, so a
   * match never straddles a line and the start table always names the right one.
   */
  private readonly haystack: string;
  private readonly lineStarts: readonly number[];

  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.init */
  constructor(
    options: {
      readonly revision?: number | undefined;
      readonly lines?: readonly string[];
      readonly preProductionKeyHashes?: ReadonlySet<string>;
    } = {}
  ) {
    this.revision = options.revision;
    this.lines = options.lines ?? [];
    this.preProductionKeyHashes = options.preProductionKeyHashes ?? new Set();

    const starts: number[] = [];
    let at = 0;
    for (const line of this.lines) {
      starts.push(at);
      at += line.length + 1;
    }
    this.haystack = this.lines.join("\n");
    this.lineStarts = starts;
  }

  static readonly empty = new MEADatabase();

  /**
   * Parses the file: its revision header, its line corpus, and its list of
   * pre-production keys.
   *
   * Additions to the database — a new firmware line, a new key — need no change
   * here. Only a change to the *grammar* does, which is the point of keeping the
   * corpus as text.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.parse
   */
  static parse(text: string): MEADatabase {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return new MEADatabase({
      revision: revisionIn(text),
      lines,
      preProductionKeyHashes: preProductionKeysIn(text),
    });
  }

  /** The first line containing `needle`, as an index into the lines. */
  private firstLineIndex(needle: string): number | undefined {
    if (needle.length === 0) return undefined;
    const hit = this.haystack.indexOf(needle);
    if (hit < 0) return undefined;
    // The last line start at or before the hit.
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((this.lineStarts[mid] ?? 0) <= hit) low = mid;
      else high = mid - 1;
    }
    return this.lineStarts.length === 0 ? undefined : low;
  }

  /**
   * The variant token whose key line carries `publicKeyHash`: the matched line
   * split on underscores, taking what comes second.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.variant
   */
  variantForKeyHash(publicKeyHash: string): string | undefined {
    const index = this.firstLineIndex(publicKeyHash);
    if (index === undefined) return undefined;
    const parts = (this.lines[index] ?? "").split("_");
    return parts.length > 1 ? parts[1] : undefined;
  }

  /**
   * The canonical firmware row whose signature hash is `signatureHash`.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.firmwareRow
   */
  firmwareRowForSignatureHash(signatureHash: string): string | undefined {
    const index = this.firstLineIndex(signatureHash);
    return index === undefined ? undefined : this.lines[index];
  }

  /**
   * Whether this public key is one the database knows to be pre-production.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.isPreProductionKey
   */
  isPreProductionKey(publicKeyHash: string): boolean {
    return this.preProductionKeyHashes.has(publicKeyHash);
  }

  /**
   * The manual cells of a firmware's own row: its SKU, the chipset stepping,
   * and the power-down mitigation token.
   *
   * Which cell holds what depends on the family, exactly as upstream's
   * per-family branches say. A stepping cell reading `X` or `XX` is the database
   * saying "not recorded", and comes back absent.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.cseCells
   */
  cseCellsIn(row: string, family: FirmwareFamily): CSECells | undefined {
    const cells = row.split("_");
    const cell = (index: number): string | undefined => {
      const value = cells[index];
      return value === undefined || value.length === 0 ? undefined : value;
    };
    const stepping = (index: number): string | undefined => {
      const value = cell(index);
      return value === undefined || value === "X" || value === "XX" ? undefined : value;
    };

    switch (family) {
      case "csme": {
        const raw = cell(4);
        const pdm =
          raw === undefined
            ? undefined
            : ["YPDM", "NPDM", "UPDM1", "UPDM2", "UPDM"].find((one) => raw.includes(one));
        return { sku: cell(2), stepping: stepping(3), pdm };
      }
      case "cstxe":
        return { sku: undefined, stepping: stepping(1), pdm: undefined };
      case "cssps":
        // Upstream reads a stepping here only from a row whose *last* cell is
        // `EXTR` — and every row's last cell is its signature hash, so the
        // branch never fires and a stepping is never taken for this family.
        // Reproduced as it is, because upstream's own output is what this is
        // checked against: a "fix" here would be a disagreement.
        if (cells.at(-1) !== "EXTR") {
          return { sku: undefined, stepping: undefined, pdm: undefined };
        }
        return { sku: undefined, stepping: stepping(3), pdm: undefined };
      default:
        return undefined;
    }
  }

  /**
   * The same cells, found by the firmware's signature hash.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.cseCells
   */
  cseCellsForSignatureHash(signatureHash: string, family: FirmwareFamily): CSECells | undefined {
    const row = this.firmwareRowForSignatureHash(signatureHash);
    return row === undefined ? undefined : this.cseCellsIn(row, family);
  }
}

// MARK: - The grammar

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.revision */
export function revisionIn(text: string): number | undefined {
  const found = /Revision\s+r(\d+)/.exec(text);
  return found?.[1] === undefined ? undefined : Number.parseInt(found[1], 10);
}

/**
 * The list of pre-production key hashes: what sits between the file's own
 * begin and end markers, with each line's trailing comment stripped, read as a
 * JSON array.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADatabase.swift#MEADatabase.preProductionKeys
 */
export function preProductionKeysIn(text: string): Set<string> {
  const begin = text.indexOf("rsa_pre_keys*BGN");
  if (begin < 0) return new Set();
  const end = text.indexOf("rsa_pre_keys*END", begin);
  if (end < 0) return new Set();

  const body = text
    .slice(begin + "rsa_pre_keys*BGN".length, end)
    .split("\n")
    .map((line) => {
      const comment = line.indexOf(" # ");
      return comment < 0 ? line : line.slice(0, comment);
    })
    .join("");
  try {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((one): one is string => typeof one === "string").map((one) => one.toUpperCase())
    );
  } catch {
    return new Set();
  }
}
