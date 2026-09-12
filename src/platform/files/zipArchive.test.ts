import { describe, expect, it } from "vitest";
import type { Bytes } from "@/core/storage/byteStorage";
import { ZipArchive } from "@/platform/files/zipArchive";

/**
 * The format is only worth writing by hand if what comes out is a ZIP every
 * tool opens, so these read the archive back the way one would: the records by
 * their signatures, and the entries by inflating them.
 */

const bytes = (...values: number[]) => new Uint8Array(values) as Bytes;

async function* one(chunk: Bytes): AsyncIterable<Bytes> {
  yield chunk;
}

const read = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

const u32 = (data: Uint8Array, at: number) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(at, true);
const u16 = (data: Uint8Array, at: number) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(at, true);

describe("an archive", () => {
  it("opens with a local file header and ends with the directory", async () => {
    const archive = new ZipArchive();
    await archive.add("bios_S0.bin", one(bytes(1, 2, 3, 4)));
    const data = await read(archive.build());

    expect(u32(data, 0)).toBe(0x0403_4b50);
    const end = data.length - 22;
    expect(u32(data, end)).toBe(0x0605_4b50);
    expect(u16(data, end + 10)).toBe(1);
    // The directory's offset and size have to point at the record that follows
    // the last entry — an unzip reads the archive backwards from here.
    const directoryAt = u32(data, end + 16);
    expect(u32(data, directoryAt)).toBe(0x0201_4b50);
    expect(directoryAt + u32(data, end + 12)).toBe(end);
  });

  it("names every part it was given", async () => {
    const archive = new ZipArchive();
    await archive.add("bios_S0.bin", one(bytes(0, 1, 2)));
    await archive.add("bios_S1.bin", one(bytes(3, 4, 5)));
    const data = await read(archive.build());

    const end = data.length - 22;
    expect(u16(data, end + 10)).toBe(2);
    const text = new TextDecoder().decode(data);
    expect(text).toContain("bios_S0.bin");
    expect(text).toContain("bios_S1.bin");
  });

  it("round-trips the bytes it was given", async () => {
    const content = new Uint8Array(4096) as Bytes;
    for (let index = 0; index < content.length; index++) content[index] = index & 0xff;
    const archive = new ZipArchive();
    await archive.add("part.bin", one(content));
    const data = await read(archive.build());

    // The one entry's body sits right after its local header and name.
    const nameLength = u16(data, 26);
    const method = u16(data, 8);
    const compressedSize = u32(data, 18);
    const body = data.slice(30 + nameLength, 30 + nameLength + compressedSize) as Bytes;

    const restored = method === 0 ? body : new Uint8Array(await inflate(body));
    expect(u32(data, 22)).toBe(content.length);
    expect([...restored]).toEqual([...content]);
  });

  // Already-compressed bytes deflate to more than they started as; storing them
  // is what the format's per-entry method is for.
  it("stores an entry deflate would make larger", async () => {
    const archive = new ZipArchive();
    await archive.add("tiny.bin", one(bytes(0x7f)));
    const data = await read(archive.build());

    expect(u16(data, 8)).toBe(0);
    expect(u32(data, 18)).toBe(1);
  });
});

async function inflate(body: Bytes): Promise<ArrayBuffer> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  void writer.write(body).then(() => writer.close());
  return await new Response(stream.readable).arrayBuffer();
}
