# Localization: the language the app speaks, and how it stays true

> English, Russian and German. The browser's language by default, the user's
> own choice when they want one — and, unlike the Mac app, no relaunch, because
> in a browser a relaunch would throw the open files away.

Upstream's `Design/LOCALIZATION.md` is the source of this one. Who the
translation is for, the register it is written in, and the rules that keep it
honest — a settled national equivalent wins, otherwise keep the English term,
explain the term rather than replace it — are decided there and hold here
word for word. This file records what the browser changes.

## The key is the English text

As upstream:

```ts
label.textContent = L("Drop files here");
confirm.message = L("Close “%1$@”?", name);
tab.label = L("Edit", { context: "menu" });
```

- The key is the English, so a site is localized by wrapping the literal it
  already had, and an untranslated key falls back to correct English.
- Placeholders are positional — `%1$@`, `%2$@` — and substituted by the app's
  own formatter, not by a template literal, so a translation can reorder them.
- `context` disambiguates one English word that is two words elsewhere; the
  catalogue key is `"menu|Edit"`, and a language that does not need the
  distinction simply does not write that entry.
- A key must never carry a live interpolation: `L(\`at ${offset}\`)` is a
  different string on every call and can never be translated.

`src/core/localization/` holds the lookup and one catalogue per language, in
upstream's own `.strings` format under `catalogues/<lang>.strings`. Keeping the
format means a translator's tools work on both repositories, and a string the
two editions share can be copied across without being re-typed. English ships
no file: the keys are the English.

## Which language

`languageChoice` is `system` or a fixed language, kept in the settings store
beside the theme, and resolved against **`navigator.languages`** where upstream
resolves against `Locale.preferredLanguages`. The resolution rule is upstream's:
the list is asked in order, a regional name matches the plain language behind
it (`de-AT` is German), and a language the app does not have falls back to
English rather than to the browser's next choice.

**Settings ▸ Language** offers *Same as the browser (…)*, naming what it
currently resolves to, and then each language in itself: Русский, Deutsch.

## No relaunch — the app changes language where it stands

This is the one substantial divergence, and it is not a preference:

> **A relaunch here means reloading the page, and a reloaded page has no
> files.** The dumps a bench has open are `File` objects and file handles the
> page was granted; a reload asks for them all again, or loses them. Upstream
> can offer *Relaunch Now* because a Mac app reopens its documents. This one
> cannot, so it must change language in place.

What that costs, and how each part is paid:

- **React chrome** re-renders. `L` is called during render, never at module
  scope, so a version counter in the settings store is the whole mechanism.
  *Never* `const TITLE = L("…")` beside an import: that string is read once,
  at load, and would keep the language the page started in.
- **The canvas** is repainted: the hex grid's own text is bytes, but its
  status line, its accessible description and its empty states are words.
- **Workers** are told. A worker holds its own catalogue — the firmware parsers
  build node names off the main thread — so the resolved catalogue is posted to
  each worker when it starts and again when the language changes, and work
  already queued finishes in the language it started in.
- **Text already produced** and kept in a store — a parsed UEFI tree's node
  names, an ME analysis's rows — is rebuilt, because it was built from words.
  That rebuild is the price of not reloading, and it is cheaper than the file
  the reload would lose.

The help is not an exception here as it is upstream, because nothing is: every
page is built from the book when it is shown, and the book reloads with the
language like everything else.

## What is deliberately not translated

- **The ME engine's diagnostics**, for upstream's reason: they are a faithful
  port of MEAnalyzer's own messages and are compared against them.
- **Format and structure names** — `$FPT`, `$CPD`, `MFS`, `BPDT`, `Boot Guard`,
  `FIT`, `SVN` — in every language, because that is what the datasheets and the
  benches call them.
- **The capability sentences the browser forces on us** are translated like any
  other UI string, but the API names in them (`File System Access`) are not.

## Under test

The suite pins the language to English, as upstream's does: a test asserting on
what the app says must not pass in Frankfurt and fail in Moscow. The catalogue
is installed through the same interface the app uses, so a test that wants to
assert on a translation installs one of its own — and no test reads the
browser's language.

## The coverage check

`Skills/help-coverage/` is ported with the rest: it is what says, mechanically,
that new functionality shipped without a page, that a catalogue has fallen
behind the English it was made from, or that a call site smuggled an
interpolation into a key. A skill is cheap; a translation that quietly rots is
not.
