"""Talk to a running ByteRipper desktop shell over its own agent endpoint.

Upstream: Skills/agent-socket/scripts/agent_socket.py (ByteRipper, d01c9ab9).
Different here: the endpoint is the shell's (desktop/agent-endpoint.cjs) — a
named pipe on Windows, a socket in the profile elsewhere — so the path and the
way it is opened follow that file; the protocol and the tools are the same.

The editor's MCP client launches the relay (`relay.cjs`, run by ByteRipper's own
executable) that fronts this endpoint; with that server gone — a fork that never
got one, a relay whose process exited — this reaches the same service directly.
Same newline-delimited JSON-RPC 2.0, same legacy handshake, same tools: what the
app answers here is what it answers an agent.

Usage:
    python3 agent_socket.py ping
    python3 agent_socket.py tools [--with-document]
    python3 agent_socket.py call <tool> [<json arguments>]
    python3 agent_socket.py versions <path>...
    python3 agent_socket.py rows <path> [<label>...]

The endpoint is `\\\\.\\pipe\\ByteRipper-agent-<user>` on Windows,
`~/Library/Application Support/ByteRipper/agent.sock` on macOS and
`~/.config/ByteRipper/agent.sock` on Linux, or what `BYTERIPPER_AGENT_SOCKET`
names. The app must be running with its agent service
switched on: a refused connection means it is not, and nothing here starts it.

Read-only unless asked otherwise: `call` will make any tool the app serves,
including the ones that edit the person's open files.
"""

import getpass
import json
import os
import re
import socket
import sys

# The handshake versions the app answers, newest first (`MCPProtocol`). The
# client's own version when the app speaks it, and the newest one it does
# otherwise — the handshake's rule, which this follows by asking for the newest.
PROTOCOL_VERSION = "2025-11-25"


def socket_path(environment=None, platform=None):
    """Where the shell listens, as `endpoint()` in desktop/agent-endpoint.cjs says."""
    environment = os.environ if environment is None else environment
    platform = sys.platform if platform is None else platform
    if environment.get("BYTERIPPER_AGENT_SOCKET"):
        return environment["BYTERIPPER_AGENT_SOCKET"]
    if platform == "win32":
        try:
            name = getpass.getuser()
        except Exception:
            name = environment.get("USERNAME") or environment.get("USER") or ""
        name = re.sub(r"[^A-Za-z0-9._-]", "_", name) or "user"
        return "\\\\.\\pipe\\ByteRipper-agent-%s" % name
    if platform == "darwin":
        support = os.path.expanduser("~/Library/Application Support")
    else:
        support = environment.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(support, "ByteRipper", "agent.sock")


class PipeConnection:
    """A Windows named pipe, opened as a file: the shell's endpoint there.

    The pipe Node makes is a byte pipe, so a read returns what has arrived.
    The timeout is the socket's only; a pipe read waits until the app answers.
    """

    def __init__(self, path):
        self.pipe = open(path, "r+b", buffering=0)

    def sendall(self, data):
        self.pipe.write(data)

    def recv(self, size):
        return self.pipe.read(size)

    def close(self):
        self.pipe.close()


def connect(path, timeout):
    if path.startswith("\\\\.\\pipe\\"):
        return PipeConnection(path)
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(timeout)
    try:
        connection.connect(path)
    except OSError:
        connection.close()
        raise
    return connection


class Service:
    """One connection to the app, one handshake, as many calls as wanted."""

    def __init__(self, path=None, timeout=3600.0):
        self.path = path or socket_path()
        try:
            self.socket = connect(self.path, timeout)
        except OSError as error:
            raise SystemExit(
                "cannot reach ByteRipper at %s: %s\n"
                "The app must be running with its agent service switched on "
                "(Settings ▸ Agent). Nothing here starts it." % (self.path, error))
        self.buffer = b""
        self.next_id = 0
        self.server = self._initialize()

    def _initialize(self):
        answer = self.send("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "agent-socket (shell)", "version": "1"},
        })
        if "error" in answer:
            raise SystemExit("initialize failed: %s" % json.dumps(answer["error"]))
        info = answer["result"].get("serverInfo", {})
        return "%s %s (protocol %s)" % (info.get("name", "?"), info.get("version", "?"),
                                        answer["result"].get("protocolVersion", "?"))

    def send(self, method, params=None):
        self.next_id += 1
        message = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            message["params"] = params
        self.socket.sendall((json.dumps(message) + "\n").encode())
        return self._wait_for(self.next_id)

    def _wait_for(self, wanted):
        while True:
            while b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                if not line.strip():
                    continue
                message = json.loads(line)
                # Progress notifications carry no id of their own kind; the
                # answer is the message whose id is the one asked for.
                if message.get("id") == wanted and ("result" in message or "error" in message):
                    return message
            chunk = self.socket.recv(65536)
            if not chunk:
                raise SystemExit("the app closed the connection")
            self.buffer += chunk

    def call(self, tool, arguments=None):
        return self.send("tools/call", {"name": tool, "arguments": arguments or {}})

    def answer(self, tool, arguments=None):
        """A tool's answer as text, or the error it gave instead."""
        message = self.call(tool, arguments)
        if "error" in message:
            return "ERROR: %s" % json.dumps(message["error"])[:600]
        result = message.get("result", {})
        if result.get("isError"):
            return "TOOL ERROR: %s" % text_of(result)[:600]
        return text_of(result)

    def tools(self):
        answer = self.send("tools/list")
        return answer["result"]["tools"]

    def close(self):
        self.socket.close()


def text_of(result):
    parts = [item.get("text", "") for item in result.get("content", [])
             if item.get("type") == "text"]
    return "\n".join(parts)


def rows_of(summary_text):
    """The summary's rows, block by block, as (block title, label, value)."""
    try:
        summary = json.loads(summary_text)
    except ValueError:
        return []
    rows = []
    for block in summary.get("blocks", []):
        for row in block.get("rows", []):
            rows.append((block.get("title"), row.get("label", ""), row.get("value", "")))
    return rows


def value_of(rows, label, block=None):
    for title, row_label, value in rows:
        if row_label == label and (block is None or title == block):
            return value
    return None


def command_versions(service, paths):
    for path in paths:
        opened = service.answer("open_dump", {"path": path})
        try:
            document = json.loads(opened).get("document")
        except ValueError:
            document = None
        if document is None:
            print("%-20s %-6s %s" % ("-", "-", "%s: %s" % (path, opened.splitlines()[0][:80])))
            continue
        rows = rows_of(service.answer("me_summary", {"document": document}))
        print("%-20s %-6s %s" % (value_of(rows, "Version") or "-",
                                 value_of(rows, "Family") or "-", path))
        service.answer("close_dump", {"document": document})


def command_rows(service, path, labels):
    opened = service.answer("open_dump", {"path": path})
    document = json.loads(opened).get("document") if opened.strip().startswith("{") else None
    if document is None:
        raise SystemExit(opened[:400])
    rows = rows_of(service.answer("me_summary", {"document": document}))
    last_block = None
    for title, label, value in rows:
        if labels and label not in labels:
            continue
        if not labels and title != last_block:
            print("[%s]" % (title or "firmware"))
            last_block = title
        print("   %-22s %s" % (label, value))
    service.answer("close_dump", {"document": document})


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    command, rest = argv[0], argv[1:]
    if command == "ping":
        service = Service()
        print("connected to %s — %s" % (service.server, service.path))
        service.close()
        return 0

    service = Service()
    try:
        if command == "tools":
            only_document = "--with-document" in rest
            for tool in service.tools():
                takes = "document" in tool.get("inputSchema", {}).get("properties", {})
                if only_document and not takes:
                    continue
                print("%-24s %s" % (tool["name"], "*" if takes else ""))
        elif command == "call":
            if not rest:
                raise SystemExit("call needs a tool name")
            arguments = json.loads(rest[1]) if len(rest) > 1 else {}
            print(service.answer(rest[0], arguments))
        elif command == "versions":
            if not rest:
                raise SystemExit("versions needs at least one path")
            command_versions(service, rest)
        elif command == "rows":
            if not rest:
                raise SystemExit("rows needs a path")
            command_rows(service, rest[0], rest[1:])
        else:
            raise SystemExit("unknown command %r\n%s" % (command, __doc__))
    finally:
        service.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
