// S0 probe: the session host. One object every connected window reaches.
const hostId = Math.random().toString(36).slice(2, 8);
const state = { counter: 0, ports: 0 };
const SIZE = 64 << 20;
const content = new Uint8Array(SIZE);
for (let i = 0; i < SIZE; i += 4096) content[i] = i >>> 12;
let shell; // a MessagePort to the shell's main process, once a window hands one over
let shellSeq = 0;
const shellWaits = new Map();

async function nested() {
  if (typeof Worker === "undefined") return { ok: false, why: "no Worker in a SharedWorker" };
  return new Promise((resolve) => {
    let w;
    try { w = new Worker("journal.js"); } catch (e) { return resolve({ ok: false, why: String(e) }); }
    const t = setTimeout(() => resolve({ ok: false, why: "timeout" }), 5000);
    w.onmessage = (e) => { clearTimeout(t); resolve(e.data); w.terminate(); };
    w.onerror = (e) => { clearTimeout(t); resolve({ ok: false, why: "error " + (e.message || "") }); };
    w.postMessage("go");
  });
}

async function syncHere() {
  try {
    const dir = await navigator.storage.getDirectory();
    const fh = await dir.getFileHandle("s0-shared.bin", { create: true });
    if (typeof fh.createSyncAccessHandle !== "function") return { ok: false, why: "no createSyncAccessHandle" };
    const h = await fh.createSyncAccessHandle();
    h.close();
    return { ok: true };
  } catch (e) { return { ok: false, why: String(e) }; }
}

async function asyncOpfs() {
  try {
    const dir = await navigator.storage.getDirectory();
    const fh = await dir.getFileHandle("s0-async.bin", { create: true });
    const w = await fh.createWritable({ keepExistingData: true });
    await w.write({ type: "write", position: 0, data: new Uint8Array([1, 2, 3, 4]) });
    await w.close();
    const back = new Uint8Array(await (await fh.getFile()).arrayBuffer());
    return { ok: back[3] === 4, size: back.length };
  } catch (e) { return { ok: false, why: String(e) }; }
}

async function writeHandle(handle) {
  try {
    const perm = handle.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "n/a";
    const w = await handle.createWritable();
    await w.write(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    await w.close();
    const f = await handle.getFile();
    return { ok: f.size === 4, perm, name: handle.name };
  } catch (e) { return { ok: false, why: String(e) }; }
}

function askShell(what) {
  if (!shell) return Promise.resolve({ ok: false, why: "no shell port" });
  const id = ++shellSeq;
  return new Promise((resolve) => { shellWaits.set(id, resolve); shell.postMessage({ id, what }); });
}

onconnect = (event) => {
  const port = event.ports[0];
  state.ports++;
  port.onmessage = async ({ data }) => {
    const { id, op } = data;
    let answer;
    switch (op) {
      case "hello": answer = { hostId, ports: state.ports }; break;
      case "ping": answer = 0; break;
      case "incr": answer = ++state.counter; break;
      case "get": answer = state.counter; break;
      case "read": {
        const bytes = content.slice(data.at, data.at + data.length);
        port.postMessage({ id, answer: bytes }, [bytes.buffer]);
        return;
      }
      case "edit": content[data.at] = data.value; answer = { size: SIZE, generation: ++state.counter }; break;
      case "appendCost": answer = await appendCost(data.mib); break;
      case "manyFiles": answer = await manyFiles(); break;
      case "nested": answer = await nested(); break;
      case "syncHere": answer = await syncHere(); break;
      case "asyncOpfs": answer = await asyncOpfs(); break;
      case "handle": answer = await writeHandle(data.handle); break;
      case "blob": {
        const blob = new Blob([content.subarray(0, 1 << 20)]);
        answer = { size: blob.size };
        break;
      }
      case "lend": {
        lent = data.port; lentSeq = 0;
        lent.onmessage = ({ data: m }) => { const r = lentWaits.get(m.id); lentWaits.delete(m.id); r?.(m.answer); };
        answer = true; break;
      }
      case "lent": answer = await askLent(data.what); break;
      case "shellPort":
        shell = data.port;
        shell.onmessage = ({ data: m }) => { const r = shellWaits.get(m.id); shellWaits.delete(m.id); r?.(m.answer); };
        answer = true; break;
      case "askShell": answer = await askShell(data.what); break;
      default: answer = { ok: false, why: "unknown " + op };
    }
    port.postMessage({ id, answer });
  };
};

async function appendCost(mib) {
  try {
    const dir = await navigator.storage.getDirectory();
    const fh = await dir.getFileHandle("s0-append.bin", { create: true });
    let w = await fh.createWritable();
    for (let i = 0; i < mib; i++) await w.write(new Uint8Array(1 << 20).fill(i));
    await w.close();
    const xs = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      w = await fh.createWritable({ keepExistingData: true });
      await w.write({ type: "write", position: (mib << 20) + i * 4096, data: new Uint8Array(4096) });
      await w.close();
      xs.push(performance.now() - t);
    }
    xs.sort((a, b) => a - b);
    return { ok: true, fileMiB: mib, append4KiBMedianMs: +xs[5].toFixed(1) };
  } catch (e) { return { ok: false, why: String(e) }; }
}

// A journal as records written once each, in files of their own: no file is ever reopened to append.
async function manyFiles() {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("s0-runs", { create: true });
    const xs = [];
    for (let i = 0; i < 200; i++) {
      const t = performance.now();
      const fh = await dir.getFileHandle("run-" + i, { create: true });
      const w = await fh.createWritable();
      await w.write(new Uint8Array(4096).fill(i));
      await w.close();
      xs.push(performance.now() - t);
    }
    const t = performance.now();
    const back = new Uint8Array(await (await (await dir.getFileHandle("run-77")).getFile()).slice(10, 14).arrayBuffer());
    const readMs = performance.now() - t;
    xs.sort((a, b) => a - b);
    for (let i = 0; i < 200; i++) await dir.removeEntry("run-" + i);
    return { ok: back[0] === 77, write4KiBMedianMs: +xs[100].toFixed(2), p99: +xs[198].toFixed(2), readMs: +readMs.toFixed(2) };
  } catch (e) { return { ok: false, why: String(e) }; }
}

let lent, lentSeq = 0; const lentWaits = new Map();
function askLent(what) {
  if (!lent) return Promise.resolve({ ok: false, why: "nothing lent" });
  const id = ++lentSeq;
  return new Promise((resolve) => {
    const t = setTimeout(() => { lentWaits.delete(id); resolve({ ok: false, why: "no answer (lender gone)" }); }, 1500);
    lentWaits.set(id, (a) => { clearTimeout(t); resolve(a); });
    lent.postMessage({ id, ...what }, what.bytes ? [what.bytes.buffer] : []);
  });
}
