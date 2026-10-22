onmessage = async () => {
  try {
    const dir = await navigator.storage.getDirectory();
    const fh = await dir.getFileHandle("s0-journal.bin", { create: true });
    const h = await fh.createSyncAccessHandle();
    const t0 = performance.now();
    const block = new Uint8Array(1 << 20).fill(7);
    for (let i = 0; i < 16; i++) h.write(block, { at: i << 20 });
    h.flush();
    const back = new Uint8Array(4);
    h.read(back, { at: (15 << 20) + 5 });
    const size = h.getSize();
    h.truncate(0); h.close();
    postMessage({ ok: back[0] === 7 && size === 16 << 20, mibPerSec: Math.round(16 / ((performance.now() - t0) / 1000)) });
  } catch (e) { postMessage({ ok: false, why: String(e) }); }
};
