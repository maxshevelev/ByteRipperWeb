import { DEFAULT_BACKGROUND_FILES } from "@/core/agent/agentBackgroundLimits";
import { baseName } from "@/core/agent/agentSurvey";
import { AgentToolError } from "@/core/agent/agentTool";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { closeFirmware, firmwareHeldBytes } from "@/state/firmwareStore";
import { closeBackgroundPane, openBackgroundPane, type PartId } from "@/state/workspaceStore";

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

export interface BackgroundEntry {
  /**
   * What the agent calls it: `d1`, `d2`… and stays when the file is read again, or let go and read
   * again.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.Entry.id
   */
  readonly id: string;
  /** The pane that holds the document now — a new one after the file changed on disk. */
  pane: PartId;
  readonly path: string;
  /** The file's modification time when it was read, milliseconds. */
  modified: number;
  size: number;
  /** When it was last asked about, on the documents' clock. */
  lastUsed: number;
}

/**
 * The bytes `entry` holds in memory: the file, read whole, and what its compressed sections
 * decompressed to. Its tree's nodes and the ME analysis are not counted; beside the buffers they
 * are small.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.Entry.heldBytes
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/EditOverlayStorage.swift#EditOverlayStorage.residentByteCount
 * @upstream-differs the whole file is held — the page reads it into a Blob — where upstream counts the chunks its cache holds
 */
export const heldBytesOf = (entry: BackgroundEntry): number =>
  entry.size + firmwareHeldBytes(entry.pane);

export class AgentBackgroundDocuments {
  private files = DEFAULT_BACKGROUND_FILES;
  private memory = 1 << 30;
  /**
   * Told of each file let go to stay inside the bounds — not of one closed on purpose.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.onRelease
   */
  onRelease: ((entry: BackgroundEntry) => void) | undefined;
  private held: BackgroundEntry[] = [];
  private readonly bridge: () => AgentBridge | undefined;
  private readonly mint: () => string;
  private clock = 0;

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
    this.trim();
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
    this.trim();
  }

  /**
   * What they hold between them.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.heldBytes
   */
  get heldBytes(): number {
    return this.held.reduce((sum, one) => sum + heldBytesOf(one), 0);
  }

  entryOf(pane: string): BackgroundEntry | undefined {
    return this.held.find((one) => one.pane === pane);
  }

  /**
   * The file at `path`, opened or already open. Throws what opening it threw — no such file, not
   * readable.
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
    this.trim();
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
   * Lets go of the least recently used until both bounds hold, keeping the one used last. Run after
   * every call too: a file grows as it is asked about — a tree opened, a section decompressed.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.trim
   */
  trim(): void {
    const kept = this.held.reduce<BackgroundEntry | undefined>(
      (last, one) => (last === undefined || one.lastUsed > last.lastUsed ? one : last),
      undefined
    );
    if (kept === undefined) return;
    let held = this.heldBytes;
    while (this.held.length > this.files || held > this.memory) {
      const oldest = this.held
        .filter((one) => one !== kept)
        .reduce<BackgroundEntry | undefined>(
          (least, one) => (least === undefined || one.lastUsed < least.lastUsed ? one : least),
          undefined
        );
      if (oldest === undefined) return;
      held -= heldBytesOf(oldest);
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
