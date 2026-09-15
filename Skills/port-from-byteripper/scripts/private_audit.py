#!/usr/bin/env python3
"""List upstream private declarations that the port may have missed.

`check_anchors.py` does not ask for a `private` upstream helper to be anchored:
a port folds most of them into the code it does anchor, and listing every one
as a gap would bury the real gaps. The price is that behaviour living only in a
private function can go missing without the check saying so — the find field's
hex formatting (`FindBarView.normalizeHexText`) did.

This is the audit for that blind spot. For every upstream file the module map
claims, it lists the private declarations that nothing anchors and nothing
exempts, and — unless `--all` — keeps only those whose name appears nowhere in
`src/` and that do not look like AppKit plumbing. What is left is a reading
list, not a verdict: each row is checked by hand against the web code, and a
real gap goes into `Design/GAPS.md`.

    python3 Skills/port-from-byteripper/scripts/private_audit.py                 # the reading list
    python3 Skills/port-from-byteripper/scripts/private_audit.py --path Hex/     # one area
    python3 Skills/port-from-byteripper/scripts/private_audit.py --all --json    # everything, for a script

Stdlib only.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_anchors as ca  # noqa: E402

# Names that are the view's plumbing on the Mac and have no counterpart to miss
# in a browser. A hint, shown with `--all`; never a verdict.
PLUMBING = re.compile(
    r"^(make|setUp|setup|layout|draw|viewDid|viewWill|mouse|key(Down|Up)|scroll|"
    r"accessibility|tableView|outlineView|numberOf|validate|install|configure|"
    r"refresh.*(Color|Theme|Appearance)|update.*Appearance|awake|observe|notification|"
    r"constraint|intrinsic|hitTest|cursor|tracking|resetCursor|becomeFirst|resign|"
    r"acceptsFirst|menuNeeds|responder|window)",
    re.IGNORECASE,
)


def layer(path: str) -> str:
    if "Tests" in path:
        return "test"
    if path.startswith("ByteRipperApp/"):
        return "app-ui"
    if "UI/" in path:
        return "module-ui"
    if path.startswith("Modules/"):
        return "module-logic"
    return "package"


def web_text() -> str:
    """Every non-test source file of the port, lower-cased, as one text to search."""
    parts = []
    for root in ca.WEB_ROOTS:
        for path in sorted(Path(root).rglob("*")):
            if path.suffix in ca.WEB_SUFFIXES and ".test." not in path.name:
                parts.append(path.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(parts).lower()


def audit(repo: Path, head: str, include_tests: bool) -> list[dict]:
    mapping = ca.load_map()
    exempt = ca.exemptions(mapping)
    claimed = ca.mapped_files(mapping, repo, head)
    anchors, _ = ca.scan_web()
    anchored_by_path: dict[str, set[str]] = {}
    for anchor in anchors:
        anchored_by_path.setdefault(anchor.path, set()).add(anchor.symbol)
    web = web_text()

    rows = []
    for path in sorted(claimed):
        kind_of_file = layer(path)
        if kind_of_file == "test" and not include_tests:
            continue
        text = ca.show(repo, head, path)
        if text is None:
            continue
        raw = text.splitlines()
        anchored = anchored_by_path.get(path, set())
        for symbol in ca.symbols_in(path, text):
            if not symbol.private or symbol.kind in ca.NOT_COVERED:
                continue
            if symbol.name.endswith(ca.NOT_COVERED_MEMBERS) or symbol.name in anchored:
                continue
            if symbol.kind in ca.TYPE_KINDS and any(
                name.startswith(symbol.name + ".") for name in anchored
            ):
                continue
            if any(fnmatch.fnmatchcase(f"{path}#{symbol.name}", key) for key in exempt):
                continue
            base = symbol.name.rsplit(".", 1)[-1]
            doc = " ".join(
                line.strip().lstrip("/").strip()
                for line in raw[symbol.start - 1 : symbol.decl - 1]
                if line.strip().startswith("///")
            )
            rows.append({
                "path": path,
                "symbol": symbol.name,
                "kind": symbol.kind,
                "line": symbol.decl,
                "layer": kind_of_file,
                "nameInWeb": len(base) < 4 or base.lower() in web,
                "plumbing": bool(PLUMBING.match(base)),
                "doc": doc,
            })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", help="path to a ByteRipper clone")
    parser.add_argument("--head", default="HEAD", help="upstream ref to audit")
    parser.add_argument("--all", action="store_true",
                        help="keep names found in src/ and plumbing too")
    parser.add_argument("--tests", action="store_true", help="include upstream test files")
    parser.add_argument("--path", help="only upstream paths containing this text")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()

    repo = ca.find_source_repo(args.repo)
    head = ca.git(repo, "rev-parse", args.head).strip()
    rows = audit(repo, head, args.tests)
    if args.path:
        rows = [row for row in rows if args.path in row["path"]]
    if not args.all:
        rows = [row for row in rows if not row["nameInWeb"] and not row["plumbing"]]

    if args.json:
        print(json.dumps({"headCommit": head, "rows": rows}, indent=2, ensure_ascii=False))
        return

    by_layer: dict[str, int] = {}
    for row in rows:
        by_layer[row["layer"]] = by_layer.get(row["layer"], 0) + 1
    print("# Private upstream declarations to read against the port\n")
    print(f"Source: `{repo}`  ·  head `{head[:12]}`")
    print(f"Rows: **{len(rows)}**  ·  " + ", ".join(f"{k} {v}" for k, v in sorted(by_layer.items())))
    current = None
    for row in rows:
        if row["path"] != current:
            current = row["path"]
            print(f"\n## {current}\n")
        member = row["symbol"].split(".", 1)[-1]
        marks = "".join([" · in src" if row["nameInWeb"] else "", " · plumbing" if row["plumbing"] else ""])
        doc = row["doc"][:140] + ("…" if len(row["doc"]) > 140 else "")
        print(f"- `{member}` ({row['kind']}, line {row['line']}{marks}){' — ' + doc if doc else ''}")


if __name__ == "__main__":
    main()
