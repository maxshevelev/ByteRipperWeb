#!/usr/bin/env python3
"""Report what changed in DumpCompare since the last commit considered here.

Reads PORT_STATE.json for the baseline commit, asks a DumpCompare clone for the
commits after it, and maps every touched path through
reference/module-map.json onto the files of this repository.

Deterministic and read-only: it prints a report and changes nothing unless
--set-base is passed, which rewrites PORT_STATE.json and nothing else.

Standard library only, by the repository's skill rules.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SKILL_DIR.parent.parent
MAP_PATH = SKILL_DIR / "reference" / "module-map.json"
STATE_PATH = REPO_ROOT / "PORT_STATE.json"

REC = "\x01"  # record separator inside git's --format
FLD = "\x02"  # field separator inside one record


def fail(message: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def find_source_repo(explicit: str | None) -> Path:
    """Locate the DumpCompare clone: --repo, $DUMPCOMPARE_REPO, then ../DumpCompare."""
    candidates = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    if os.environ.get("DUMPCOMPARE_REPO"):
        candidates.append(Path(os.environ["DUMPCOMPARE_REPO"]).expanduser())
    candidates.append(REPO_ROOT.parent / "DumpCompare")

    for path in candidates:
        if (path / ".git").exists():
            return path.resolve()

    tried = "\n  ".join(str(c) for c in candidates)
    fail(
        "no DumpCompare clone found. Pass --repo, set DUMPCOMPARE_REPO, or put a "
        f"clone beside this one. Tried:\n  {tried}"
    )


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        fail(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def load_state() -> dict:
    if not STATE_PATH.exists():
        fail(f"{STATE_PATH.name} is missing; the skill needs a baseline commit.")
    return json.loads(STATE_PATH.read_text())


def load_map() -> dict:
    return json.loads(MAP_PATH.read_text())


def classify(path: str, mapping: dict) -> tuple[str, dict | None]:
    """Return ('not-applicable'|'mapped'|'unmapped', entry)."""
    for rule in mapping["notApplicable"]:
        if path.startswith(rule["prefix"]):
            return "not-applicable", rule

    best: dict | None = None
    for module in mapping["modules"]:
        prefix = module["swift"]
        if path == prefix or path.startswith(prefix.rstrip("/") + "/") or path.startswith(prefix):
            if best is None or len(module["swift"]) > len(best["swift"]):
                best = module
    if best is not None:
        return "mapped", best
    return "unmapped", None


def read_commits(repo: Path, base: str, head: str) -> list[dict]:
    """Commits in base..head, newest first, each with its touched paths."""
    fmt = f"{REC}%H{FLD}%h{FLD}%cI{FLD}%an{FLD}%s"
    raw = git(repo, "log", "--no-merges", "--name-only", f"--format={fmt}", f"{base}..{head}")

    commits: list[dict] = []
    current: dict | None = None
    for line in raw.splitlines():
        if line.startswith(REC):
            sha, short, date, author, subject = line[1:].split(FLD, 4)
            current = {
                "sha": sha,
                "short": short,
                "date": date,
                "author": author,
                "subject": subject,
                "paths": [],
            }
            commits.append(current)
        elif line.strip() and current is not None:
            current["paths"].append(line.strip())
    return commits


def build_report(commits: list[dict], mapping: dict) -> dict:
    modules: dict[str, dict] = {}
    skipped: dict[str, dict] = {}
    unmapped: dict[str, set] = {}

    for commit in commits:
        for path in commit["paths"]:
            kind, entry = classify(path, mapping)
            if kind == "not-applicable":
                bucket = skipped.setdefault(
                    entry["prefix"], {"why": entry["why"], "paths": set(), "commits": set()}
                )
                bucket["paths"].add(path)
                bucket["commits"].add(commit["short"])
            elif kind == "mapped":
                bucket = modules.setdefault(
                    entry["swift"],
                    {
                        "web": entry.get("web", []),
                        "status": entry.get("status", "planned"),
                        "note": entry.get("note", ""),
                        "files": entry.get("files", {}),
                        "paths": set(),
                        "commits": set(),
                    },
                )
                bucket["paths"].add(path)
                bucket["commits"].add(commit["short"])
            else:
                unmapped.setdefault(path, set()).add(commit["short"])

    return {"modules": modules, "skipped": skipped, "unmapped": unmapped}


def file_hint(module: dict, path: str) -> str | None:
    """The mapped web file for a specific Swift file, when the map names one."""
    name = path.rsplit("/", 1)[-1]
    return module["files"].get(name)


def print_markdown(state: dict, repo: Path, head: str, commits: list[dict], report: dict) -> None:
    base = state["baseCommit"]
    print("# Port report — DumpCompare → ByteRipperWeb\n")
    print(f"Source: `{repo}`")
    print(f"Baseline: `{base[:12]}` ({state.get('baselineNote', 'no note')})")
    print(f"Head: `{head[:12]}`")
    print(f"Commits to consider: **{len(commits)}**\n")

    if not commits:
        print("Nothing new upstream. The web edition is level with the baseline.")
        return

    print("## Commits\n")
    for commit in commits:
        print(f"- `{commit['short']}` {commit['date'][:10]} — {commit['subject']}")
    print()

    modules = report["modules"]
    if modules:
        print("## Work to consider, by module\n")
        for swift in sorted(modules, key=lambda k: -len(modules[k]["paths"])):
            module = modules[swift]
            targets = ", ".join(f"`{w}`" for w in module["web"]) or "—"
            print(f"### `{swift}` → {targets}")
            print(f"status: {module['status']}  ·  commits: "
                  f"{', '.join(sorted(module['commits']))}")
            if module["note"]:
                print(f"\n{module['note']}")
            print()
            for path in sorted(module["paths"]):
                hint = file_hint(module, path)
                if hint:
                    print(f"- `{path}` → `{hint}`")
                else:
                    print(f"- `{path}`")
            print()

    if report["unmapped"]:
        print("## Unmapped paths\n")
        print("Changed upstream with no entry in `reference/module-map.json`. "
              "Each one is a decision: map it, or declare it not applicable.\n")
        for path in sorted(report["unmapped"]):
            print(f"- `{path}` ({', '.join(sorted(report['unmapped'][path]))})")
        print()

    if report["skipped"]:
        print("## Not applicable\n")
        for prefix in sorted(report["skipped"]):
            bucket = report["skipped"][prefix]
            print(f"- `{prefix}` — {bucket['why']} ({len(bucket['paths'])} file(s))")
        print()

    print("## Next\n")
    print("Read the diffs for the modules above, port what belongs here, then record "
          "the new baseline:\n")
    print("```bash")
    print(f"python3 Skills/port-from-dumpcompare/scripts/port_report.py --set-base {head}")
    print("```")


def to_json(state: dict, repo: Path, head: str, commits: list[dict], report: dict) -> str:
    return json.dumps(
        {
            "source": str(repo),
            "baseCommit": state["baseCommit"],
            "headCommit": head,
            "commits": commits,
            "modules": {
                swift: {
                    "web": m["web"],
                    "status": m["status"],
                    "note": m["note"],
                    "paths": sorted(m["paths"]),
                    "commits": sorted(m["commits"]),
                }
                for swift, m in report["modules"].items()
            },
            "unmapped": {p: sorted(c) for p, c in report["unmapped"].items()},
            "notApplicable": {
                prefix: {"why": b["why"], "paths": sorted(b["paths"])}
                for prefix, b in report["skipped"].items()
            },
        },
        indent=2,
    )


def set_base(sha: str, repo: Path) -> None:
    state = load_state()
    full = git(repo, "rev-parse", sha).strip()
    subject = git(repo, "log", "-1", "--format=%s", full).strip()
    date = git(repo, "log", "-1", "--format=%cI", full).strip()
    state["baseCommit"] = full
    state["baselineNote"] = f"{subject} ({date[:10]})"
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")
    print(f"baseline → {full[:12]} — {state['baselineNote']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", help="path to a DumpCompare clone")
    parser.add_argument("--head", default="HEAD", help="upstream ref to compare against")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--set-base", metavar="SHA",
                        help="record SHA as the new baseline and exit")
    args = parser.parse_args()

    repo = find_source_repo(args.repo)

    if args.set_base:
        set_base(args.set_base, repo)
        return

    state = load_state()
    mapping = load_map()

    base = state["baseCommit"]
    if subprocess.run(["git", "-C", str(repo), "cat-file", "-e", f"{base}^{{commit}}"],
                      capture_output=True).returncode != 0:
        fail(f"baseline {base[:12]} is not in {repo}. Fetch it, or fix PORT_STATE.json.")

    head = git(repo, "rev-parse", args.head).strip()
    commits = read_commits(repo, base, head)
    report = build_report(commits, mapping)

    if args.json:
        print(to_json(state, repo, head, commits, report))
    else:
        print_markdown(state, repo, head, commits, report)


if __name__ == "__main__":
    main()
