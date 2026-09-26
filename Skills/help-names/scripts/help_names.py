#!/usr/bin/env python3
"""Check that every name the help puts in the reader's mouth is one the app says.

A help page that names a menu item, a button or a command is making a promise:
the reader will look for those exact words on screen. Nothing enforces that
promise. The English page is written beside the code and usually keeps up; a
translation is written months later against a string catalogue nobody re-reads,
and it drifts — «Открыть недавние» for a menu the app calls «Недавние
документы», «Файл A» for a label that exists only in the design notes.

This finds that drift mechanically, per language, by looking up each name the
help sets in bold against everything that language's `<language>.strings` can
actually put on screen.

    python3 Skills/help-names/scripts/help_names.py            # every language
    python3 Skills/help-names/scripts/help_names.py ru         # one of them
    python3 Skills/help-names/scripts/help_names.py --controls # the wider net

Read-only. Exit status is 1 when something is reported, so it can gate a commit.

**What it cannot check.** Only names. A page that names every menu item
correctly and then describes what they do incorrectly passes this clean — see
the note at the end of SKILL.md.
"""

import argparse
import pathlib
import re
import sys

HELP = "src/core/help/content"
STRINGS = "src/core/localization/catalogues"
FALLBACK = "en"

# `"key" = "value";` — the whole catalogue format.
ROW = re.compile(r'^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;', re.M)
BOLD = re.compile(r"\*\*(.+?)\*\*", re.S)
# `[[term:fpt|words]]` inside a bold span: that is a link, not a control name.
LINK = re.compile(r"\[\[")
# A trailing keyboard shortcut the help adds and the menu title does not carry.
SHORTCUT = re.compile(r"\s*\(\s*[⌘⇧⌥⌃][^)]*\)\s*$")

TRIM = "….,:;—- \t"


def repo_root(override):
    if override:
        return pathlib.Path(override).resolve()
    return pathlib.Path(__file__).resolve().parents[3]


def spoken(root, language):
    """Everything the app can put on screen in `language`."""
    if language == FALLBACK:
        # The key IS the English. A context-scoped key is spelled
        # "context|English", and the English half is what the app says.
        text = (root / STRINGS / "ru.strings").read_text(encoding="utf-8")
        words = {key.split("|", 1)[-1] for key, _ in ROW.findall(text)}
    else:
        path = root / STRINGS / f"{language}.strings"
        words = {value for _, value in ROW.findall(path.read_text(encoding="utf-8"))}
    # A menu title is quoted with and without its ellipsis and its punctuation.
    return words | {w.strip(TRIM) for w in words}


def normalise(name):
    return SHORTCUT.sub("", name.strip()).strip(TRIM)


def bold_spans(root, language):
    for path in sorted((root / HELP / language).rglob("*.md")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for span in BOLD.findall(line):
                yield path.relative_to(root / HELP), number, span.strip()


def check(root, language, controls):
    said = spoken(root, language)
    problems = []
    for path, number, span in bold_spans(root, language):
        if LINK.search(span):
            continue
        if "▸" in span:
            for part in span.split("▸"):
                name = normalise(part)
                if name and name not in said:
                    problems.append((path, number, name, span))
            continue
        if not controls:
            continue
        name = normalise(span)
        # Prose emphasis is a clause; a control name is a few words. Longer
        # spans are the book stressing a point, not quoting the interface.
        if name and name not in said and len(name.split()) <= 4:
            problems.append((path, number, name, span))
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("languages", nargs="*", help="which to check (default: all)")
    parser.add_argument("--repo", help="repository root (default: found from this file)")
    parser.add_argument("--controls", action="store_true",
                        help="also report short bold names that are not menu paths — "
                             "a wider net with prose emphasis caught in it")
    args = parser.parse_args()

    root = repo_root(args.repo)
    languages = args.languages or sorted(
        p.name for p in (root / HELP).iterdir() if p.is_dir()
    )

    found = 0
    for language in languages:
        problems = check(root, language, args.controls)
        found += len(problems)
        print(f"{language}: {len(problems)} name(s) the app never says")
        for path, number, name, span in problems:
            where = f"  {path}:{number}"
            print(f"{where}  «{name}»" + (f"   in: {span}" if span != name else ""))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
