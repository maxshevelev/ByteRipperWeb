# Settings

> **File ▸ Settings…** in the toolbar's menu — the choices the app remembers.

@covers settings.appearance
@covers settings.layout
@covers settings.comparison
@covers settings.editing
@covers settings.text-decoding
@covers settings.favorites
@covers settings.language
@covers menu.view.pane-layout
@covers menu.view.swap-panes

There is no ⌘, here: in a browser that chord is the browser's own settings, so the app's live in its menu.

- **Appearance** — the monospaced font, its size and the row height for the hex view, and whether the app follows the browser's light or dark setting or is forced one way. There is no Zoom In and Zoom Out: the browser's page zoom is the zoom ([[topic:navigation|Moving around]]).
- **Layout** — how the panes are arranged.
- **Comparison** — how differences are shown and counted.
- **Editing** — the confirmations raised before edits that change the length of the file ([[topic:editing|Editing Bytes]]). They are enabled by default, and this is the same setting as the "do not ask again" box in the dialogs themselves.
- **Text Decoding** — the encoding the text column decodes with.
- **Search Patterns** — the named search patterns, and the folder through which the library can be synchronised between installations ([[topic:search|Finding Bytes and Text]]).
- **Language** — English, Русский or Deutsch, or whatever the browser reads. The change takes effect at once: nothing is reloaded, because a reloaded page would have to ask for every open dump again. Firmware terms remain in English in every language, those being the names datasheets and tools give them.

## Where the settings are kept

In **this browser, on this machine** — not in an account and not in a file that can be copied. The consequences are worth knowing:

- Another browser, another machine or a private window starts from the defaults.
- Clearing site data for this page clears the settings with it, along with the bookmarks and the pattern library.
- There is no File Types tab: which application opens a `.bin` is the operating system's business, and a web page is not offered the job.

Settings apply to the workspace rather than to one pane: a font size chosen here applies to every open dump.
