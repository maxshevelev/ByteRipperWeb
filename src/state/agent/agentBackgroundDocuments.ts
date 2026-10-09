import { baseName } from "@/core/agent/agentSurvey";
import { AgentToolError } from "@/core/agent/agentTool";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { closeFirmware } from "@/state/firmwareStore";
import { closeBackgroundPane, openBackgroundPane, type PartId } from "@/state/workspaceStore";

/**
 * Files an agent opened by path, with no window (`Design/PORT_AGENT.md`, "Many dumps").
 *
 * Each is a pane no dock shows — the same document, the same chunked storage and the same shared
 * parse an open file has, so the tool-modules' queries answer about it exactly as they would on
 * screen, and nothing reads a file a second way. Read-only by use: nothing here writes, and the
 * tools that would refuse a document that is not on screen.
 *
 * Kept least recently used first, up to `limit`: a survey over fifty dumps must not end holding
 * fifty parsed images. A file changed on disk since it was opened is read again the next time it is
 * asked for, and keeps its id.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.limit
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.entries
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.Entry
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.evict
 * @upstream-differs the file is read through the shell's bridge into a Blob, and the pane is a part no dock lists
 */

/** What one read of the bridge returns at most. */
const CHUNK = 8 << 20;

export interface BackgroundEntry {
  /** What the agent calls it: `d1`, `d2`… and stays when the file is read again. */
  readonly id: string;
  /** The pane that holds the document now — a new one after the file changed on disk. */
  pane: PartId;
  readonly path: string;
  /** The file's modification time when it was read, milliseconds. */
  modified: number;
  size: number;
  lastUsed: number;
}

export class AgentBackgroundDocuments {
  /** How many are kept parsed at once. @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.limit */
  limit = 8;
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

  entryOf(pane: string): BackgroundEntry | undefined {
    return this.held.find((one) => one.pane === pane);
  }

  /**
   * The file at `path`, opened or already open. Throws what opening it threw — no such file, not
   * readable.
   *
   * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundDocuments.open
   */
  async open(path: string): Promise<BackgroundEntry> {
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
      id: this.mint(),
      pane,
      path: stat.path,
      modified: stat.modified,
      size: stat.size,
      lastUsed: this.tick(),
    };
    this.held.push(entry);
    this.evict(entry);
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

  private evict(kept: BackgroundEntry): void {
    while (this.held.length > this.limit) {
      const oldest = this.held
        .filter((one) => one !== kept)
        .reduce<BackgroundEntry | undefined>(
          (least, one) => (least === undefined || one.lastUsed < least.lastUsed ? one : least),
          undefined
        );
      if (oldest === undefined) return;
      this.close(oldest.pane);
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
