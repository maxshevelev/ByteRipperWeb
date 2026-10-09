/**
 * Cuts a byte stream into the lines MCP sends one message on.
 *
 * The stream arrives in whatever pieces the transport hands over: half a message, three and
 * a half, a message split inside a multi-byte character. This holds the unfinished tail until
 * its newline comes, and nothing else.
 *
 * A line longer than `maxLineBytes` is refused rather than buffered: the bytes are dropped as
 * they arrive, up to the next newline, and the line is reported once as too long. A peer that
 * never sends a newline therefore costs a bounded buffer, not the app's memory.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/LineFramer.swift#LineFramer
 * @upstream Packages/AgentKit/Sources/AgentKit/LineFramer.swift#LineFramer.Line
 */
export type FramedLine =
  | { readonly kind: "message"; readonly bytes: Uint8Array }
  /** A line that went past the bound. Its bytes are gone. */
  | { readonly kind: "tooLong" };

export class LineFramer {
  /** @upstream Packages/AgentKit/Sources/AgentKit/LineFramer.swift#LineFramer.maxLineBytes */
  readonly maxLineBytes: number;
  private buffer: number[] = [];
  /** The current line has gone past the bound and is being skipped. */
  private discarding = false;

  /** @upstream Packages/AgentKit/Sources/AgentKit/LineFramer.swift#LineFramer.init */
  constructor(maxLineBytes: number = 4 << 20) {
    this.maxLineBytes = maxLineBytes;
  }

  /**
   * Takes the next piece of the stream and returns the lines it completed. Blank lines are
   * not messages and are not returned; a carriage return before the newline is dropped, so a
   * peer that writes `\r\n` is read the same as one that writes `\n`.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/LineFramer.swift#LineFramer.append
   */
  append(chunk: Uint8Array): FramedLine[] {
    const lines: FramedLine[] = [];
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      if (newline < 0) break;
      const piece = chunk.subarray(start, newline);
      start = newline + 1;
      if (this.discarding) {
        this.discarding = false;
        this.buffer = [];
        continue;
      }
      if (this.buffer.length + piece.length > this.maxLineBytes) {
        this.buffer = [];
        lines.push({ kind: "tooLong" });
        continue;
      }
      for (const byte of piece) this.buffer.push(byte);
      if (this.buffer.at(-1) === 0x0d) this.buffer.pop();
      if (this.buffer.length > 0)
        lines.push({ kind: "message", bytes: Uint8Array.from(this.buffer) });
      this.buffer = [];
    }
    if (this.discarding) return lines;
    const rest = chunk.subarray(start);
    if (this.buffer.length + rest.length > this.maxLineBytes) {
      this.buffer = [];
      this.discarding = true;
      lines.push({ kind: "tooLong" });
    } else {
      for (const byte of rest) this.buffer.push(byte);
    }
    return lines;
  }
}
