---
name: help-names
description: Check that every menu item, button and command the help book names is one the app actually says, in each language. Catches a help page promising words the reader will never find on screen — a translated menu title that drifted from the string catalogue, a label that only ever existed in the design notes. Read-only; run it after editing a help page, after renaming anything user-visible, and after translating. Invoke as /help-names.
---

# Names the help promises

> Ported from ByteRipper's skill of the same name. What differs is where
> things live — `src/core/help/content/<language>/` for the book, one
> `<language>.strings` per catalogue rather than an `.lproj` folder — and that
> the sources are TypeScript. The check itself is upstream's, unchanged: the
> catalogue is still "everything the app can put on screen", and the book's
> bold spans are still "everything it offers as a name".

A help page that writes **Файл ▸ Открыть недавние** is making a promise: the
reader will open the File menu and find those words. Nothing enforces it.

The English page is written beside the code and usually keeps up. A translation
is written later, against a string catalogue nobody re-reads, and it drifts
quietly — the app says «Недавние документы» and the page says «Открыть
недавние», and both look right to whoever wrote them. Worse is a name that was
never in the interface at all: «Файл A» and «File B» lived in this book for
months, taken from the architecture notes, where the workspace holds two file
slots called A and B. On screen there is one workspace, and two file panes.

This skill is the mechanical check for that class of mistake.

```bash
python3 Skills/help-names/scripts/help_names.py
```

Read-only, deterministic, stdlib only. Exit status is 1 when anything is
reported.

## What it does

Everything a language can put on screen is in its `<language>.strings` — the
values for a translation, the keys for English, since the key *is* the English.
Everything the help offers as a name is in bold.

So: collect every `**…**` span in that language's pages, and look it up.

- **A span with `▸` in it is a menu path**, and every part of it must be a name
  the app says. That is the high-signal check, and it is the default.
- **A short span without `▸`** may be a button or a command, or it may be the
  book stressing a word. The two are not distinguishable from the markup, so
  they are behind `--controls` and have to be read by eye.

Normalisation is deliberately small: a trailing `…`, ordinary punctuation, and
a keyboard shortcut the help appends in brackets (`**File ▸ Open…** (⌘O)`). A
bold span holding a `[[term:…]]` link is a link, not a control name, and is
skipped.

```bash
python3 Skills/help-names/scripts/help_names.py ru          # one language
python3 Skills/help-names/scripts/help_names.py --controls  # the wider net
```

## Reading a report

```
ru: 3 name(s) the app never says
  ru/Topics/navigation.md:32  «Поменять панели местами»   in: Вид ▸ Поменять панели местами
```

Three things it can be, and they need different fixes:

1. **The page is wrong.** The app says «Поменять файловые панели местами».
   Fix the page.
2. **The app is wrong.** The page has the better name. Rename the command,
   which means changing the `L("…")` key and re-translating it.
3. **Neither.** The name is real but reaches the screen without `L()` — a bare
   literal. That is a bug: the control is untranslated in every language, and
   `help-coverage` cannot see it, because it only knows about strings that went
   through `L()`. Route it through `L()` and add the translations.

The third is worth the run on its own. It is how the UEFI panel's node context
menu was found to be English in all three languages: six titles built from bare
literals, including `Open Node` and `Open Decompressed Body`.

## What it cannot check

Only names. A page that names every command correctly and then describes what
they do incorrectly passes clean — "the app asks which pane to replace", when
it replaces the active one without asking, is invisible here.

That kind of claim is found by reading the code that implements the thing, and
there is no shortcut for it. When a page describes behaviour rather than
naming a control, open the implementation and check.

## Related

- `Skills/help-coverage` — the other three gaps: functionality with no help,
  help for functionality that is gone, translations behind their English, and
  strings a language has not got.
