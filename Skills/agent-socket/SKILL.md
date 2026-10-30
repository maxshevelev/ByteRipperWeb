---
name: agent-socket
description: Talk to a running ByteRipper desktop shell over its own agent endpoint when the editor's MCP client cannot — the tools report "server has disconnected", the session is a fork that never got a server, or a shell is the only way in. The same newline-delimited JSON-RPC 2.0 and the same tools the MCP server serves (documents, open_dump, read, find_bytes, me_summary, survey, …), from a stdlib-only script. Use to check what the app sees without a client, to read a dump's facts from a terminal, or to keep working while the relay is being restarted.
---

# The agent endpoint

Ported from upstream's `Skills/agent-socket`. The agent service is the desktop
shell's (`Design/PORT_AGENT.md`): the browser edition has none, and this reaches
nothing there.

The shell serves the agent protocol on its endpoint (`desktop/agent-endpoint.cjs`):
a named pipe on Windows, `\\.\pipe\ByteRipper-agent-<user>`, and a Unix socket
in the profile elsewhere — `~/Library/Application Support/ByteRipper/agent.sock`
on macOS, `~/.config/ByteRipper/agent.sock` on Linux. The editor's client never
reaches it directly: it launches **the relay** (`desktop/relay.cjs`, run by
ByteRipper's own executable as Node) and the relay copies bytes between the
client's stdio and the endpoint.

The relay is built to outlive the app — the app may be quit and opened again in
the middle of a conversation, and the relay waits and attaches again. What it
cannot survive is its own process going away: a client that does not restart a
server that exited inside a session shows the tools as disconnected for the rest
of that session, and starting a session as a fork of another leaves the new one
with no server at all. The app is fine in both cases, and this script is how to
keep working.

## What it does

`scripts/agent_socket.py` connects to the endpoint and speaks the protocol
itself: the legacy `initialize` handshake (`protocolVersion`, newest of the four
the app takes), then `tools/list` and `tools/call`. No dependencies beyond the
standard library, no configuration, and nothing to install. On Windows the pipe
is opened as a file.

```bash
S=Skills/agent-socket/scripts/agent_socket.py

python3 $S ping                     # the server's name and the version it agreed on
python3 $S tools                    # every tool the app serves
python3 $S tools --with-document    # only the tools that read one open document
python3 $S call documents           # any tool, arguments as JSON
python3 $S call read '{"document": "d1", "offset": "0x2C2000", "length": 64}'
python3 $S call open_dump '{"path": "/Users/me/Desktop/ME/dump.bin"}'
python3 $S versions ~/Desktop/ME/*.bin      # family and version of each dump
python3 $S rows ~/Desktop/ME/dump.bin       # the ME panel's summary rows
python3 $S rows ~/Desktop/ME/dump.bin "Boot Guard" "Manufacturing"
```

`versions` opens each file in the background, reads the summary and closes it
again — the same answers the app's own `survey` gives over MCP, without a client
in the way. `rows` prints the summary's rows as the panel words them, which is
the check the MCP `me_summary` exists for: the same code path, the same labels.

The endpoint comes from `BYTERIPPER_AGENT_SOCKET` when it is set — a test's
endpoint, or a second build run beside the installed app — and from the
platform's place otherwise.

## What it is not

- **It does not start the app.** A refused connection means ByteRipper is not
  running, or its agent service is switched off (Settings ▸ Agent). The relay can
  start the app (`BYTERIPPER_LAUNCH`); this cannot, and says so.
- **It is not a replacement for the client's configuration.** A tool call made
  here is a call of the person's app: it opens documents in their window's
  background, and the editing tools (`write`, `update_in_parent`, the microcode
  tools) change open files exactly as they do for an agent. The read-only tools
  are the ones to reach for; anything that writes needs the person's permission
  in the app, as it does over MCP.
- **It holds no session state.** Every run is one connection, handshake and
  call, then closes. Long work belongs in one `call` (or in the app's own
  `survey`, which reports progress and can be stopped).
