---
name: help-editions
description: Check the help book's two-edition forms — the [[key:…]] chords and the [[edition:…||…]] phrases that let one set of pages read correctly in a browser and in the desktop shell. Catches a chord written as a spelling instead of an id, an unbalanced or nested edition phrase, and an edition phrase that one side of the split cannot resolve. Also prints the manifest of the passages that read differently by edition — the review surface when a port touches a page. Read-only; run it after editing a help page, after adding or re-wording a chord, and after porting an upstream change that a help page names. Invoke as /help-editions.
---

# The two editions of one book

> The book is a single set of Markdown files under
> `src/core/help/content/<language>/`, but it is read in two applications that
> are not the same: a browser, and the desktop shell (`desktop/`). The browser
> keeps some of the keyboard chords for its own tabs and saves through a
> download; the shell binds those chords and saves in place for every file. A
> page that wrote one of those words as fixed prose would be right in one
> application and wrong in the other. So the pages carry two inline forms, and
> this skill is the check for them.

## The two forms

Both are resolved where the keyboard or the application is, so a page is one
file, not one per edition:

- **`[[key:find]]`** — a chord. The page names the *command* and the spelling is
  decided at read time by the reader's keyboard: `⌘F` on a Mac, `Ctrl+F` on the
  shell. The closed set a page may name is the `HelpCommand` union in
  `src/core/help/helpKeys.ts`, and the Mac→shell mapping in that file is the
  same rule the shell's own menu uses, so a chord the help shows and a chord the
  menu shows cannot disagree.
- **`[[edition:…||…]]`** — a phrase that reads one way in the browser and
  another in the shell: the first half is the browser, the second the shell.
  With no `||` the phrase is the same for both. A half may itself hold links,
  chords and bold, which is why the split is made on the first `||` that sits
  *outside* any `[[ … ]]`. An empty half is a device: a line written as
  `[[edition:…||]]` exists in the browser and vanishes in the shell.

The parser is `src/core/help/helpMarkup.ts` (`applyEdition`, `editionClose`,
`topLevelEditionBar`) and the spellings are `src/core/help/helpKeys.ts`.

## Running it

```bash
python3 Skills/help-editions/scripts/help_editions.py
```

Read-only, deterministic, stdlib only. Exit status is 1 when a problem is
reported. It re-derives the closed chord set from `helpKeys.ts`, so a chord
added to the table is a chord a page may name on the same change, with nothing
to keep in step by hand.

```bash
python3 Skills/help-editions/scripts/help_editions.py de       # one language
python3 Skills/help-editions/scripts/help_editions.py --chords  # list every [[key:…]] too
python3 Skills/help-editions/scripts/help_editions.py --manifest-only
python3 Skills/help-editions/scripts/help_editions.py --json
```

## What it checks

- **Every `[[key:…]]` names a command the table carries.** A chord written as a
  spelling — `[[key:Ctrl+S]]`, `[[key:⌘F]]` — is a double conversion (the slot
  wants the id, `save`, and the resolver does the rest) and is called out by
  name, as is an id the table does not know.
- **Every `[[edition:…]]` balances.** The closing `]]` is found by counting the
  inner `[[ … ]]` a half carries; a phrase with no close, or a half that holds a
  second `[[edition:…]]` (nesting is not supported), is a problem.
- **Each half of a split resolves.** After the edition is applied, no
  `[[edition:…]]` may survive on either side — a leftover is a phrase the split
  could not resolve.
- **The link markers balance.** A file with one more `[[` than `]]` left a link
  open.

A phrase with an empty half is *not* a problem — it is the one-edition-only
device — but the manifest says which edition loses it, rather than letting the
line vanish silently.

## The manifest

The second half of the report is the review surface for the port cycle. It is
the list, per language and file, of the passages that read differently by
edition, with the two halves side by side:

```
de/Topics/saving.md
     6  differs
       browser:  Wo das Programm in die geöffnete Datei zurückschreiben kann, sagt es **…
       shell:    Das Fenster schreibt in die Datei zurück, die es geöffnet hat, daher sa…
    14  only in the browser
       browser:  Eine per Ziehen abgelegte Datei wird ebenfalls an Ort und Stelle gesichert. …
```

This is what a port touches. When an upstream change alters a page's words, the
shell's half of each `differs` passage is the claim to re-check against the code
— the half the browser never shows, and the one nobody re-reads. `only in the
browser` (and its mirror) are the lines that exist on one side alone, and they
are the most likely to be left dangling by a change that makes the condition
false on the other side. Read the two halves against the implementation, the way
`help-names` says to read a page that describes behaviour rather than naming a
control.

The manifest is informational: it never changes the exit status. The check fails
only on the problems above.

## What it cannot check

Only the forms, not the truth. A well-formed `[[edition:…||…]]` whose shell half
says the wrong thing — "the shell saves in place" where it actually downloads —
passes clean, just as `help-names` passes a page that names every command and
then describes them wrong. That kind of claim is found by reading the code.

## Related

- `Skills/help-names` — a different kind of drift: a bolded menu name the app no
  longer says. Run both after a page edit.
- `Skills/help-coverage` — the gaps between functionality and the pages that
  cover it.
- `Skills/port-from-byteripper` — the cycle this skill is the review surface for.
