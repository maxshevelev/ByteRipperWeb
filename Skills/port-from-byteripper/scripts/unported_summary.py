#!/usr/bin/env python3
"""Summarise the module map's `unported` entries by reason.

`Design/GAPS.md` is the human view of what is left to port and what the web
edition will not support; the module map is the symbol-level truth behind it.
This prints the map's `later —` and `n/a —` reasons grouped, with how many
upstream declarations each covers and which upstream files they come from, so
the tables can be checked against the map rather than remembered.

    python3 Skills/port-from-byteripper/scripts/unported_summary.py           # both kinds
    python3 Skills/port-from-byteripper/scripts/unported_summary.py --later   # only work left
    python3 Skills/port-from-byteripper/scripts/unported_summary.py --na      # only what the browser takes away
    python3 Skills/port-from-byteripper/scripts/unported_summary.py --no-tests

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

MAP = Path(__file__).resolve().parent.parent / "reference" / "module-map.json"


def unported(node, found):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "unported" and isinstance(value, dict):
                found.update(value)
            else:
                unported(value, found)
    elif isinstance(node, list):
        for item in node:
            unported(item, found)
    return found


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    kind = parser.add_mutually_exclusive_group()
    kind.add_argument("--later", action="store_true", help="only `later —` entries")
    kind.add_argument("--na", action="store_true", help="only `n/a —` entries")
    parser.add_argument("--no-tests", action="store_true", help="leave out upstream tests")
    args = parser.parse_args()

    entries = unported(json.loads(MAP.read_text(encoding="utf-8")), {})
    groups: dict[str, dict[str, list[str]]] = {"later": defaultdict(list), "n/a": defaultdict(list)}
    for symbol, reason in entries.items():
        if args.no_tests and symbol.startswith("ByteRipperTests/"):
            continue
        groups["later" if reason.startswith("later") else "n/a"][reason].append(symbol)

    kinds = ["later"] if args.later else ["n/a"] if args.na else ["later", "n/a"]
    for name in kinds:
        reasons = groups[name]
        total = sum(len(symbols) for symbols in reasons.values())
        print(f"## {name} — {total} declarations, {len(reasons)} reasons\n")
        for reason, symbols in sorted(reasons.items(), key=lambda item: (-len(item[1]), item[0])):
            files = sorted({symbol.split("#")[0].rsplit("/", 1)[-1] for symbol in symbols})
            shown = ", ".join(files[:8]) + (" …" if len(files) > 8 else "")
            print(f"- {len(symbols):4d}  {reason}\n        {shown}")
        print()


if __name__ == "__main__":
    main()
