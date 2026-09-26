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
- **Editing** — the confirmations before length-changing edits ([[topic:editing|Editing]]). They are on by default; switching them off here is the same switch as the "do not ask again" box on the dialogs.
- **Text Decoding** — the encoding the text column decodes with.
- **Favorites** — the named search patterns, and the folder they can be synced from so a shop shares one pattern library ([[topic:search|Finding bytes]]).
- **Language** — English, Русский or Deutsch, or whatever the browser reads. Changing it takes effect at once: nothing is reloaded, because a reloaded page would have to ask for every open dump again.

## Where the settings are kept

In **this browser, on this machine** — not in an account and not in a file you can copy. The consequences are worth knowing:

- Another browser, another machine or a private window starts from the defaults.
- Clearing site data for this page clears the settings with it, along with the bookmarks and the pattern library.
- There is no File Types tab: which application opens a `.bin` is the operating system's business, and a web page is not offered the job.

Settings apply to the whole workspace rather than to one pane: the font size you pick applies to both dumps, which is deliberate — a dump zoomed in one pane and not in the other would be an invisible second preference.
