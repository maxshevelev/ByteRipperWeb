---
name: help-coverage
description: Check and repair the three things that rot between the app, its help book and its translations — functionality with no help page (anchors declared in code that nothing covers), help that documents something the app no longer has (orphaned anchors), translations that have fallen behind the English they were made from (stale @source-sha), and UI strings used in code that a language's <language>.strings has not got. Use after adding or changing any user-visible functionality, after editing an English help page, after translating anything, and before a release. Invoke as /help-coverage.
---

# Help coverage and translation sync

> Ported from ByteRipper's skill of the same name. What differs is where things
> live — `src/core/help/content/<language>/` for the book, one
> `<language>.strings` per catalogue rather than an `.lproj` folder — and that
> the sources are TypeScript. The three gaps, the anchors and the `@source-sha`
> fingerprint are upstream's, unchanged, so a page and its translation can be
> carried between the two repositories.

Functionality moves. Help does not move with it, and translations move last of
all. This skill is the repeatable way to find the three gaps that opens, and
the only mechanical part of closing them.

It is deterministic — the same tree always gives the same report — so a run is
a diff to review, never a rewrite by hand. It reads the repository and writes
nothing unless you ask it to (`--bless`).

```bash
python3 Skills/help-coverage/scripts/help_coverage.py
```

## The three gaps

### 1. Functionality with no help — **anchors**

An *anchor* is a stable name for one piece of user-visible functionality:
`menu.file.append`, `panel.uefi.fix-checksum`, `settings.editing.warn`.

It is declared **twice**, once on each side of the gap:

- **In the code**, on the line that implements it, as a comment:

  ```ts
  // help: menu.file.append
  { label: L("Append File…"), onSelect: () => onJoin("end") },
  ```

- **In the help**, in the page or term that explains it:

  ```
  @covers menu.file.append
  ```

The check is the join of those two sets. An anchor in the code that nothing
covers is **functionality nobody wrote help for** — which is the case this
whole system exists to catch, because it is invisible otherwise: the app ships,
works, and quietly has a feature the help never mentions. An anchor in the help
that no code declares is **help for something that is gone**, which is worse
than no help.

**Anchoring is not optional for user-visible work.** `CLAUDE.md` carries the
rule. A menu command, a settings control, a panel, a form, a tool-module: each
gets an anchor when it is written, and the anchor is what makes the page that
explains it findable later.

### 2. Translations that have fallen behind — **`@source-sha`**

Every non-English help file carries the fingerprint of the English file it was
translated from:

```
@source-sha 3f9a1c…
```

The script hashes the current English file and compares. A mismatch means the
English page changed after the translation was made, so the translation is now
**describing an older app** — the failure mode that makes localized help worse
than none.

It cannot tell you *what* changed; `git log -p` on the English file does. What
it guarantees is that nobody has to remember.

### 3. UI strings a language has not got

Every localized string in the code is `L("The English text")`. The script
collects those keys and compares them with each language's
`<language>.strings`:

- **missing** — a key the code asks for that a language has no translation
  for. It falls back to English at run time, so it is a gap rather than a bug;
  the report is how you find it.
- **unused** — a key a `.strings` file carries that no code asks for any more.
  Dead weight, and a sign a string was reworded without its translations.

## Reading the report

```
$ python3 Skills/help-coverage/scripts/help_coverage.py
anchors
  uncovered (2)
    panel.fit.top-swap            Modules/FITTool/.../FITToolViewController.swift:212
    settings.layout.pane-order    ByteRipperApp/Settings/LayoutSettings…:48
  orphaned (1)
    menu.edit.paste-write         Topics/editing.md

translations
  stale (1)
    ru/Topics/search.md           English changed since it was translated

strings
  ru: 4 missing, 0 unused
  de: 4 missing, 1 unused
```

Exit status is 1 when anything is reported, so it can gate a release.

## Closing each gap

- **uncovered** — write the help, then add `@covers <anchor>` to the page or
  term that now explains it. If the anchor names something a *term* explains
  rather than a page, put it on the term; both are checked.
- **orphaned** — the functionality is gone: delete the `@covers` line, and the
  paragraph if it was only about that. Do not delete the anchor from the code
  to silence the report.
- **stale** — re-read the English page, bring the translation in line, then
  record the new fingerprint:

  ```bash
  python3 Skills/help-coverage/scripts/help_coverage.py --bless ru/Topics/search.md
  ```

  `--bless` only writes fingerprints. It never translates anything, and
  blessing a file you have not actually re-translated is the one way to make
  this system lie.

- **missing strings** — add the keys to `Localization/Resources/<lang>.lproj/
  <language>.strings`. `--emit-missing <lang>` prints them in the file's own
  format, ready to paste and translate:

  ```bash
  python3 Skills/help-coverage/scripts/help_coverage.py --emit-missing ru
  ```

## How to translate, when you get there

The audience is a **service-centre technician**, not a general reader. The
register follows from that, and it is the same rule in both languages:

- **A settled national equivalent wins.** Where the trade has its own word in
  the language, use it: `прошивка`, `дамп`, `материнская плата`, `Prüfsumme`,
  `Platine`.
- **Otherwise keep the English term.** Nobody at a bench says "таблица разделов
  флеш-памяти"; they say `$FPT`. Format names, structure names and acronyms —
  `$FPT`, `$CPD`, `MFS`, `BPDT`, `Boot Guard`, `FIT`, `SVN` — stay as they are
  in every language, because that is what the tools, the datasheets and the
  forums call them. Translating them would make the help *harder* to use.
- **Explain the term, do not replace it.** The glossary's job is to say what
  `ARB SVN` is in the reader's language, not to invent a name for it.
- Keep `` `code` ``, `[[topic:…]]`, `[[term:…]]` and every anchor exactly as
  they are. Only the prose is translated.

## What the script does not do

- It does not translate. Every word in `ru/` and `de/` was written, not
  generated, and `--bless` is a statement that someone did that.
- It does not invent anchors. An anchor is a decision about what counts as a
  piece of functionality, and that decision is the author's.
- It does not check that a translation is *good*, only that it is *current*.
