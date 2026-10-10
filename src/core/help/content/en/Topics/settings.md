# Settings

> **File ▸ Settings…** [[edition:in the toolbar's menu||in the menu]] — the choices the app remembers.

@covers settings.view
@covers settings.appearance
@covers settings.layout
@covers settings.comparison
@covers settings.editing
@covers settings.text-decoding
@covers settings.favorites
@covers settings.language
@covers menu.view.pane-layout
@covers menu.view.swap-panes

[[edition:There is no ⌘, here: in a browser that chord is the browser's own settings, so the app's live in its menu.||The macOS application opens its settings on ⌘,; this one has no key for it, and the settings open from **File ▸ Settings…**.]]

- **View** — how the program looks and which language it speaks, in three groups separated by rules. The first sets the monospaced font, its size and the row height of the hex view, and whether the app follows [[edition:the browser's||the system's]] light or dark setting or is forced one way; there is no Zoom In and Zoom Out as a setting: [[edition:the browser's page zoom is the zoom||the zoom is **View ▸ Zoom In**, **Zoom Out** and **Actual Size**]] ([[topic:navigation|Moving around]]). The second sets the arrangement of the panes and the word size of the hex view. The third chooses English, Русский or Deutsch, or whatever [[edition:the browser||the system]] reads: the change takes effect at once, and nothing is reloaded, because a reloaded [[edition:page||window]] would have to ask for every open dump again. Firmware terms remain in English in every language, those being the names datasheets and tools give them.
- **Comparison** — how differences are shown and counted.
- **Editing** — the confirmations raised before edits that change the length of the file ([[topic:editing|Editing Bytes]]). They are enabled by default, and this is the same setting as the "do not ask again" box in the dialogs themselves.
- **Text Decoding** — the encoding the text column decodes with.
- **Search Patterns** — the named search patterns, and the folder through which the library can be synchronised between installations ([[topic:search|Finding Bytes and Text]]).
- [[edition:||**Agent** — whether agents may connect to ByteRipper, and the text a client program is set up with ([[topic:agent|Working with an Agent]]). Only in the Windows application.]]

## Where the settings are kept

In **[[edition:this browser, on this machine||this installation, on this machine]]** — not in an account and not in a file that can be copied. The consequences are worth knowing:

- [[edition:Another browser, another machine or a private window||Another installation or another machine]] starts from the defaults.
- [[edition:Clearing site data for this page||Clearing the application's data]] clears the settings with it, along with the bookmarks and the pattern library.
- [[edition:There is no File Types tab: which application opens a `.bin` is the operating system's business, and a web page is not offered the job.||There is no File Types tab: which application opens a `.bin` is the operating system's business.]]

Settings apply to the workspace rather than to one pane: a font size chosen here applies to every open dump.
