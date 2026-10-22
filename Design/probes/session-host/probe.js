const out = document.getElementById("out");
const results = {};
const worker = new SharedWorker("host.js", { name: "byteripper-s0" });
const port = worker.port;
let seq = 0;
const waits = new Map();
port.onmessage = ({ data }) => { const r = waits.get(data.id); waits.delete(data.id); r?.(data.answer); };
port.start();
const ask = (op, extra = {}, transfer = []) => new Promise((resolve) => {
  const id = ++seq; waits.set(id, resolve); port.postMessage({ id, op, ...extra }, transfer);
});
const stats = (xs) => { xs.sort((a, b) => a - b); const q = (p) => +xs[Math.floor(p * (xs.length - 1))].toFixed(3); return { median: q(0.5), p99: q(0.99), max: q(1) }; };
async function time(n, f) { const xs = []; for (let i = 0; i < n; i++) { const t = performance.now(); await f(i); xs.push(performance.now() - t); } return stats(xs); }

window.s0 = { ask, results };
(async () => {
  results.ua = navigator.userAgent;
  results.hello = await ask("hello");
  results.counterAfterIncr = await ask("incr");
  await time(50, () => ask("ping"));
  results.pingMs = await time(2000, () => ask("ping"));
  results.editMs = await time(2000, (i) => ask("edit", { at: i * 7, value: i & 255 }));
  results.read1KiBMs = await time(1000, (i) => ask("read", { at: i * 4096, length: 1024 }));
  results.read64KiBMs = await time(300, (i) => ask("read", { at: i * 65536, length: 65536 }));
  results.nestedJournal = await ask("nested");
  results.syncHandleInSharedWorker = await ask("syncHere");
  results.asyncOpfsInSharedWorker = await ask("asyncOpfs");
  try {
    const dir = await navigator.storage.getDirectory();
    const fh = await dir.getFileHandle("s0-handle.bin", { create: true });
    results.opfsHandlePassedToHost = await ask("handle", { handle: fh });
  } catch (e) { results.opfsHandlePassedToHost = { ok: false, why: String(e) }; }
  results.append = [await ask("appendCost", { mib: 4 }), await ask("appendCost", { mib: 64 })];
  results.manyFiles = await ask("manyFiles");
  results.blob = await ask("blob");
  results.done = true;
  out.textContent = JSON.stringify(results, null, 1);
  if (location.search.includes("report")) fetch("/report", { method: "POST", body: JSON.stringify(results) }).catch(() => {});
})();
// The shell's main process hands a port over through the preload; the page passes it to the host.
window.addEventListener("message", async (e) => {
  if (e.data === "s0-shell-port" && e.ports[0]) results.shellPortHanded = await ask("shellPort", { port: e.ports[0] }, [e.ports[0]]);
});

window.s0.lend = async () => {
  const w = new Worker("lender.js");
  const { port1, port2 } = new MessageChannel();
  w.postMessage("port", [port2]);
  return ask("lend", { port: port1 }, [port1]);
};
