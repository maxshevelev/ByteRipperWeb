# Finding Bytes and Text

> ⌘F. Hex bytes or text, over the whole dump, in the background.

@covers menu.edit.find
@covers shell.find-bar
@covers shell.search-results
@covers settings.favorites

The find bar searches the **active pane**, over its current contents — your unsaved edits included.

## Hex

Type a byte sequence: `DEADBEEF`, `DE AD BE EF`, `0xDE 0xAD`. Spaces are optional. After the search the field is rewritten in the dump's own form — uppercase pairs, one space between — so you can hold the pattern against the bytes on screen.

Hex search is always exact. Bytes have no upper and lower case, so the case toggle is not offered there at all.

## Text

Pick an encoding — ASCII, UTF-8, UTF-16 LE or UTF-16 BE — and type the string. It is encoded to bytes and matched exactly on those bytes. UTF-16 LE is the one that finds most strings in UEFI firmware; ASCII finds most strings in an option ROM or an EC image.

Case-insensitive matching is offered for text.

## While a search is running

Every match is filled in a quiet grey, everywhere in the file; the one you are standing on is a raised yellow bubble. **‹ ›** walk between them, and the bar keeps the count. Over a big dump the search runs in the background and can be cancelled; the matches appear as they are found.

**Search All** opens a results list you can click through, and marks the matches in the [[topic:minimap|minimap]] so you can see how they are spread over the image.

## Patterns you use often

**⌘F with bytes selected** loads the selection as the pattern — select some bytes in one dump, press ⌘F, and search for them in the other. Upstream keeps that on a key of its own (⌘E); here the one key carries both meanings, because with a selection there is only one thing Find can sensibly mean.

Patterns can be named and kept in a pattern library (**Settings ▸ Favorites**), which is where a bench keeps the signatures it looks for every day: `_FVH`, `$FPT`, `24 00 00 00` and so on. The library lives in this browser; it can be exported and imported anywhere, and in a Chromium browser it can be synced from a folder so a shop shares one — including with the macOS app, whose file format it is.

See also: [[topic:bookmarks|Bookmarks]] for marking what you found.
