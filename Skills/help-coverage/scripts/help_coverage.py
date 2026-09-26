#!/usr/bin/env python3
"""Check the app, its help book and its translations against each other.

Three gaps rot between them, and none of the three announces itself:

  1. functionality with no help — an anchor declared in the code
     (`// help: menu.file.append`) that no page or term `@covers`;
  2. a translation that has fallen behind the English it was made from — the
     `@source-sha` it carries no longer matches the English file's hash;
  3. a UI string the code asks for (`L("…")`) that a language's
     Localizable.strings has not got.

Run it from anywhere; the repository root is resolved relative to this file
(the skill lives at <repo>/Skills/help-coverage/scripts/), or pass --repo.

Ported from ByteRipper's skill of the same name. What changed is where things
live and what a source file is: `src/core/help/content/<language>/` for the
book, one `<language>.strings` per catalogue rather than an `.lproj` folder,
and TypeScript rather than Swift.

This is the body of the `help-coverage` skill. It is deliberately
deterministic and read-only: the same tree always gives the same report, and
nothing is written unless --bless is passed.
"""

import argparse
import hashlib
import pathlib
import re
import sys

# --- where things live -------------------------------------------------------

HELP = "src/core/help/content"
STRINGS = "src/core/localization/catalogues"
FALLBACK = "en"

# The TypeScript the anchors and the `L("…")` keys are read from. Tests are left
# out: a test that asserts on an English sentence is not a sentence anybody has
# to translate.
SOURCE_ROOTS = ["src"]
SKIP_PARTS = {"node_modules", "dist", "content", "catalogues"}
SOURCE_SUFFIXES = (".ts", ".tsx")

# `// help: some.anchor`, anywhere on a line — and `{/* help: … */}`, which is
# what the same marker has to be written as inside JSX. A `//` line between two
# elements is not a comment there, it is text, and it was rendered on the empty
# screen (measured), so both shapes are read and both are correct in their
# place.
ANCHOR_IN_CODE = re.compile(r"(?://|/\*)\s*help:\s*([a-z0-9][a-z0-9.\-]*)")
# `@covers some.anchor` on its own line in a help file.
ANCHOR_IN_HELP = re.compile(r"^@covers\s+([a-z0-9][a-z0-9.\-]*)\s*$", re.M)
# `@source-sha <hex>` in a translated file.
SOURCE_SHA = re.compile(r"^@source-sha\s+([0-9a-f]{64})\s*$", re.M)

# `L("…")`, `L("…", args)` and `L("…", { context: "…" })`. Only a plain literal
# counts: a key built at run time is a key no translator can find, which is
# itself worth knowing, so those are reported separately rather than silently
# missed.
#
# The boundary is written out rather than `\b`, because `URL(` ends in `L(`
# and every `new URL("../workers/…")` in this repository would otherwise read
# as a string somebody has to translate (measured).
L_CALL = re.compile(
    r'(?<![A-Za-z0-9_$])L\(\s*"((?:[^"\\]|\\.)*)"'
    r'(?P<context>\s*,\s*\{\s*context:\s*"(?:[^"\\]|\\.)*"\s*\})?', re.S)
L_DYNAMIC = re.compile(r'(?<![A-Za-z0-9_$])L\(\s*(?!")', re.S)


def repo_root(override):
    if override:
        return pathlib.Path(override).resolve()
    return pathlib.Path(__file__).resolve().parents[3]


def code_sources(root):
    for source_root in SOURCE_ROOTS:
        base = root / source_root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in SOURCE_SUFFIXES or not path.is_file():
                continue
            if SKIP_PARTS & set(path.relative_to(root).parts):
                continue
            if path.name.endswith((".test.ts", ".test.tsx")):
                continue
            yield path


def help_files(root, language):
    base = root / HELP / language
    if not base.is_dir():
        return []
    return sorted(p for p in base.rglob("*.md"))


def languages(root):
    base = root / HELP
    if not base.is_dir():
        return []
    return sorted(p.name for p in base.iterdir() if p.is_dir())


def unescape(text):
    """A string literal's body, as the string it stands for."""
    return (text.replace('\\"', '"').replace("\\n", "\n")
                .replace("\\t", "\t").replace("\\\\", "\\"))


# --- the three checks --------------------------------------------------------

def collect_code_anchors(root):
    """anchor -> [where it is declared], from the Swift sources."""
    found = {}
    for path in code_sources(root):
        text = path.read_text(encoding="utf-8", errors="replace")
        for number, line in enumerate(text.splitlines(), 1):
            for anchor in ANCHOR_IN_CODE.findall(line):
                found.setdefault(anchor, []).append(
                    f"{path.relative_to(root)}:{number}")
    return found


def collect_help_anchors(root, language=FALLBACK):
    """anchor -> [the help files that cover it]."""
    found = {}
    for path in help_files(root, language):
        for anchor in ANCHOR_IN_HELP.findall(
                path.read_text(encoding="utf-8", errors="replace")):
            found.setdefault(anchor, []).append(
                str(path.relative_to(root / HELP)))
    return found


def english_fingerprint(root, relative):
    """The hash a translation of `relative` should be carrying.

    Over the English file with its own `@source-sha` line removed, so that
    blessing the English file — which never carries one — cannot change what
    every translation is measured against.
    """
    source = root / HELP / FALLBACK / relative
    if not source.is_file():
        return None
    text = SOURCE_SHA.sub("", source.read_text(encoding="utf-8", errors="replace"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def check_translations(root):
    """[(language, relative path, what is wrong)] for every translated file."""
    problems = []
    for language in languages(root):
        if language == FALLBACK:
            continue
        for path in help_files(root, language):
            relative = str(path.relative_to(root / HELP / language))
            wanted = english_fingerprint(root, relative)
            if wanted is None:
                problems.append((language, relative,
                                 "there is no English file it translates"))
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            match = SOURCE_SHA.search(text)
            if not match:
                problems.append((language, relative, "no @source-sha recorded"))
            elif match.group(1) != wanted:
                problems.append((language, relative,
                                 "English changed since it was translated"))
        # A page that exists in English and not here is not "stale", it is
        # absent — and the reader gets the English one, which the loader is
        # explicit about. Still worth naming.
        for path in help_files(root, FALLBACK):
            relative = str(path.relative_to(root / HELP / FALLBACK))
            if not (root / HELP / language / relative).is_file():
                problems.append((language, relative, "not translated at all"))
    return problems


def parse_strings(path):
    """A .strings file as {key: value}. Comments and blank lines are skipped.

    Deliberately strict about the one line shape the catalogues use, so that a
    file this cannot read is reported rather than half-read — Swift's own
    parser refuses the same file, and a language that silently loses half its
    words is the worst outcome available.
    """
    entries = {}
    broken = []
    text = path.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    for number, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        match = re.match(r'^"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;$', line)
        if not match:
            broken.append(number)
            continue
        entries[unescape(match.group(1))] = unescape(match.group(2))
    return entries, broken


def collect_string_keys(root):
    """The keys the code asks for, and the sites that build one at run time.

    Comment lines are skipped, which is why this walks lines rather than the
    whole file: `L("…")` inside a doc comment is an example of how to call it,
    not a string anyone has to translate, and counting those would have every
    language permanently "missing" the sample in `Localization.swift`. A
    trailing comment after real code still counts, because the code before it
    does.
    """
    keys = set()
    dynamic = []
    interpolated = []
    for path in code_sources(root):
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        # Comment lines are blanked rather than dropped, so the line numbers a
        # dynamic call is reported at stay the file's own.
        code = ["" if line.lstrip().startswith("//") else line for line in lines]
        # Matched over the joined text, not line by line: real code wraps, and
        # `L(\n    "a long sentence")` is one call however it is laid out.
        for literal, context in L_CALL.findall("\n".join(code)):
            # `L("Edit", { context: "menu" })` is the key `menu|Edit`: one English
            # word that is two words elsewhere (see `L(_:context:)`).
            name = unescape(literal)
            if context:
                name = unescape(context.split('"', 1)[1].rsplit('"', 1)[0]) + "|" + name
            keys.add(name)
        for literal, _ in L_CALL.findall("\n".join(code)):
            # A key with a live interpolation in it is a key that is a
            # different string on every call, so no translation can ever match
            # it and the sentence is silently English for ever. It compiles,
            # which is why it is worth a check. (A template literal's `${` is
            # what that looks like here.)
            if "${" in literal:
                interpolated.append(f"{path.relative_to(root)}: {unescape(literal)[:60]}…")
        for number, line in enumerate(code, 1):
            # `L(` with no quote after it, here or on the next line — and not
            # the declaration itself.
            if not L_DYNAMIC.search(line) or "export function L(" in line:
                continue
            following = (line + "\n" + (code[number] if number < len(code) else "")).strip()
            if L_CALL.search(following):
                continue
            dynamic.append(f"{path.relative_to(root)}:{number}")
    return keys, dynamic, interpolated


def check_strings(root):
    wanted, dynamic, interpolated = collect_string_keys(root)
    report = {}
    base = root / STRINGS
    if base.is_dir():
        # One file per language, named for it: English ships none at all, the
        # keys being the English.
        for path in sorted(base.glob("*.strings")):
            language = path.stem
            entries, broken = parse_strings(path)
            missing = sorted(wanted - set(entries))
            unused = sorted(set(entries) - wanted)
            notes = [f"line {n} will not parse" for n in broken]
            report[language] = (missing, unused, notes)
    return report, dynamic, interpolated


# --- writing, only when asked ------------------------------------------------

def bless(root, targets):
    """Record the current English fingerprint in each named translation."""
    written = []
    for target in targets:
        parts = pathlib.PurePosixPath(target).parts
        if len(parts) < 2:
            print(f"bless: {target} is not <language>/<path>", file=sys.stderr)
            continue
        language, relative = parts[0], str(pathlib.PurePosixPath(*parts[1:]))
        path = root / HELP / language / relative
        if not path.is_file():
            print(f"bless: {target} does not exist", file=sys.stderr)
            continue
        wanted = english_fingerprint(root, relative)
        if wanted is None:
            print(f"bless: {target} translates nothing", file=sys.stderr)
            continue
        text = path.read_text(encoding="utf-8")
        line = f"@source-sha {wanted}"
        if SOURCE_SHA.search(text):
            text = SOURCE_SHA.sub(line, text, count=1)
        else:
            text = line + "\n" + text
        path.write_text(text, encoding="utf-8")
        written.append(target)
    return written


def emit_missing(root, language):
    report, _, _ = check_strings(root)
    missing = report.get(language, ([], [], []))[0]
    if not missing:
        print(f"/* {language}: nothing missing */")
        return
    print(f"/* {language}: {len(missing)} keys with no translation yet */")
    for key in missing:
        escaped = key.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        print(f'"{escaped}" = "{escaped}";')


# --- the report --------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", help="repository root (default: found from this file)")
    parser.add_argument("--bless", nargs="+", metavar="LANG/PATH",
                        help="record the current English fingerprint in these translations")
    parser.add_argument("--emit-missing", metavar="LANG",
                        help="print the untranslated keys in .strings form")
    parser.add_argument("--list-keys", action="store_true",
                        help="print every key the code asks for, one per line")
    parser.add_argument("--quiet", action="store_true",
                        help="print nothing; the exit status is the answer")
    args = parser.parse_args()
    root = repo_root(args.repo)

    if args.bless:
        for target in bless(root, args.bless):
            print(f"blessed {target}")
        return 0
    if args.emit_missing:
        emit_missing(root, args.emit_missing)
        return 0
    if args.list_keys:
        keys, _, _ = collect_string_keys(root)
        for key in sorted(keys):
            print(key.replace("\n", "\\n"))
        return 0

    code = collect_code_anchors(root)
    covered = collect_help_anchors(root)
    uncovered = sorted(set(code) - set(covered))
    orphaned = sorted(set(covered) - set(code))
    stale = check_translations(root)
    strings, dynamic, interpolated = check_strings(root)

    problems = len(uncovered) + len(orphaned) + len(stale) + len(dynamic) + len(interpolated)
    for missing, unused, notes in strings.values():
        problems += len(missing) + len(unused) + len(notes)

    if args.quiet:
        return 1 if problems else 0

    width = max([len(a) for a in uncovered + orphaned] + [24])
    print("anchors")
    print(f"  declared in code: {len(code)}, covered by help: {len(covered)}")
    if uncovered:
        print(f"  uncovered ({len(uncovered)}) — functionality with no help")
        for anchor in uncovered:
            print(f"    {anchor.ljust(width)}  {code[anchor][0]}")
    if orphaned:
        print(f"  orphaned ({len(orphaned)}) — help for something the app lost")
        for anchor in orphaned:
            print(f"    {anchor.ljust(width)}  {covered[anchor][0]}")
    if not uncovered and not orphaned:
        print("  all square")

    print("translations")
    if stale:
        for language, relative, why in stale:
            print(f"  {language}/{relative}: {why}")
    else:
        print("  every translation is current")

    print("strings")
    for language in sorted(strings):
        missing, unused, notes = strings[language]
        print(f"  {language}: {len(missing)} missing, {len(unused)} unused"
              + ("" if not notes else " — " + "; ".join(notes)))
        for key in missing[:10]:
            print(f"    missing: {key}")
        if len(missing) > 10:
            print(f"    … and {len(missing) - 10} more")
        for key in unused[:10]:
            print(f"    unused:  {key}")
    if dynamic:
        print(f"  {len(dynamic)} call(s) build a key at run time, which no "
              "translator can find:")
        for where in dynamic[:10]:
            print(f"    {where}")
    if interpolated:
        print(f"  {len(interpolated)} key(s) carry a live interpolation, so no "
              "translation can ever match them:")
        for where in interpolated[:10]:
            print(f"    {where}")

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
