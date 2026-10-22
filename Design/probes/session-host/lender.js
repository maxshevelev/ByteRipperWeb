// A journal worker a window lends to the host: it holds a sync handle open and answers over a port.
let handle;
onmessage = async ({ data, ports }) => {
  if (data !== "port") return;
  const port = ports[0];
  port.onmessage = async ({ data: m }) => {
    try {
      if (m.op === "open") {
        const t = performance.now();
        const dir = await navigator.storage.getDirectory();
        const fh = await dir.getFileHandle("s0-lent.bin", { create: true });
        handle = await fh.createSyncAccessHandle();
        port.postMessage({ id: m.id, answer: { ok: true, openMs: +(performance.now() - t).toFixed(1) } });
      } else if (m.op === "append") {
        const at = handle.getSize();
        handle.write(m.bytes, { at }); handle.flush();
        port.postMessage({ id: m.id, answer: { ok: true, size: handle.getSize() } });
      }
    } catch (e) { port.postMessage({ id: m.id, answer: { ok: false, why: String(e) } }); }
  };
};
