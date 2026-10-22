import { baseName } from "@/core/agent/agentSurvey";
import { AgentToolError } from "@/core/agent/agentTool";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { closeFirmware, heldFirmwareBytes } from "@/state/firmwareStore";
import { hostDocument } from "@/state/sessions/pageSessions";
import {
  closeBackgroundPane,
  openBackgroundPane,
  type PartId,
  paneState,
} from "@/state/workspaceStore";

/**
 * Files an agent opened by path, with no window (`Design/PORT_AGENT.md`, "Many dumps").
 *
 * Each is a pane no dock shows — the same document, the same chunked storage and the same shared
 * parse an open file has, so the tool-modules' queries answer about it exactly as they would on
 * screen, and nothing reads a file a second way. Read-only by use: nothing here writes, and the
 * tools that would refuse a document that is not on screen.
 *
 * Let go least recently used first, past either of two bounds the person sets in Settings ▸ Agent
 * (`AgentService`): how many files, and how much memory they hold between them. A survey over fifty
 * dumps must not end holding fifty parsed images. The file asked about last is kept whatever it
 * holds. A file let go keeps its id (`AgentDesk`): named again, it is read again. A file changed on
 * disk since it was opened is read again the next time it is asked for, and keeps its id.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.entries
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.Entry
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.clock
 * @upstream-differs the file is read through the shell's bridge into a Blob, and the pane is a part no dock lists
 */

/** What one read of the bridge returns at most. */
const CHUNK = 8 << 20;
const MIB = 1 << 20;

export interface BackgroundEntry {
  /**
   * What the agent calls it: `d1`, `d2`… and stays when the file is read again, or when it is let go
   * and named again.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.Entry.id
   * @upstream-differs minted when the file is opened rather than when an agent first asks for it,
   * every answer that opens one naming it
   */
  readonly id: string;
  /** The pane that holds the document now — a new one after the file changed on disk. */
  pane: PartId;
  readonly path: string;
  /** The file's modification time when it was read, milliseconds. */
  modified: number;
  size: number;
  /** When it was last asked about, on the clock. */
  lastUsed: number;
}

export class AgentBackgroundDocuments {
  private files: number = AGENT_BACKGROUND_LIMITS.defaultFiles;
  private memory = defaultMemoryMiB(defaultPhysicalMemory()) * MIB;
  /**
   * Told of each file let go to stay inside the bounds — not of one closed on purpose.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.onRelease
   */
  onRelease: ((entry: BackgroundEntry) => void) | undefined;
  private held: BackgroundEntry[] = [];
  private readonly bridge: () => AgentBridge | undefined;
  private readonly mint: () => string;
  /**
   * Counts the uses, so the last one is told apart from the one before even within a clock tick.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.clock
   */
  private clock = 0;
  /** The trims asked for, one after another: each weighs the files, which is a wait. */
  private trims: Promise<void> = Promise.resolve();

  constructor(bridge: () => AgentBridge | undefined, mint: () => string) {
    this.bridge = bridge;
    this.mint = mint;
  }

  get entries(): readonly BackgroundEntry[] {
    return this.held;
  }

  /**
   * How many are kept parsed at once.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.fileLimit
   */
  get fileLimit(): number {
    return this.files;
  }

  set fileLimit(count: number) {
    this.files = count;
    void this.trim();
  }

  /**
   * How many bytes they may hold between them (`heldBytesOf`).
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.memoryLimit
   */
  get memoryLimit(): number {
    return this.memory;
  }

  set memoryLimit(bytes: number) {
    this.memory = bytes;
    void this.trim();
  }

  entryOf(pane: string): BackgroundEntry | undefined {
    return this.held.find((one) => one.pane === pane);
  }

  /**
   * The file at `path`, opened or already open. Throws what opening it threw — no such file, not
   * readable.
   *
   * `id` is the one it had when it was let go to stay inside the bounds, for a file named again
   * (`AgentDesk`); a file already open answers under the id it has now.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.open
   */
  async open(path: string, id?: string): Promise<BackgroundEntry> {
    const bridge = this.bridge();
    if (bridge === undefined) {
      throw new AgentToolError("This build cannot read files by path.");
    }
    let stat: { path: string; size: number; modified: number; isDirectory: boolean };
    try {
      stat = await bridge.file({ op: "stat", path });
    } catch (error) {
      throw new AgentToolError(`Could not read ${path}: ${reason(error)}`);
    }
    if (stat.isDirectory) throw new AgentToolError(`Could not read ${path}: it is a folder.`);
    const known = this.held.find((one) => one.path === stat.path);
    if (known !== undefined && known.modified === stat.modified) {
      known.lastUsed = this.tick();
      return known;
    }
    let source: Blob;
    try {
      source = await readWhole(bridge, stat.path, stat.size);
    } catch (error) {
      throw new AgentToolError(`Could not open ${path}: ${reason(error)}`);
    }
    const pane = openBackgroundPane({
      name: baseName(stat.path),
      size: stat.size,
      lastModified: Math.floor(stat.modified),
      source,
      path: stat.path,
    });
    if (known !== undefined) {
      this.dispose(known.pane);
      known.pane = pane;
      known.modified = stat.modified;
      known.size = stat.size;
      known.lastUsed = this.tick();
      return known;
    }
    const entry: BackgroundEntry = {
      id: id ?? this.mint(),
      pane,
      path: stat.path,
      modified: stat.modified,
      size: stat.size,
      lastUsed: this.tick(),
    };
    this.held.push(entry);
    await this.trim();
    return entry;
  }

  /**
   * Reads the file again when it changed on disk, and marks it as just used. Nothing for a pane that
   * is not one of these.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.touch
   */
  async touch(pane: string): Promise<boolean> {
    const entry = this.entryOf(pane);
    if (entry === undefined) return false;
    try {
      await this.open(entry.path);
    } catch {
      // A file that cannot be read now keeps what was read of it.
    }
    return true;
  }

  /** @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.close */
  close(pane: string): void {
    const entry = this.entryOf(pane);
    if (entry === undefined) return;
    this.held = this.held.filter((one) => one !== entry);
    this.dispose(entry.pane);
  }

  /** @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.closeAll */
  closeAll(): void {
    for (const entry of this.held) this.dispose(entry.pane);
    this.held = [];
  }

  private dispose(pane: PartId): void {
    closeFirmware(pane);
    closeBackgroundPane(pane);
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }

  /**
   * What one holds in memory: the whole file, which the shell's bridge read into a Blob; what was
   * read of that Blob into the chunk cache, and any bytes added; and what its compressed sections
   * decompressed to. Its tree's nodes and the ME analysis are not counted; beside the buffers they
   * are small.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.Entry.heldBytes
   * @upstream-differs the file counts whole: upstream reads it from disk a chunk at a time and holds
   * only those, where the page can read a file only through the bridge, so it holds the Blob the
   * bridge filled; and the decompressed buffers are asked of the firmware worker that holds them
   */
  async heldBytesOf(entry: BackgroundEntry): Promise<number> {
    const view = paneState(entry.pane)?.document;
    const storage = view === undefined ? undefined : hostDocument(view).storage;
    const resident = storage instanceof EditOverlayStorage ? storage.residentByteCount : 0;
    return entry.size + resident + (await heldFirmwareBytes(entry.pane));
  }

  /**
   * What they hold between them.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.heldBytes
   */
  async heldBytes(): Promise<number> {
    const each = await Promise.all(this.held.map((entry) => this.heldBytesOf(entry)));
    return each.reduce((sum, one) => sum + one, 0);
  }

  /**
   * Lets go of the least recently used until both bounds hold, keeping the one used last. Run after
   * every call too: a file grows as it is asked about — a tree opened, a section decompressed.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.trim
   * @upstream-differs a wait, since the decompressed buffers are weighed in their worker; the trims
   * asked for run one after another, so two never let go of the same file
   */
  trim(): Promise<void> {
    this.trims = this.trims.then(
      () => this.trimNow(),
      () => this.trimNow()
    );
    return this.trims;
  }

  private async trimNow(): Promise<void> {
    if (this.held.length === 0) return;
    const weighed = await Promise.all(
      this.held.map(async (entry) => [entry, await this.heldBytesOf(entry)] as const)
    );
    const weights = new Map<BackgroundEntry, number>(weighed);
    const kept = this.held.reduce((last, one) => (one.lastUsed > last.lastUsed ? one : last));
    let held = this.held.reduce((sum, one) => sum + (weights.get(one) ?? 0), 0);
    while (this.held.length > this.files || held > this.memory) {
      const oldest = this.held
        .filter((one) => one !== kept)
        .reduce<BackgroundEntry | undefined>(
          (least, one) => (least === undefined || one.lastUsed < least.lastUsed ? one : least),
          undefined
        );
      if (oldest === undefined) return;
      held -= weights.get(oldest) ?? 0;
      this.close(oldest.pane);
      this.onRelease?.(oldest);
    }
  }
}

/** The whole file as a Blob, read through the bridge a chunk at a time so no copy outlives it. */
async function readWhole(bridge: AgentBridge, path: string, size: number): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < size; offset += CHUNK) {
    const bytes = await bridge.file({
      op: "read",
      path,
      offset,
      length: Math.min(CHUNK, size - offset),
    });
    if (bytes.length === 0) break;
    chunks.push(bytes.slice());
  }
  return new Blob(chunks, { type: "application/octet-stream" });
}

const reason = (error: unknown): string =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "")
    : String(error);

/**
 * The bounds Settings ▸ Agent offers for the files an agent opened by path
 * (`AgentBackgroundDocuments`), and what they are until the person picks.
 *
 * A parsed dump holds the file the bridge read, what was read of it into the cache — at most 32 MiB,
 * `ChunkCache` — and what its compressed sections decompressed to, at most 256 MiB a tree and some
 * tens of MiB for a usual BIOS. Eight files and 1 GiB keep a working set of dumps parsed on any
 * computer the app runs on; past a quarter of the computer's memory the agent's files would be
 * pushing the person's own work out of it.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.fileChoices
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.defaultFiles
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.memoryChoicesMiB
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.defaultMemoryMiBWanted
 */
export const AGENT_BACKGROUND_LIMITS = {
  fileChoices: [1, 2, 4, 8, 16, 32, 64],
  defaultFiles: 8,
  memoryChoicesMiB: [256, 512, 1024, 2048, 4096, 8192, 16384],
  defaultMemoryMiBWanted: 1024,
} as const;

/**
 * The memory bounds offered on a computer with `physicalMemory` bytes: up to a quarter of it, and
 * always the smallest.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.memoryChoicesMiB
 */
export function memoryChoicesMiB(physicalMemory: number): number[] {
  const quarter = Math.floor(physicalMemory / 4 / MIB);
  const offered = AGENT_BACKGROUND_LIMITS.memoryChoicesMiB.filter((mib) => mib <= quarter);
  return offered.length === 0 ? [AGENT_BACKGROUND_LIMITS.memoryChoicesMiB[0]] : offered;
}

/** @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.defaultMemoryMiB */
export function defaultMemoryMiB(physicalMemory: number): number {
  const offered = memoryChoicesMiB(physicalMemory);
  return (
    offered.findLast((mib) => mib <= AGENT_BACKGROUND_LIMITS.defaultMemoryMiBWanted) ??
    (offered[0] as number)
  );
}

/**
 * A kept value brought inside what is offered: the largest choice not over it — a setting made on a
 * computer with more memory, or written by hand — or `fallback` when there is none or nothing was
 * kept.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.snapped
 */
export function snapped(
  value: number | undefined,
  choices: readonly number[],
  fallback: number
): number {
  if (value === undefined || value <= 0) return fallback;
  return choices.findLast((choice) => choice <= value) ?? (choices[0] as number);
}

/**
 * The computer's memory, as far as the page can tell before the shell has said: what the browser
 * reports — rounded, and never more than 8 GiB — or 8 GiB.
 *
 * @upstream ByteRipperApp/Agent/AgentService.swift#AgentService.physicalMemory
 * @upstream-differs the shell's `os.totalmem()` replaces it once the page has asked
 * (`AgentRelayInfo.memory`); a page alone cannot know
 */
export function defaultPhysicalMemory(): number {
  const reported =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { deviceMemory?: number }).deviceMemory;
  return (typeof reported === "number" && reported > 0 ? reported : 8) * 1024 * MIB;
}
