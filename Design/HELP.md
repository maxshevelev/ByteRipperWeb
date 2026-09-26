# The help: one book, read from the dock and from beside the thing it explains

> What the app has to say about itself, and what the words in the firmware
> panels mean. Written as content files, not as strings in TypeScript, so it
> can be translated; keyed by stable ids, so a `?` beside a form and a row in
> the ME panel can both point at it.

Upstream's `Design/HELP.md` is the source of this one, and everything it
decides holds here unless this file says otherwise. Read it first: the reasons
are written there and are not repeated.

What this file adds is the half the browser changes — **where the book is
shown**, since the web edition has no second window to show it in — and the
places the content itself has to be rewritten, because a page describing the
Finder is a page a bench reading it in Chrome cannot follow.

## What is carried over unchanged

- **Structure is code, words are resources.** `helpContents.ts` lists the
  sections and their order; `HelpTopicId` and `HelpTermId` name the pages and
  the terms. Everything a reader reads is a file under
  `src/core/help/content/<language>/`.
- **The content layout** — `Sections.md`, `Topics/<id>.md`,
  `Terms/{general,uefi,me}.md` — file for file, so a page can be diffed against
  the upstream page it came from.
- **The markup**: the same six rules, the same `[[topic:id]]` and `[[term:id]]`
  links, the same block model. A translator who has learnt upstream's book has
  learnt this one.
- **The split**: `src/core/help/` is pure TypeScript with no DOM, tested
  without a browser; `src/ui/help/` draws it. That is upstream's
  `HelpBook` / `HelpUI` split with this repository's own directory names.
- **The fallback**: a language that has not translated a file falls back to the
  English one, file by file, so a half-translated book is readable rather than
  blank.

## Where the book is shown: a pill in the dock

Upstream opens a window. The web edition has one workspace per browser tab and
no window management at all (`ANALYSIS.md`), so a second window is not
available, and the three obvious substitutes are each worse than they look:

- **A modal dialog** is the wrong shape for a book. Help is read *while* doing
  the thing it explains — the reader wants to look at the page and then at the
  bytes, and a modal makes that a sequence of openings and closings.
- **A browser tab of its own** loses the one thing that makes help worth
  opening on a bench: it is no longer beside the dump. It also puts the reader
  in a second copy of the app's chrome for no reason.
- **A sidebar** takes width from the panes permanently, and width is what a hex
  dump is short of: sixteen bytes and their text column set the minimum.

So the help takes **a pill in the fragment dock**, and opens as the panel over
the panes — the surface this app already has for "something else to look at,
without giving up the workspace".

The dock is ready for it and needs no rework: `src/state/fragmentDock.ts`
"holds identity and order and nothing else … what a panel *is* lives in the
state kept against its id". The help is a second kind of thing a panel can be.

What follows from using it, all of it inherited rather than invented:

- **At most one panel is up**, so opening the help folds the fragment panel and
  the reverse. That is right: the stage is one, and the help is about what is
  on it.
- **The pill stays when the panel is folded.** Help opened once is a click away
  for the rest of the session, which is what a reader working through a recipe
  actually does.
- **Esc folds it**, ✕ on the pill closes it, and the page it was on is
  remembered until it is closed.
- **There is exactly one help pill.** Asking for help again raises the pill
  there is and navigates it, rather than stacking a second book on the dock.
  Fragments deduplicate nothing — two zones opened twice are two panels — but
  two copies of one book are not two things.

### The panel's own navigation

The panel is wide and short where upstream's window is tall, so the contents
is a column beside the page rather than a sidebar over it:

```
┌─────────────────────────────────────────────────────────────────┐
│ ‹ ›  Getting started ▸ Opening files          [ search… ]    ⌄ ✕ │
├──────────────┬──────────────────────────────────────────────────┤
│ Contents     │  Opening files                                   │
│  Getting…    │  > Two slots, and what a browser can and cannot   │
│   Overview   │                                                  │
│  ▸ Opening…  │  Drag a dump onto either half of the window…     │
│   Large files│                                                  │
│  Reading…    │  ! A file opened in Firefox is read into memory…  │
└──────────────┴──────────────────────────────────────────────────┘
```

- **Back and forward** (`‹ ›`) walk the reader's own history of pages and
  terms, because every page links to others and a glossary entry is usually
  reached from the middle of one. Alt+← / Alt+→ as well as the buttons.
- **The breadcrumb** names the section and the page, so a reader who arrived by
  a link knows where in the book they landed.
- **The contents column** lists the sections and their pages, with the current
  one marked. Below about 720px of panel width it collapses to a *Contents*
  button that slides the column over the page, because sixteen bytes' worth of
  minimum width is the panes' problem and this panel has the same one.
- **Search** is a substring match over title, summary and body, as upstream's
  is, showing pages and terms together with the matching line under each.
  Forty pages: no ranking, no index.
- **⌄** folds the panel into its pill; **✕** closes it.

### A term is a popover, not a page

A `?` beside a row in a firmware panel opens the term's **popover** — its name,
its one sentence, and a *More* link — anchored to the button, exactly as
upstream does it. A word met in a row is a question worth one sentence; making
it raise a panel over the tree the reader is reading would cover the row they
asked about. *More* raises the help panel at that term's entry in the glossary.

## Where the help is reachable from

The menu bar is gone, so upstream's Help menu becomes a **Help block in the
toolbar's menu**: ByteRipper Help, Getting started, Bench rules, the two
glossaries, and the provenance note — the same five destinations, each a
`HelpLink`.

Everywhere else is as upstream, and each is a `?` that opens the page named:

| Where | Opens |
|---|---|
| The toolbar's menu | the book, at the contents |
| The empty state, beside the hint | `overview` |
| A tool panel's header, beside its ✕ | the running module's page (`toolModule.helpTopic`) |
| A firmware panel's detail list | the term for the row in focus, as a popover |
| The find bar | `search` |
| The Segments form | `segments` |
| The Go To / Bookmarks form | `bookmarks` |
| Settings ▸ Editing | `editing` |

**Keyboard**: `F1` and `⌘/`/`Ctrl+/` open the book. Not upstream's `⌘?`: in a
browser that is `⌘⇧/`, which several engines and extensions already spend, and
`F1` is what a web application is expected to answer.

## The content is rewritten where the web differs

This is the part that cannot be a copy. A page that tells a bench to use the
Finder, or promises that a save writes into the file it read, is worse than no
page at all — it is a page that will be believed.

Every English topic is ported and then read against `ANALYSIS.md` §2 and
`GAPS.md` §2. The pages known to need it, and what they have to say instead:

- **`opening-files`** — drag and drop or the open zone; no Finder, no Open
  Recent (G62); the browser asks for permission per file and asks again after a
  reload; one workspace per browser tab.
- **`saving`** — Chromium saves in place through the File System Access API;
  Firefox and Safari can only *download a copy*, and the app says which it is
  about to do. A file changed on disk behind an open dump.
- **`large-files`** — chunked reading and what the browser's memory actually
  allows; no memory mapping.
- **`navigation`** — the browser's page zoom is the zoom; no tabs of the app's
  own, no window management.
- **`settings`** — settings live in this browser profile, not in a user
  account, and the language changes without a relaunch (`LOCALIZATION.md`).
- **`databases`** — fetched from GitHub through the Cache API, a day's
  freshness rule, yesterday's copy on a bench with no network, and the date
  shown so yesterday's data is never mistaken for today's.
- **`fragments`** — the dock is here as upstream has it, but a panel cannot be
  torn off into a window; and the dock is also where the help itself sits.
- **`bench-safety`**, **`editing`**, **`join-duplicate`** — the rules are the
  same; the dialogs they name are checked against the web's.

The three glossaries — `general`, `uefi`, `me` — are firmware vocabulary and
port very nearly verbatim: `$FPT` is `$FPT` on every platform. Their web edits
are limited to cross-references that name a page this edition changed.

## What is deliberately not done

- **No minimap `?`**, for upstream's reason: the panel is too narrow to spend a
  control on, and the page is reached from the contents and from links.
- **No `?` on the other settings tabs**, for upstream's reason.
- **No search ranking.** Forty pages.
- **No URL for a page.** A `#help/opening-files` in the address bar would be a
  real web affordance — a link a colleague can be sent — but the workspace has
  no routing at all today, and adding history entries under a reader's Back
  button is a decision about the whole app rather than about the help. Worth
  taking on its own; recorded in `GAPS.md`, not smuggled in here.
