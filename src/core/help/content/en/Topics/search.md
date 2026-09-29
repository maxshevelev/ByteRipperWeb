# Finding Bytes and Text

> ⌘F. Hex bytes or text, over the whole dump, in the background.

@covers menu.edit.find
@covers shell.find-bar
@covers shell.search-results
@covers settings.favorites

The find bar searches the **active pane**, over its current contents, unsaved edits included.

## Hex

A byte sequence is entered as `DEADBEEF`, `DE AD BE EF` or `0xDE 0xAD`; spaces are optional. Once the search has been started the field is rewritten in the form the dump itself uses — uppercase pairs separated by single spaces — so that the pattern can be held against the bytes on screen.

A hex search is always exact. Bytes have no case, and the case option is therefore not offered for it.

## Text

An encoding is chosen — ASCII, UTF-8, UTF-16 LE or UTF-16 BE — and the string is entered. It is encoded to bytes and matched exactly on those bytes.

Case-insensitive matching is offered for text.

## Smart Search

A string in a dump is in whichever encoding the maker of the firmware happened to use, and the reader usually knows **what** they are looking for rather than **how it is written**. Smart Search removes that question: the encoding becomes a result of the search instead of a condition for it. That is why it is on by default — there is usually nothing to base a choice of encoding on beforehand.

What was typed is looked for in one form after another until something is found:

- Where it reads as a byte sequence — an even run of hex digits, `DEADBEEF`, or those digits in pairs, `DE AD BE EF` — it is looked for as bytes first and as text after.
- Otherwise the encodings are tried in turn: ASCII, UTF-8, then UTF-16 LE and UTF-16 BE.
- An encoding that cannot carry what was typed at all is left out: there is nothing to look for in it.
- Attempts that come to the same bytes are merged into one pass. `abc` as ASCII and as UTF-8 is the same three bytes, and the dump is not read twice for one answer.

The encoding that found the match is the one left selected in the popup, which is how the answer to the unasked question becomes visible. Where nothing is found, the program lists the encodings it tried.

An encoding chosen by hand sets where the search starts, and so does an entry picked out of the search history, which carries its own encoding with it. In the rare case where Smart Search misses or finds more than was meant, it is switched off and only the chosen encoding is searched.

## While a search is running

Every match in the file is filled in grey; the current one is drawn as a raised yellow bubble. **‹ ›** move between them and the bar reports the count. Over a large dump the search runs in the background and can be cancelled, and matches appear as they are found.

The matches are marked in the [[topic:minimap|minimap]] as well, where their distribution over the image is visible.

**Search Results** in the find bar opens a list of what was found, which can be clicked through; pressing it again closes the list.

## Patterns you use often

**⌘F with bytes selected** loads the selection as the search pattern, which is how a sequence selected in one dump is then looked for in the other. Upstream keeps that on a key of its own (⌘E); here the one key carries both meanings, because with a selection there is only one thing Find can sensibly mean.

Patterns can be named and kept in a pattern library (**Settings ▸ Favorites**) — for instance the recurring signatures `_FVH`, `$FPT` or `24 00 00 00`. The library lives in this browser; it can be exported and imported anywhere, and in a Chromium browser it can be synchronised through a folder so that several installations share it — including the macOS application, whose file format it is.

See also: [[topic:bookmarks|Bookmarks]], for marking an address that was found.
