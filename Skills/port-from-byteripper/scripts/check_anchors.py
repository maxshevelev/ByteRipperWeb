#!/usr/bin/env python3
"""Check this repository's @upstream anchors against a ByteRipper clone.

ByteRipper is the master; this repository ports it. An anchor is the comment
that says which upstream declaration a piece of web code is the port of:

    /** ... @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.activate */

and the check is what keeps those claims true as both sides move. It reports:

- broken anchors — the upstream file or declaration they name is gone;
- stale exemptions — `unported` entries in the module map naming nothing;
- drift — anchored declarations whose lines changed upstream since the
  baseline in PORT_STATE.json, with the web code that has to be re-read;
- gaps — declarations in an anchored upstream file that nothing anchors and no
  exemption explains;
- differences — every `@upstream-differs` and `@web-only` note, so the places
  that deliberately do not follow upstream are reviewed rather than forgotten;
- with --all-mapped, the files the module map says are ported that carry no
  anchors yet.

Deterministic and read-only. Standard library only, by the skill rules. Swift
is read with a small declaration scanner, not a compiler: it tracks braces
outside strings and comments, which is what the declarations of this codebase
need.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from port_report import (  # noqa: E402
    REPO_ROOT,
    fail,
    find_source_repo,
    git,
    load_map,
    load_state,
)

WEB_ROOTS = ("src",)
WEB_SUFFIXES = (".ts", ".tsx")

ANCHOR = re.compile(r"@upstream\s+(?P<path>[^\s#*]+)#(?P<symbol>[A-Za-z_][\w.]*)")
DIFFERS = re.compile(r"@upstream-differs\s+(?P<why>.+?)\s*(?:\*/)?$")
WEB_ONLY = re.compile(r"@web-only\s+(?P<why>.+?)\s*(?:\*/)?$")

TYPE_KINDS = {"class", "struct", "enum", "protocol", "extension", "actor"}
# Declarations that are never a gap on their own: an enum's cases travel with
# the enum, and a deinit has no counterpart in a garbage-collected port.
NOT_COVERED = {"case", "deinit"}
# XCTest's lifecycle hooks: a web test file has its own, and they port nothing.
NOT_COVERED_MEMBERS = (".setUp", ".tearDown", ".setUpWithError", ".tearDownWithError")

MODIFIERS = (
    r"(?:(?:public|private|fileprivate|internal|open|package|static|class|final|override|"
    r"mutating|nonmutating|convenience|required|lazy|weak|unowned|nonisolated|dynamic|"
    r"indirect|optional|isolated)(?:\(\w+\))?\s+)*"
)
DECL = re.compile(
    r"^(?:@[\w.]+(?:\([^)]*\))?\s+)*(?P<mods>" + MODIFIERS + r")"
    r"(?P<kind>func|init|deinit|var|let|class|struct|enum|protocol|extension|actor|"
    r"typealias|subscript|case)\b[\s?!]*`?(?P<name>[A-Za-z_][\w.]*)?"
)
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


# MARK: - The web side


@dataclass
class Anchor:
    path: str
    symbol: str
    file: str
    line: int
    differs: str | None = None


@dataclass
class Note:
    kind: str  # "differs" | "web-only"
    why: str
    file: str
    line: int


def scan_web() -> tuple[list[Anchor], list[Note]]:
    anchors: list[Anchor] = []
    notes: list[Note] = []
    for root in WEB_ROOTS:
        for path in sorted((REPO_ROOT / root).rglob("*")):
            if path.suffix not in WEB_SUFFIXES or not path.is_file():
                continue
            relative = str(path.relative_to(REPO_ROOT))
            for number, line in enumerate(path.read_text().splitlines(), 1):
                for match in ANCHOR.finditer(line):
                    anchors.append(Anchor(match["path"], match["symbol"], relative, number))
                if (differs := DIFFERS.search(line)) is not None:
                    notes.append(Note("differs", differs["why"], relative, number))
                    # A difference belongs to the anchor it follows.
                    same_file = [a for a in anchors if a.file == relative]
                    if same_file:
                        same_file[-1].differs = differs["why"]
                if (web_only := WEB_ONLY.search(line)) is not None:
                    notes.append(Note("web-only", web_only["why"], relative, number))
    return anchors, notes


# MARK: - The upstream side


@dataclass
class Symbol:
    name: str
    kind: str
    start: int
    end: int
    private: bool
    decl: int = 0


def code_only(lines: list[str]) -> list[str]:
    """Each line with strings emptied and comments removed, so braces count."""
    out_lines: list[str] = []
    in_block = False
    in_multi = False
    for raw in lines:
        out: list[str] = []
        i = 0
        n = len(raw)
        while i < n:
            if in_block:
                end = raw.find("*/", i)
                if end < 0:
                    break
                in_block = False
                i = end + 2
                continue
            if in_multi:
                end = raw.find('"""', i)
                if end < 0:
                    break
                in_multi = False
                i = end + 3
                out.append('""')
                continue
            if raw.startswith("//", i):
                break
            if raw.startswith("/*", i):
                in_block = True
                i += 2
                continue
            if raw.startswith('"""', i):
                in_multi = True
                i += 3
                continue
            if raw[i] == '"':
                j = i + 1
                while j < n and raw[j] != '"':
                    j += 2 if raw[j] == "\\" else 1
                out.append('""')
                i = j + 1
                continue
            out.append(raw[i])
            i += 1
        out_lines.append("".join(out))
    return out_lines


def doc_start(raw: list[str], decl_index: int) -> int:
    """The first line of the comment and attribute block above a declaration."""
    i = decl_index
    while i > 0:
        above = raw[i - 1].strip()
        if above.startswith(("//", "/*", "*", "@")) or above.endswith("*/"):
            i -= 1
        else:
            break
    return i + 1


def swift_symbols(text: str) -> list[Symbol]:
    """Every declaration at file or type level, qualified by its enclosing types."""
    raw = text.splitlines()
    code = code_only(raw)
    symbols: list[Symbol] = []
    frames: list[tuple[str, int, int]] = []  # (qualified type, body depth, symbol index)
    pending: tuple[str, int] | None = None
    last_at_depth: dict[int, int] = {}
    depth = 0

    for number, line in enumerate(code, 1):
        body_depth = frames[-1][1] if frames else 0
        if depth == body_depth and pending is None:
            match = DECL.match(line.strip())
            if match is not None:
                kind = match["kind"]
                name = kind if kind in ("init", "deinit", "subscript") else match["name"]
                if name is not None:
                    prefix = frames[-1][0] + "." if frames else ""
                    qualified = name if kind == "extension" else prefix + name
                    start = doc_start(raw, number - 1)
                    previous = last_at_depth.get(depth)
                    if previous is not None:
                        symbols[previous].end = max(symbols[previous].decl, start - 1)
                    # A member of a private type is as private as the type.
                    # `private(set)` narrows the setter only; the property is public.
                    own = re.search(r"\b(?:file)?private\b(?!\()", match["mods"] or "")
                    private = own is not None or (
                        bool(frames) and symbols[frames[-1][2]].private
                    )
                    symbols.append(Symbol(qualified, kind, start, number, private, number))
                    last_at_depth[depth] = len(symbols) - 1
                    if kind in TYPE_KINDS:
                        pending = (qualified, len(symbols) - 1)
        for ch in line:
            if ch == "{":
                depth += 1
                if pending is not None:
                    frames.append((pending[0], depth, pending[1]))
                    last_at_depth.pop(depth, None)
                    pending = None
            elif ch == "}":
                if frames and depth == frames[-1][1]:
                    _, body, index = frames.pop()
                    member = last_at_depth.pop(body, None)
                    if member is not None:
                        symbols[member].end = max(symbols[member].decl, number - 1)
                    symbols[index].end = number
                depth -= 1

    last = last_at_depth.get(0)
    if last is not None and symbols[last].kind not in TYPE_KINDS:
        symbols[last].end = len(raw)
    return symbols


C_FUNCTION = re.compile(r"^[A-Za-z_][\w\s\*]*?\b(?P<name>[A-Za-z_]\w*)\s*\([^;]*$")
# EDK2 writes a definition down the page — `STATIC`, `VOID`, then the name on a
# line of its own — so the name is the whole of its line and the pattern above,
# which wants a return type in front of it, cannot see it. Every function of the
# Tiano decompressor is written that way.
C_FUNCTION_ALONE = re.compile(r"^(?P<name>[A-Za-z_]\w*)\s*\([^;]*$")
C_NOT_NAMES = {"if", "for", "while", "switch", "return", "sizeof"}
# `typedef void (Z7_FASTCALL *LZFIND_SATUR_SUB_CODE_FUNC)(` is a function
# pointer's type, not a function: read as a definition it declares something
# called `void`. A typedef never defines one, so the line is skipped whole.
C_TYPEDEF = re.compile(r"^typedef\b")


def c_symbols(text: str) -> list[Symbol]:
    """The function definitions of a C file — the vendored SDK code a port takes.

    Macros are not declarations here: a port inlines them, and a gap for every
    `NORMALIZE` would say nothing.
    """
    raw = text.splitlines()
    code = code_only(raw)
    symbols: list[Symbol] = []
    depth = 0
    for number, line in enumerate(code, 1):
        if depth == 0 and not line.startswith(("#", " ", "\t")) and not C_TYPEDEF.match(line):
            match = C_FUNCTION.match(line)
            if match is None:
                alone = C_FUNCTION_ALONE.match(line)
                # A name in capitals alone on a line is a macro being invoked,
                # not a function being defined — the SDK's
                # Z7_BRANCH_CONV_ST_FUNC_IMP and its kind. EDK2's own names are
                # CamelCase, so the case tells the two apart.
                if alone is not None and not alone["name"].isupper():
                    match = alone
            if match is not None and match["name"] not in C_NOT_NAMES:
                if symbols and symbols[-1].end == symbols[-1].decl:
                    symbols[-1].end = max(symbols[-1].decl, number - 1)
                symbols.append(Symbol(match["name"], "func", doc_start(raw, number - 1),
                                      number, False, number))
        for ch in line:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and symbols and symbols[-1].end == symbols[-1].decl:
                    symbols[-1].end = number
    return symbols


def symbols_in(path: str, text: str) -> list[Symbol]:
    return c_symbols(text) if path.endswith((".c", ".h")) else swift_symbols(text)


def show(repo: Path, ref: str, path: str) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(repo), "show", f"{ref}:{path}"], capture_output=True, text=True
    )
    return result.stdout if result.returncode == 0 else None


def changed_ranges(repo: Path, base: str, head: str, path: str) -> list[tuple[int, int]]:
    """The head-side line ranges a diff from the baseline touched."""
    ranges = []
    for line in git(repo, "diff", "-U0", base, head, "--", path).splitlines():
        match = HUNK.match(line)
        if match is not None:
            start = int(match[1])
            count = int(match[2]) if match[2] is not None else 1
            ranges.append((start, start + max(count, 1) - 1))
    return ranges


# MARK: - The map


def exemptions(mapping: dict) -> dict[str, str]:
    """`unported` entries from every module: "path#pattern" → why."""
    found: dict[str, str] = {}
    for module in mapping["modules"]:
        found.update(module.get("unported", {}))
    return found


def mapped_files(mapping: dict, repo: Path, head: str) -> dict[str, str]:
    """Upstream file → module, for every `files` key the map resolves.

    A key is either a path under the module's own prefix (`ToolController.swift`,
    `Decompress/LZMAModule.swift`) or a whole upstream path, which is how a
    module names the tests that live in `ByteRipperTests/`.
    """
    tree = git(repo, "ls-tree", "-r", "--name-only", head).splitlines()
    swift = [p for p in tree if p.endswith((".swift", ".c", ".h"))]
    resolved: dict[str, str] = {}
    for module in mapping["modules"]:
        prefix = module["swift"].rstrip("/")
        for key in module.get("files", {}):
            for path in swift:
                under = path.startswith(prefix + "/") and path.endswith("/" + key)
                if path == key or under:
                    resolved[path] = module["swift"]
    return resolved


# MARK: - The check


@dataclass
class Report:
    head: str
    base: str
    anchors: list[Anchor]
    notes: list[Note]
    broken: list[dict] = field(default_factory=list)
    stale: list[dict] = field(default_factory=list)
    drift: list[dict] = field(default_factory=list)
    gaps: dict[str, list[str]] = field(default_factory=dict)
    unclaimed: list[str] = field(default_factory=list)
    backlog: list[dict] = field(default_factory=list)


def check(repo: Path, head: str, all_mapped: bool) -> Report:
    state = load_state()
    mapping = load_map()
    base = state["baseCommit"]
    anchors, notes = scan_web()
    report = Report(head, base, anchors, notes)
    exempt = exemptions(mapping)
    # The files the map claims are ported whole. Only these are checked for
    # gaps: a file the port takes three methods from — a six-thousand-line view
    # controller — would otherwise be nothing but gaps.
    claimed = mapped_files(mapping, repo, head)

    cache: dict[str, list[Symbol] | None] = {}

    def symbols_of(path: str) -> list[Symbol] | None:
        if path not in cache:
            text = show(repo, head, path)
            cache[path] = None if text is None else symbols_in(path, text)
        return cache[path]

    by_path: dict[str, list[Anchor]] = {}
    for anchor in anchors:
        by_path.setdefault(anchor.path, []).append(anchor)

    for path, group in sorted(by_path.items()):
        symbols = symbols_of(path)
        for anchor in group:
            where = f"{anchor.file}:{anchor.line}"
            if symbols is None:
                report.broken.append({"anchor": f"{path}#{anchor.symbol}", "at": where,
                                      "why": "no such upstream file"})
            elif not any(s.name == anchor.symbol for s in symbols):
                report.broken.append({"anchor": f"{path}#{anchor.symbol}", "at": where,
                                      "why": "no such declaration"})
        if symbols is None:
            continue

        # Drift: an anchored declaration whose lines changed since the baseline.
        ranges = changed_ranges(repo, base, head, path)
        if ranges:
            for symbol in symbols:
                # A type is its declaration and the comment above it; its
                # members are anchored, and drift, on their own.
                end = symbol.decl if symbol.kind in TYPE_KINDS else symbol.end
                touched = any(a <= end and symbol.start <= b for a, b in ranges)
                owners = [a for a in group if a.symbol == symbol.name]
                if touched and owners:
                    report.drift.append({
                        "symbol": f"{path}#{symbol.name}",
                        "web": [f"{a.file}:{a.line}" for a in owners],
                    })

        # Gaps: what nothing anchors and nothing exempts, in a file the map
        # claims. A type counts as anchored when any member of it is.
        if path not in claimed:
            report.unclaimed.append(path)
            continue
        anchored = {a.symbol for a in group}
        missing = [
            s.name for s in symbols
            if not s.private and s.kind not in NOT_COVERED
            and not s.name.endswith(NOT_COVERED_MEMBERS)
            and s.name not in anchored
            and not (s.kind in TYPE_KINDS and any(n.startswith(s.name + ".") for n in anchored))
            and not any(fnmatch.fnmatchcase(f"{path}#{s.name}", key) for key in exempt)
        ]
        if missing:
            report.gaps[path] = sorted(set(missing))

    for key in sorted(exempt):
        path, _, pattern = key.partition("#")
        symbols = symbols_of(path)
        # `#*` over an existing file stands even when the file declares nothing.
        whole_file = pattern == "*" and symbols is not None
        if not whole_file and (
            symbols is None or not any(fnmatch.fnmatchcase(s.name, pattern) for s in symbols)
        ):
            report.stale.append({"exemption": key, "why": exempt[key]})

    if all_mapped:
        for path, module in sorted(claimed.items()):
            if path not in by_path:
                report.backlog.append({"path": path, "module": module})
    return report


def print_markdown(repo: Path, report: Report) -> None:
    print("# Anchor check — ByteRipper → ByteRipperWeb\n")
    print(f"Source: `{repo}`  ·  head `{report.head[:12]}`  ·  baseline `{report.base[:12]}`")
    files = len({a.path for a in report.anchors})
    print(f"Anchors: **{len(report.anchors)}** over {files} upstream file(s)\n")

    def section(title: str, intro: str, rows: list[str]) -> None:
        if not rows:
            return
        print(f"## {title}\n")
        print(intro + "\n")
        for row in rows:
            print(row)
        print()

    section("Broken anchors",
            "Web code claiming to port something upstream no longer has. Re-read "
            "upstream and move the anchor, or port what replaced it.",
            [f"- `{b['anchor']}` at `{b['at']}` — {b['why']}" for b in report.broken])
    section("Stale exemptions",
            "`unported` entries in the module map that match nothing upstream.",
            [f"- `{s['exemption']}` — {s['why']}" for s in report.stale])
    section("Changed upstream since the baseline",
            "Anchored declarations whose lines moved. Diff each against the baseline "
            "and bring the web code level.",
            [f"- `{d['symbol']}` → " + ", ".join(f"`{w}`" for w in d["web"])
             for d in report.drift])
    gap_rows: list[str] = []
    for path, names in report.gaps.items():
        gap_rows.append(f"- `{path}`: " + ", ".join(f"`{n}`" for n in names))
    section("Gaps",
            "Declarations of an anchored file that nothing ports. Port them with an "
            "anchor, or add an `unported` entry with the reason to the module map.",
            gap_rows)
    section("Anchored, not claimed",
            "Files the web code takes parts of, which no module's `files` lists. "
            "Not checked for gaps; list a file there once it is ported whole.",
            [f"- `{path}`" for path in report.unclaimed])
    section("Deliberate differences",
            "Every `@upstream-differs` and `@web-only` note. Each is a decision; "
            "check it still holds.",
            [f"- {n.kind} `{n.file}:{n.line}` — {n.why}" for n in report.notes])
    section("Mapped but not anchored",
            "Files the module map lists as ported that carry no anchors yet.",
            [f"- `{b['path']}` ({b['module']})" for b in report.backlog])
    if not (report.broken or report.stale or report.drift or report.gaps):
        print("Every anchor resolves, and nothing anchored has moved upstream.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", help="path to a ByteRipper clone")
    parser.add_argument("--head", default="HEAD", help="upstream ref to check against")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--all-mapped", action="store_true",
                        help="also list mapped upstream files that carry no anchors")
    parser.add_argument("--strict", action="store_true",
                        help="fail on gaps and drift too, not only on broken anchors")
    args = parser.parse_args()

    repo = find_source_repo(args.repo)
    head = git(repo, "rev-parse", args.head).strip()
    report = check(repo, head, args.all_mapped)

    if args.json:
        print(json.dumps({
            "source": str(repo),
            "headCommit": report.head,
            "baseCommit": report.base,
            "anchors": [a.__dict__ for a in report.anchors],
            "broken": report.broken,
            "staleExemptions": report.stale,
            "drift": report.drift,
            "gaps": report.gaps,
            "unclaimed": report.unclaimed,
            "notes": [n.__dict__ for n in report.notes],
            "backlog": report.backlog,
        }, indent=2))
    else:
        print_markdown(repo, report)

    failed = bool(report.broken or report.stale)
    if args.strict:
        failed = failed or bool(report.gaps or report.drift)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
