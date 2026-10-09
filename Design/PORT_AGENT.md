# ByteRipperWeb — porting the agent service (upstream `1a8901d`…`6c73dc6`)

> The plan of record for the agent service in the Electron build. Upstream's
> contract is `../ByteRipper/Design/AGENT_PROTOCOL.md` (kept word for word as
> `Design/AGENT_PROTOCOL.md` here once stage A1 lands); its design is
> `AGENT_PLAN.md`. This file is only what is different here.

## Decision

The agent service is **a feature of the Electron build**, not of the browser:
a page cannot listen on a socket nor be launched by a client. The browser
edition shows no Agent tab and no Agent button (`window.byteripperDesktop` has
no `agent`). It reverses the "not supported" row of `Design/GAPS.md` §2.1,
which now says "browser only".

## How it fits together

```
 Claude Code / Claude Desktop / Cursor
        │ stdio
        ▼
 ByteRipper.exe + relay.cjs (ELECTRON_RUN_AS_NODE=1)   — a relay: bytes in, bytes out
        │ named pipe  \\.\pipe\ByteRipper-agent-<user>     (Windows)
        │ Unix socket ~/…/ByteRipper/agent.sock, 0600      (macOS, Linux: a dev run)
        ▼
 desktop/main.cjs     — net.createServer; one id per connection; lines to the page
        │ IPC (preload bridge: byteripperDesktop.agent)
        ▼
 the page: src/state/agent/        — AgentService: connections, log, host tools
        ├─ src/core/agent/         — AgentKit: JSON-RPC lines, MCP both eras, registry, bounds, pages (pure)
        ├─ host tools              — documents, focus, read, reveal, open_panel, marks, edits, open_dump…
        ├─ module queries          — src/tools/*/…Agent*.ts, answered with the panel closed
        └─ panel actions           — run on the live session
```

- **Everything that is logic runs in the page**, where the documents, the
  stores and the workers are, and is tested by vitest. The main process knows
  no MCP: it copies lines between a pipe connection and the page, and keeps
  the switch (listen or not) the page tells it.
- **Windows adaptation.** The endpoint is a named pipe, `\\.\pipe\ByteRipper-agent-<user name>`
  (a pipe has no file mode; its default DACL is the creator's, and the name
  carries the user), moved by `BYTERIPPER_AGENT_SOCKET` as upstream's is. The
  relay is the app's own executable run as Node (`ELECTRON_RUN_AS_NODE=1`)
  over `relay.cjs`, shipped outside the asar; the client is configured with the
  executable, its argument and that variable, which Settings ▸ Agent writes out
  for Claude Code (`claude mcp add … --env ELECTRON_RUN_AS_NODE=1`) and Claude
  Desktop (the JSON block), with the real paths. The relay starts the app
  (detached) when the endpoint is missing and waits ten seconds.
- **Files by path** (`open_dump`, `survey`, `show`) cross the bridge as reads:
  `byteripperDesktop.agent.file` — `stat`, `list`, `read(path, offset, length)` —
  answered by the main process only while the service is switched on, and
  feeding a `ByteSource` the chunked storage reads through.
- **The Agent window** is a panel of the app, since there are no windows: the
  help book's place in the fragment dock, opened from the toolbar's menu
  (Window ▸ Agent) and by a button while the service is on.
- **Language.** An agent's answers are English whatever the window speaks:
  a scoped language override on `L()`, set around a call — in the page and in
  the firmware worker, which builds the UEFI detail.
- **Off by default.** Two switches in Settings ▸ Agent: the service, and "Let
  agents edit open files". Persisted by the page, handed to the shell at start.

## Stages

Each ends with the checks green and a commit.

- [x] **A1 — AgentKit.** `src/core/agent/`: JSON values and framing, MCP in
  both eras, the tool registry, arguments (hex or integer offsets), bounds,
  pages (`AgentPage`), endpoint names. Tests ported from `AgentKitTests`,
  including a legacy handshake and a modern discover-list-call, cancellation
  and progress. The protocol document comes across with it.
- [x] **A2 — The loop, end to end.** `desktop/` server and preload bridge, the
  relay, `AgentService` in the page, Settings ▸ Agent (switches, client
  configurations), the status mark, the Agent window with the log; `documents`,
  `focus`, `read`, `reveal`. Done through the real pipe and the real relay.
- [ ] **A3 — The seam.** `ToolAgent` (queries, actions, edits, comparisons,
  locators) on the tool module; the language override; `open_panel`.
- [ ] **A4 — UEFI.** `uefi_tree`, `uefi_node`, `uefi_find`, `uefi_at`,
  `uefi_node_data`, `uefi_select`, `uefi_selection`, `variables`,
  `variables_compare`, the locator.
- [ ] **A5 — Marks.** The layer on the pane, dashed in the agent's colour in the
  dump (and the minimap's gutter), the note under the pointer, the window's list.
- [ ] **A6 — Many dumps.** Background documents, `open_dump`, `close_dump`,
  `show`, `survey`, `finding`, `findings`.
- [ ] **A7 — FIT and ME.** `fit_table`, `microcode_catalogue`, `me_summary`,
  `me_tree`, `me_files_compare` with `MEFileComparison`; the ME locator.
- [ ] **A8 — Edits.** `write`, the edit switch, `uefi_fix_checksum`,
  `fit_fix_checksum`, `fit_add_microcode`, `fit_replace_microcode`,
  `fit_remove_microcode`.
- [ ] **A9 — Byte comparison and search.** `diff`, `compare`, `reveal_diff`,
  `find_bytes` (`MaskedSearch`), `open_part`.
- [ ] **A10 — Help and release.** The help page in en, de and ru with its
  anchors, the strings, the README, packaging (`relay.cjs` outside the asar),
  GAPS and the module map; a run of the packaged build.
