import { describe, expect, it } from "vitest";
import type { OperationSpan } from "@/core/session/sessionProtocol";
import { SessionStorage } from "@/core/session/sessionStorage";
import { ChunkCache } from "@/core/storage/chunkCache";

/**
 * What a window has read of a session stays true through the host's edits: laid over, shifted, or
 * forgotten — never stale. Checked against the content itself after every one of many edits, with
 * chunks small enough that every edit crosses some.
 */

/** A deterministic stream of numbers, so a failure is the same failure every run. */
function numbers(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % below;
  };
}

function hostContent(initial: number[]) {
  let content: Uint8Array<ArrayBuffer> = Uint8Array.from(initial);
  let generation = 0;
  return {
    get content() {
      return content;
    },
    reader: {
      get size() {
        return content.length;
      },
      get contentGeneration() {
        return generation;
      },
      readChunk: async (at: number, length: number) => ({
        bytes: content.slice(at, Math.min(at + length, content.length)),
        generation,
      }),
    },
    edit(next: Uint8Array<ArrayBuffer>) {
      content = next;
      generation++;
    },
  };
}

describe("a window's chunks of a session", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`stay true through a run of edits (seed ${seed})`, async () => {
      const next = numbers(seed);
      const host = hostContent(Array.from({ length: 300 }, (_, at) => at & 0xff));
      const storage = new SessionStorage("s", host.reader, new ChunkCache({ chunkSize: 16 }));

      for (let step = 0; step < 200; step++) {
        // Read some of it, as a screen does.
        const from = next(host.content.length + 1);
        await storage.prefetch(from, next(80) + 1);

        const before = host.content;
        const at = next(before.length + 1);
        const kind = (["overwrite", "insert", "delete"] as const)[next(3)];
        const carries = next(4) !== 0;
        let span: OperationSpan;
        let after: Uint8Array<ArrayBuffer>;
        if (kind === "overwrite" && at < before.length) {
          const count = Math.min(next(40) + 1, before.length - at);
          const bytes = Uint8Array.from({ length: count }, () => next(256));
          after = before.slice();
          after.set(bytes, at);
          span = { kind, at, count, ...(carries ? { bytes } : {}) };
        } else if (kind === "delete" && at < before.length) {
          const count = Math.min(next(40) + 1, before.length - at);
          after = new Uint8Array([...before.subarray(0, at), ...before.subarray(at + count)]);
          span = { kind, at, count };
        } else {
          const count = next(40) + 1;
          const bytes = Uint8Array.from({ length: count }, () => next(256));
          after = new Uint8Array([...before.subarray(0, at), ...bytes, ...before.subarray(at)]);
          span = { kind: "insert", at, count, ...(carries ? { bytes } : {}) };
        }
        host.edit(after);
        storage.apply([span], after.length);

        for (let offset = 0; offset < after.length; offset += 7) {
          const length = next(50) + 1;
          const peeked = storage.peek(offset, length);
          if (peeked === undefined) continue;
          expect(Array.from(peeked), `step ${step}, ${kind} at ${at}, peek ${offset}`).toEqual(
            Array.from(after.subarray(offset, Math.min(offset + length, after.length)))
          );
        }
      }
      expect(Array.from(await storage.read(0, host.content.length))).toEqual(
        Array.from(host.content)
      );
    });
  }

  it("keep what an edit did not touch, so a typed byte is painted without a read", async () => {
    const host = hostContent(Array.from({ length: 64 }, (_, at) => at));
    const storage = new SessionStorage("s", host.reader, new ChunkCache({ chunkSize: 16 }));
    await storage.prefetch(0, 64);
    const after = host.content.slice();
    after[20] = 0xee;
    host.edit(after);
    storage.apply([{ kind: "overwrite", at: 20, count: 1, bytes: Uint8Array.of(0xee) }], 64);
    expect(storage.peek(16, 8)?.[4]).toBe(0xee);

    const inserted = new Uint8Array([...after.subarray(0, 5), 9, ...after.subarray(5)]);
    host.edit(inserted);
    storage.apply([{ kind: "insert", at: 5, count: 1, bytes: Uint8Array.of(9) }], 65);
    expect(Array.from(storage.peek(0, 65) ?? [])).toEqual(Array.from(inserted));
  });
});
