import { describe, expect, it } from "vitest";
import { LineFramer } from "@/core/agent/lineFramer";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";

/** Ported from `LineFramerTests.swift`. */

const lines = (framer: LineFramer, text: string): string[] =>
  framer
    .append(encodeUtf8(text))
    .map((line) => (line.kind === "message" ? decodeUtf8(line.bytes) : "<too long>"));

describe("the line framer", () => {
  // @upstream Packages/AgentKit/Tests/AgentKitTests/LineFramerTests.swift#LineFramerTests.testAMessageSplitAcrossChunksIsHeldUntilItsNewline
  it("holds a message split across chunks until its newline", () => {
    const framer = new LineFramer();
    expect(lines(framer, '{"a":')).toEqual([]);
    expect(lines(framer, "1}")).toEqual([]);
    expect(lines(framer, "\n")).toEqual(['{"a":1}']);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/LineFramerTests.swift#LineFramerTests.testSeveralMessagesInOneChunk
  it("cuts several messages out of one chunk", () => {
    const framer = new LineFramer();
    expect(lines(framer, "one\ntwo\nthr")).toEqual(["one", "two"]);
    expect(lines(framer, "ee\n")).toEqual(["three"]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/LineFramerTests.swift#LineFramerTests.testACarriageReturnBeforeTheNewlineIsDropped
  it("drops a carriage return before the newline", () => {
    const framer = new LineFramer();
    expect(lines(framer, "one\r\ntwo\r")).toEqual(["one"]);
    expect(lines(framer, "\n")).toEqual(["two"]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/LineFramerTests.swift#LineFramerTests.testBlankLinesAreNotMessages
  it("does not take a blank line for a message", () => {
    expect(lines(new LineFramer(), "\n\r\none\n\n")).toEqual(["one"]);
  });

  // A character split between two reads is put back together, because the framer cuts bytes, not
  // characters.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/LineFramerTests.swift#LineFramerTests.testAMultiByteCharacterSplitBetweenChunks
  it("puts a multi-byte character split between chunks back together", () => {
    const framer = new LineFramer();
    const bytes = encodeUtf8('"дамп"\n');
    expect(framer.append(bytes.subarray(0, 2))).toEqual([]);
    const done = framer.append(bytes.subarray(2));
    expect(done).toEqual([{ kind: "message", bytes: bytes.subarray(0, bytes.length - 1) }]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/LineFramerTests.swift#LineFramerTests.testALineOverTheBoundIsRefusedOnceAndTheNextOneIsRead
  it("refuses a line over the bound once and reads the next", () => {
    expect(lines(new LineFramer(8), "0123456789\nok\n")).toEqual(["<too long>", "ok"]);
  });

  // A peer that never sends a newline costs the bound, not the memory: the line is refused as
  // soon as it passes it, and its tail is skipped.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/LineFramerTests.swift#LineFramerTests.testALineThatOverrunsAcrossChunksIsSkippedToItsNewline
  it("skips a line that overruns across chunks to its newline", () => {
    const framer = new LineFramer(8);
    expect(lines(framer, "01234")).toEqual([]);
    expect(lines(framer, "56789")).toEqual(["<too long>"]);
    expect(lines(framer, "abcdefghijklmn")).toEqual([]);
    expect(lines(framer, "op\nnext\n")).toEqual(["next"]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/LineFramerTests.swift#LineFramerTests.testALineExactlyAtTheBoundIsRead
  it("reads a line exactly at the bound", () => {
    expect(lines(new LineFramer(4), "abcd\n")).toEqual(["abcd"]);
  });
});
