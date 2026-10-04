#!/usr/bin/env python3
"""
help_editions.py — check the two-edition forms of the help book.

The book is one set of Markdown files, read in a browser and in the desktop
shell, and the two are not the same application. A page therefore carries two
inline forms that the rest of the help does not:

  [[key:find]]        a chord, resolved at read time to the reader's keyboard
  [[edition:…||…]]    a phrase that reads one way in the browser and another in
                      the shell: the first half is the browser, the second the
                      shell; with no "||" the phrase is the same for both.

This script is the mechanical check for that machinery, and it is the review
surface for the port cycle. When an upstream change touches a page, the manifest
is the list of the passages that read differently in the two editions — the
ones to re-check that the shell's half still says what the shell does.

Read-only, deterministic, stdlib only. Exit status is 1 when a problem is
reported; the manifest is informational and does not change the status.

The edition and chord logic mirrors `src/core/help/helpMarkup.ts`
(`applyEdition`, `editionClose`, `topLevelEditionBar`) and
`src/core/help/helpKeys.ts` (`HELP_KEY_SPELLINGS`) — the check and the parser
must say the same thing, so the check re-derives the closed chord set from
`helpKeys.ts` rather than carrying a copy.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# The repository root is two levels up from this script.
ROOT = Path(__file__).resolve().parent.parent.parent.parent
CONTENT = ROOT / "src" / "core" / "help" / "content"
KEYS_TS = ROOT / "src" / "core" / "help" / "helpKeys.ts"

EDITION = "[[edition:"
EDITION_LEN = len(EDITION)


def known_commands():
    """The closed set a page may name, read off the `HelpCommand` union.

    Parsed, not copied, so a chord added to the table is a chord a page may
    name on the same change, with nothing to keep in step by hand.
    """
    text = KEYS_TS.read_text(encoding="utf-8")
    match = re.search(r"export type HelpCommand =\s*(.*?);", text, re.DOTALL)
    if match is None:
        sys.exit("cannot find `export type HelpCommand` in %s" % KEYS_TS)
    return set(re.findall(r'"([A-Za-z0-9]+)"', match.group(1)))


def edition_close(text, start):
    """The index of the `]]` that closes the phrase begun just before `start`,
    balancing the inner `[[ … ]]` a half carries, or -1 when there is none.
    Mirrors `editionClose`."""
    depth = 1
    at = start
    while at < len(text):
        if text.startswith("[[", at):
            depth += 1
            at += 2
        elif text.startswith("]]", at):
            depth -= 1
            at += 2
            if depth == 0:
                return at - 2
        else:
            at += 1
    return -1


def top_level_bar(body):
    """The `||` that splits a phrase's halves, or -1: the first double pipe that
    is not inside a `[[ … ]]` a half carries. Mirrors `topLevelEditionBar`."""
    depth = 0
    at = 0
    while at < len(body):
        if body.startswith("[[", at):
            depth += 1
            at += 2
        elif body.startswith("]]", at):
            depth -= 1
            at += 2
        else:
            if depth == 0 and at + 1 < len(body) and body[at] == "|" and body[at + 1] == "|":
                return at
            at += 1
    return -1


def apply_edition(text, edition):
    """Every `[[edition:…]]` in `text` replaced by the half `edition` keeps.
    Mirrors `applyEdition`."""
    out = []
    at = 0
    while True:
        start = text.find(EDITION, at)
        if start == -1:
            out.append(text[at:])
            break
        out.append(text[at:start])
        close = edition_close(text, start + EDITION_LEN)
        if close == -1:
            out.append(text[start:])
            break
        body = text[start + EDITION_LEN : close]
        bar = top_level_bar(body)
        if bar == -1:
            chosen = body
        else:
            chosen = body[bar + 2 :] if edition == "desktop" else body[:bar]
        out.append(chosen.strip())
        at = close + 2
    return "".join(out)


def phrase_report(text):
    """Walk one file's text and judge each `[[edition:…]]` phrase.

    Returns (problems, phrases). `problems` is a list of (line, message);
    `phrases` is a list of dicts for the manifest, each carrying the two halves
    so a reviewer can read both against the code.
    """
    problems = []
    phrases = []
    at = 0
    while True:
        start = text.find(EDITION, at)
        if start == -1:
            break
        line = text.count("\n", 0, start) + 1
        close = edition_close(text, start + EDITION_LEN)
        if close == -1:
            problems.append((line, "unbalanced [[edition:…]] — no closing ]]"))
            break
        body = text[start + EDITION_LEN : close]
        bar = top_level_bar(body)
        if bar == -1:
            browser = desktop = body.strip()
            kind = "same-both"
        else:
            browser = body[:bar].strip()
            desktop = body[bar + 2 :].strip()
            kind = "split"
        # A nested edition phrase is not supported: the close is found by
        # balancing, so a second [[edition:…]] inside a half would be kept whole
        # and read on both editions. That is a mistake, not a device.
        if EDITION in browser or EDITION in desktop:
            problems.append((line, "a [[edition:…]] half holds a second [[edition:…]]"))
        if browser == "" and desktop == "":
            kind = "empty"
            problems.append((line, "an [[edition:…]] phrase has two empty halves"))
        elif kind == "split" and (browser == "" or desktop == ""):
            # Legal — a line that exists in one edition only — but it is the
            # passage most likely to drift, so the manifest says which edition
            # loses it rather than letting it vanish silently.
            kind = "one-edition"
        phrases.append(
            {
                "line": line,
                "kind": kind,
                "browser": browser,
                "desktop": desktop,
            }
        )
        at = close + 2
    return problems, phrases


def chord_report(text, known):
    """Judge every `[[key:…]]` in one file's text.

    Returns (problems, chords). The id must be one the table names; a spelled
    chord (`Ctrl+S`, `⌘F`) in the slot where the id belongs is a double
    conversion and is called out by name.
    """
    problems = []
    chords = []
    for match in re.finditer(r"\[\[key:([^\]]+)\]\]", text):
        command = match.group(1).strip()
        line = text.count("\n", 0, match.start()) + 1
        chords.append({"line": line, "command": command})
        if command in known:
            continue
        if re.search(r"[+⌘⌥⌃⇧]|Ctrl|Alt|Shift|Mac|Command", command, re.IGNORECASE):
            problems.append((line, "[[key:%s]] is a spelled chord, not an id — write the id" % command))
        else:
            problems.append((line, "[[key:%s]] is not a chord the book may name" % command))
    return problems, chords


def balanced_markers(text):
    """`[[` and `]]` are link markers; a file that has one more of the first
    than the second left a link open. Checked on the raw text, where every
    phrase and both halves of it are present."""
    if text.count("[[") != text.count("]]"):
        return "unbalanced link markers: %d [[ vs %d ]]" % (text.count("[["), text.count("]]"))
    return None


def leftover_edition(text, edition):
    """After the edition is applied, no `[[edition:…]]` may remain — a leftover
    is a phrase the split could not resolve (an unbalanced one, or a nested
    one). Checked per edition."""
    applied = apply_edition(text, edition)
    if EDITION in applied:
        line = applied.count("\n", 0, applied.find(EDITION)) + 1
        return (line, "a [[edition:…]] survived the %s split — it is unbalanced or nested" % edition)
    return None


def collect_files(language):
    base = CONTENT / language
    if not base.is_dir():
        return []
    return sorted(p for p in base.rglob("*.md") if p.is_file())


def check(language, known, want_manifest):
    problems = []
    manifest = {}
    for path in collect_files(language):
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(CONTENT).as_posix()
        file_problems = []

        marker = balanced_markers(text)
        if marker is not None:
            file_problems.append((0, marker))
        for edition in ("browser", "desktop"):
            leftover = leftover_edition(text, edition)
            if leftover is not None:
                file_problems.append(leftover)

        edition_problems, edition_phrases = phrase_report(text)
        chord_problems, chords = chord_report(text, known)

        file_problems.extend(edition_problems)
        file_problems.extend(chord_problems)
        if file_problems:
            problems.append((rel, sorted(file_problems)))
        if want_manifest and (edition_phrases or chords):
            manifest[rel] = {"phrases": edition_phrases, "chords": chords}
    return problems, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 2)[1])
    parser.add_argument(
        "languages",
        nargs="*",
        help="one or more languages to check (default: every language present)",
    )
    parser.add_argument("--json", action="store_true", help="machine-readable report")
    parser.add_argument("--no-manifest", action="store_true", help="skip the manifest")
    parser.add_argument("--manifest-only", action="store_true", help="print only the manifest")
    parser.add_argument(
        "--chords", action="store_true", help="list every [[key:…]] too, not just the edition phrases"
    )
    args = parser.parse_args()

    if not CONTENT.is_dir():
        sys.exit("no content directory at %s" % CONTENT)
    languages = args.languages or sorted(p.name for p in CONTENT.iterdir() if p.is_dir())

    known = known_commands()
    all_problems = {}
    all_manifests = {}
    total_phrases = 0
    total_chords = 0
    for language in languages:
        problems, manifest = check(language, known, not args.no_manifest)
        all_problems[language] = problems
        all_manifests[language] = manifest
        for entry in manifest.values():
            total_phrases += len(entry["phrases"])
            total_chords += len(entry["chords"])

    total = sum(len(items) for items in all_problems.values() for items in items)

    if args.json:
        report = {
            "commands": sorted(known),
            "phrases": total_phrases,
            "chords": total_chords,
            "problems": {lang: items for lang, items in all_problems.items()},
            "manifest": None if args.no_manifest else all_manifests,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(
            "Editions check — %d language(s), %d edition phrase(s), %d chord(s)"
            % (len(languages), total_phrases, total_chords)
        )
        if not args.manifest_only:
            if total:
                print("\n%d problem(s):" % total)
                for language in languages:
                    if all_problems[language]:
                        print("  %s" % language)
                        for rel, items in all_problems[language]:
                            for line, message in items:
                                where = "%s:%d" % (rel, line) if line else rel
                                print("    %s  %s" % (where, message))
            else:
                print("\nno problems")
        if not args.no_manifest:
            # The review surface: the passages that read differently by edition.
            # A chord is not one of these — it resolves per keyboard, not per
            # edition — so it is listed only on request.
            print(
                "\nmanifest — %d passage(s) that read differently by edition:"
                % total_phrases
            )
            for language in languages:
                phrases_in_lang = [e["phrases"] for e in all_manifests.get(language, {}).values()]
                if not any(phrases_in_lang):
                    continue
                print("  %s" % language)
                for rel in sorted(all_manifests.get(language, {})):
                    entry = all_manifests[language][rel]
                    if not entry["phrases"] and not args.chords:
                        continue
                    rows = []
                    for phrase in entry["phrases"]:
                        note = {
                            "same-both": "same on both",
                            "split": "differs",
                            "one-edition": "only in %s"
                            % ("the browser" if phrase["desktop"] == "" else "the shell"),
                            "empty": "empty",
                        }[phrase["kind"]]
                        rows.append((phrase["line"], note, phrase["browser"], phrase["desktop"]))
                    if args.chords:
                        rows.extend(
                            (chord["line"], "key %s" % chord["command"], None, None)
                            for chord in entry["chords"]
                        )
                    rows.sort(key=lambda row: row[0])
                    print("    %s" % rel)
                    for line, note, browser, desktop in rows:
                        if browser is None:
                            print("      %4d  %s" % (line, note))
                            continue
                        print("      %4d  %s" % (line, note))
                        for label, half in (("browser", browser), ("shell", desktop)):
                            text = " ".join(half.split())
                            if len(text) > 74:
                                text = text[:71] + "…"
                            if text:
                                print("          %-7s %s" % (label + ":", text))

    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
