# S0 probe: the session host

What `Design/FILE_SESSIONS.md` S0 measured, kept so it can be run again — on a
new Electron, a new Safari, or Firefox, which S0 could not reach.

- `host.js` — the `SharedWorker`: a counter every window shares, a 64 MiB
  buffer read and edited by request, and the checks (a nested `Worker`, a sync
  access handle, async OPFS, a handle passed in, an append's cost, records
  written one file each, a lent journal worker, a port to the shell).
- `journal.js` — a nested dedicated worker with a sync access handle.
- `lender.js` — a journal worker a window creates and lends to the host.
- `index.html` + `probe.js` — the page; results in `window.s0.results`, and
  POSTed to `/report` when the address carries `?report`.

In the shell (two `BrowserWindow`s, the app's privileges, a
`MessageChannelMain` to the host, the lent worker carried across a closed
window):

    cd desktop && ./node_modules/.bin/electron ../Design/probes/session-host/main.cjs

In a browser, two tabs of:

    python3 Design/probes/session-host/server.py 5288   # then http://127.0.0.1:5288/index.html?report

Reports land in `report.json` beside the server; `profile/` is the shell's.
Neither is committed.
