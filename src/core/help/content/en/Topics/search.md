# Finding Bytes and Text

> [[key:find]]. Hex bytes or text, over the whole dump, in the background.

@covers menu.edit.find
@covers shell.find-bar
@covers shell.search-results
@covers settings.favorites

The find bar searches the **active pane**, over its current contents, unsaved edits included.

## Which find bar searches what

A find bar belongs to the dump it searches. The workspace's bar stands over the comparison panes and the minimap, and searches the active pane of the two. A [[topic:fragments|fragment panel]] has a find bar of its own, over the fragment's dump, which searches the fragment only. [[key:find]] and the toolbar's **Find** act on the bar of the panel in front.

Each bar keeps its own pattern, its own matches and its own case rule: a search in a fragment does not disturb the search in the workspace, and the other way round. A fragment panel's bar starts with the case rule of the bar the fragment was taken out under. When the panel is folded into the dock, its bar goes with it, and it is there again, as it was, when the panel is raised.

## Hex

A byte sequence is entered as `DEADBEEF`, `DE AD BE EF` or `0xDE 0xAD`; spaces are optional. Once the search has been started the field is rewritten in the form the dump itself uses — uppercase pairs separated by single spaces — so that the pattern can be held against the bytes on screen.

A hex search is always exact. Bytes have no case, and the case option is therefore not offered for it.

`??` in place of a pair stands for any byte. `24 ?? 4D 49` finds `$DMI`, and also `$BMI` or any other four bytes with `24` first and `4D 49` last; it is written back as `24 ?? 4D 49` like any other pattern. A hole is always a whole byte: half a byte, as in `2?`, cannot be masked, and the field says so. A pattern made of `??` alone would match at every address and is refused. Saved patterns and the search history keep `??` as it was typed.

## GUID

A GUID is entered as it is written in code and in specifications: `CDEA2BD3-FC25-4C1C-B97C-B31186064990`, in either case, with or without braces. It is looked for as the 16 bytes it occupies in a firmware image: the first three groups with their bytes reversed, the last two as written — `D3 2B EA CD 25 FC 1C 4C B9 7C B3 11 86 06 49 90`. With **GUID** chosen and Smart Search off, the field must hold exactly one GUID in that form; anything else is refused as an invalid pattern.

The search is exact, like a hex search.

## Text

An encoding is chosen — ASCII, UTF-8, UTF-16 LE or UTF-16 BE — and the string is entered. It is encoded to bytes and matched exactly on those bytes.

Case-insensitive matching is offered for text.

## Smart Search

A string in a dump is in whichever encoding the maker of the firmware happened to use, and the reader usually knows **what** they are looking for rather than **how it is written**. Smart Search removes that question: the encoding becomes a result of the search instead of a condition for it. That is why it is on by default — there is usually nothing to base a choice of encoding on beforehand.

What was typed is looked for in one form after another until something is found:

- Where it reads as a GUID, it is looked for as a GUID first, before any other form, and as text after.
- Where it reads as a byte sequence — an even run of hex digits, `DEADBEEF`, or those digits in pairs, `DE AD BE EF`, with `??` for any byte — it is looked for as bytes first and as text after. A `??` counts as a byte only where it stands as one: a pair of its own, `24 ?? 4D 49`, or a pair inside a run, `24??4D49`. At the edge of a run it is read as question marks, so `FACE??` is looked for as text.
- Otherwise the encodings are tried in turn: ASCII, UTF-8, then UTF-16 LE and UTF-16 BE.
- An encoding that cannot carry what was typed at all is left out: there is nothing to look for in it.
- Attempts that come to the same bytes are merged into one pass. `abc` as ASCII and as UTF-8 is the same three bytes, and the dump is not read twice for one answer.

The encoding that found the match is the one left selected in the popup, which is how the answer to the unasked question becomes visible. Where nothing is found, the program lists the encodings it tried.

An encoding chosen by hand sets where the search starts, and so does an entry picked out of the search history, which carries its own encoding with it. In the rare case where Smart Search misses or finds more than was meant, it is switched off and only the chosen encoding is searched.

## While a search is running

Every match in the file is filled in grey; the current one is drawn as a raised yellow bubble. **‹ ›** move between them and the bar reports the count. Over a large dump the search runs in the background and can be cancelled, and matches appear as they are found.

The matches are marked in the [[topic:minimap|minimap]] as well, where their distribution over the image is visible.

### Matches that overlap

A match is counted at every address where the pattern begins, even where it begins inside another match. `FF FF` over a run of five `FF` bytes is therefore four matches, not two. The difference arises only for a pattern that repeats within itself — a run such as `FF FF` or `00 00 00`, or a mask such as `24 ?? 24`; a signature such as `$DMI` or `_FVH` is found exactly as it would be otherwise. Some other hex editors do not count overlapping matches, so their count for such a pattern can be lower.

Overlapping matches are filled as one grey band. **‹ ›** and [[key:findNext]] move through them one byte at a time, and **Search Results** lists each one with its own address.

The result does not depend on where the search was started: Find Next from the caret lands only on matches that Search Results also lists.

**Search Results** in the find bar opens a list of what was found, which can be clicked through; pressing it again closes the list.

## Patterns you use often

**[[key:find]] with bytes selected** loads the selection as the search pattern, which is how a sequence selected in one dump is then looked for in the other. Upstream keeps that on a key of its own (⌘E); here [[key:find]] carries both meanings, because with a selection there is only one thing Find can sensibly mean.

Patterns can be named and kept in a pattern library (**Settings ▸ Search Patterns**) — for instance the recurring signatures `_FVH`, `$FPT` or `24 00 00 00`. The library lives in this browser; it can be exported and imported anywhere, and in a Chromium browser it can be synchronised through a folder so that several installations share it — including the macOS application, whose file format it is.

See also: [[topic:bookmarks|Bookmarks]], for marking an address that was found.
