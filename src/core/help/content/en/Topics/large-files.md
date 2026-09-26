# Large Dumps

> Nothing is loaded into memory whole, so a big image opens as fast as a small one.

@covers core.storage.chunked
@covers worker.progress

ByteRipper reads a file in blocks and keeps only what it is showing, plus a bounded cache. A 32 MB SPI dump and a 2 GB image open the same way: immediately, with the first rows on screen before the rest of the file has been touched. A browser hands a page a file as something to read pieces of, which is exactly what this needs.

What follows from that:

- **Opening is instant**, whatever the size. If an open is slow, the file is on a slow disk or a network share, not too big.
- **Editing does not rewrite the file.** Your changes are held apart from the file until you save — which is why the changed bytes are shown in red until then.
- **Whole-file work is done in the background**, in a worker of its own. A full comparison, a search over the whole dump, a firmware parse: the workspace stays usable and a progress line appears at the bottom of the pane. It can be cancelled.
- **The visible comparison is immediate.** What you can see is compared as you scroll, even while the full count of differences is still being worked out.

! **Saving a very large file is the one place size is felt.** Writing back in place streams the dump past the browser a block at a time and is no harder than a small one; a *download* has to be built as one object first, and a few hundred megabytes is where a browser tab starts to refuse. See [[topic:saving|Saving]] for which of the two this browser does.

For a bench that means the file size is not a reason to choose a different tool. A full 16 MB SPI dump with an ME region, the joined dumps of two chips at 64 MB, an eMMC extract — all of them are ordinary.

See also: [[topic:minimap|The minimap]], which is how you see the shape of a big file at once.
