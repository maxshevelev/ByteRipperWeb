#!/usr/bin/env python3
"""The mechanical half of a ByteRipperWeb release.

    python3 Skills/release/scripts/release.py version [--check]
    python3 Skills/release/scripts/release.py build [--out DIR] [--skip-checks]

`version` sets this edition's version: `<upstream>-<n>`, where <upstream> is
the MARKETING_VERSION in the ByteRipper clone's project.yml *at the port
baseline* (PORT_STATE.json), not at the clone's HEAD — upstream may already be
ahead of what was ported — and <n> is the build of this edition made against
it, counting from 1: the first release level with upstream 0.9.0 is 0.9.0-1,
the next 0.9.0-2, and a new upstream release starts again at -1. <n> is read
from the tags already made, so a tag that exists is never asked for twice. It
writes the number into the four files that carry it (package.json and
package-lock.json, here and in desktop/) and prints what it changed. With
--check it writes nothing and fails if any of them disagrees with the others
or names another upstream release.

`build` makes the two things a release ships, and checks both before anything
could be published:
  - ByteRipperWeb-<version>.html — the whole app in one file (`npm run
    build:single`), checked for the version and for anything it would still
    have to fetch;
  - ByteRipper-<version>-setup.exe, -portable.exe and -win.zip — the Windows
    build (desktop/, `npm run dist:win`), checked for the version in their
    names and for upstream's icon inside the executable. The setup and
    SHA256SUMS are what the Windows build's Check for Update… installs from:
    it looks for exactly those two names in the latest release.
They land in release/<version>/ (git-ignored) with a SHA256SUMS file.

Standard library only, like every script under Skills/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DESKTOP = ROOT / "desktop"
PORT_STATE = ROOT / "PORT_STATE.json"
VERSION_RE = re.compile(r'^\s*MARKETING_VERSION:\s*"?([^"\s]+)"?\s*$', re.M)
ICON = "ByteRipperApp/Assets.xcassets/AppIcon.appiconset/icon_256x256.png"


def fail(message: str) -> None:
    sys.exit(f"release: {message}")


def upstream_repo() -> Path:
    repo = Path(os.environ.get("BYTERIPPER_REPO", ROOT.parent / "ByteRipper"))
    if not (repo / ".git").exists():
        fail(f"no ByteRipper clone at {repo} (set $BYTERIPPER_REPO)")
    return repo


def baseline() -> str:
    return json.loads(PORT_STATE.read_text())["baseCommit"]


def upstream_version() -> str:
    """The upstream release at the port baseline."""
    base = baseline()
    shown = subprocess.run(
        ["git", "-C", str(upstream_repo()), "show", f"{base}:project.yml"],
        capture_output=True, text=True,
    )
    if shown.returncode != 0:
        fail(f"cannot read project.yml at {base[:12]}: {shown.stderr.strip()} (fetch the clone?)")
    found = VERSION_RE.search(shown.stdout)
    if found is None:
        fail(f"no MARKETING_VERSION in project.yml at {base[:12]}")
    return found.group(1)


def release_tags(upstream: str) -> list[str]:
    """The tags already made for this upstream release: v<up> and v<up>-<n>."""
    listed = subprocess.run(
        ["git", "tag", "--list", f"v{upstream}", f"v{upstream}-*"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.split()
    return listed


def next_build(upstream: str) -> str:
    """<upstream>-<n>, n one past the highest build already tagged (1 for the first)."""
    built = [
        int(found.group(1))
        for tag in release_tags(upstream)
        if (found := re.fullmatch(rf"v{re.escape(upstream)}-(\d+)", tag))
    ]
    return f"{upstream}-{max(built, default=0) + 1}"


def version_files() -> list[Path]:
    return [ROOT / "package.json", ROOT / "package-lock.json",
            DESKTOP / "package.json", DESKTOP / "package-lock.json"]


def versions_in(path: Path) -> list[str]:
    """The version fields npm keeps: the top one, and the root package's in a lock."""
    data = json.loads(path.read_text())
    found = [data.get("version")]
    if path.name == "package-lock.json":
        found.append(data.get("packages", {}).get("", {}).get("version"))
    return [one for one in found if one is not None]


def write_version(path: Path, version: str) -> bool:
    data = json.loads(path.read_text())
    before = json.dumps(data)
    data["version"] = version
    if path.name == "package-lock.json" and "" in data.get("packages", {}):
        data["packages"][""]["version"] = version
    if json.dumps(data) == before:
        return False
    # npm's own layout: two spaces, and a newline at the end.
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return True


def cmd_version(check: bool) -> str:
    upstream = upstream_version()
    held = {one for path in version_files() for one in versions_in(path)}
    ours = re.fullmatch(rf"{re.escape(upstream)}-(\d+)", next(iter(held))) if len(held) == 1 else None
    if check:
        if ours is None:
            fail(
                f"upstream is {upstream} at the baseline, so the version is {upstream}-<n>; "
                f"the files hold {', '.join(sorted(held))} — run `version`"
            )
        version = next(iter(held))
        print(f"version {version} everywhere (upstream {upstream} at {baseline()[:12]})")
        return version
    # A version already prepared and not yet tagged is kept: running this twice
    # must not skip a build number.
    if ours is not None and f"v{next(iter(held))}" not in release_tags(upstream):
        version = next(iter(held))
    else:
        version = next_build(upstream)
    for path in version_files():
        if write_version(path, version):
            print(f"  {path.relative_to(ROOT)} → {version}")
    print(f"version {version} (upstream MARKETING_VERSION {upstream} at {baseline()[:12]})")
    return version


def run(command: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(command)}  ({cwd.relative_to(ROOT) if cwd != ROOT else '.'})", flush=True)
    # Resolved through PATH and PATHEXT, as a shell would: on Windows `npm` is
    # npm.cmd, which a bare name does not find.
    command = [shutil.which(command[0]) or command[0], *command[1:]]
    if subprocess.run(command, cwd=cwd).returncode != 0:
        fail(f"{' '.join(command)} failed")


def check_html(page: Path, version: str) -> None:
    text = page.read_text(encoding="utf-8")
    # What the landing screen says: the build folds the name and the number
    # into one string.
    if f"ByteRipper {version}" not in text:
        fail(f"{page.name} does not say ByteRipper {version}")
    # Anything the page would still ask for: a page opened from disk cannot.
    if re.search(r'<(?:script|link)[^>]+(?:src|href)="(?!data:)[^"]+"', text):
        fail(f"{page.name} still loads a file of its own")
    if "__VITE_PRELOAD__" in text:
        fail(f"{page.name} carries an unfilled preload placeholder")


def check_windows(exe: Path) -> None:
    icon = upstream_repo() / ICON
    if icon.exists() and icon.read_bytes() not in exe.read_bytes():
        fail(f"{exe.name} does not carry upstream's icon")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def cmd_build(out: Path | None, skip_checks: bool, skip_html: bool) -> None:
    version = cmd_version(check=True)
    target = out or ROOT / "release" / version
    if not skip_checks:
        run(["npm", "run", "check"], ROOT)
        run(["python3", "Skills/help-coverage/scripts/help_coverage.py", "--quiet"], ROOT)
        run(["python3", "Skills/help-names/scripts/help_names.py"], ROOT)

    # The single-file page is left out while what a page opened from disk can
    # not reach — files — is being sorted out (`--skip-html`).
    single = ROOT / "dist-single" / "index.html"
    if not skip_html:
        run(["npm", "run", "build:single"], ROOT)
        check_html(single, version)

    if not (DESKTOP / "node_modules" / "electron" / "path.txt").exists():
        run(["npm", "install"], DESKTOP)
        run(["node", "node_modules/electron/install.js"], DESKTOP)
    shutil.rmtree(DESKTOP / "release", ignore_errors=True)
    run(["npm", "run", "dist:win"], DESKTOP)
    setup = DESKTOP / "release" / f"ByteRipper-{version}-setup.exe"
    portable = DESKTOP / "release" / f"ByteRipper-{version}-portable.exe"
    archive = DESKTOP / "release" / f"ByteRipper-{version}-win.zip"
    for built in (setup, portable, archive):
        if not built.exists():
            fail(f"the Windows build did not make {built.name}")
    check_windows(DESKTOP / "release" / "win-unpacked" / "ByteRipper.exe")

    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    shipped = [
        *([] if skip_html else [shutil.copy2(single, target / f"ByteRipperWeb-{version}.html")]),
        shutil.copy2(setup, target / setup.name),
        shutil.copy2(portable, target / portable.name),
        shutil.copy2(archive, target / archive.name),
    ]
    sums = "".join(f"{sha256(Path(one))}  {Path(one).name}\n" for one in shipped)
    (target / "SHA256SUMS").write_text(sums)
    print(f"\nrelease {version} in {target.relative_to(ROOT) if target.is_relative_to(ROOT) else target}:")
    for one in shipped:
        size = Path(one).stat().st_size
        print(f"  {Path(one).name}  {size / 1_000_000:.1f} MB")
    print("  SHA256SUMS")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    version = sub.add_parser("version", help="set the version to upstream's at the port baseline")
    version.add_argument("--check", action="store_true", help="change nothing; fail if any file disagrees")
    build = sub.add_parser("build", help="build and check the single-file page and the Windows build")
    build.add_argument("--out", type=Path, help="where the artifacts go (default release/<version>/)")
    build.add_argument("--skip-checks", action="store_true", help="skip the test, lint and help checks")
    build.add_argument("--skip-html", action="store_true", help="leave the single-file page out of the release")
    args = parser.parse_args()
    if args.command == "version":
        cmd_version(args.check)
    else:
        cmd_build(args.out, args.skip_checks, args.skip_html)


main()
