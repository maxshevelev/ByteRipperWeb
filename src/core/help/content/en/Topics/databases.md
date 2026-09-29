# The Online Catalogues

> Three public catalogues that give names to identifiers found in a dump. Without access to them the program is fully functional, but does not display the additional information they provide.

Part of what the tool panels display is not held in the file: it is a name the community has given to an identifier that the file carries. ByteRipper fetches three public catalogues over HTTPS from GitHub for this purpose and retains each for one day:

- **UEFI GUID names** — from the UEFITool project. They are what allows the [[topic:tool-uefi|UEFI panel]] to display "AmiBoardInfo" or "DxeCore" in place of a bare [[term:guid|GUID]].
- **CPU microcode** — from the CPUMicrocodes collection. It names the microcode updates the [[topic:tool-fit|FIT panel]] lists, by processor signature, revision and date, and it is the source **Add Microcode…** offers.
- **ME firmware database** — from the ME Analyzer project. It is what lets the [[topic:tool-me|ME panel]] say which known firmware release an image corresponds to.

## What is a measurement and what is a name

The tools keep the two apart:

- **The bytes belong to the file.** An address, a size, a version field, a checksum are all read from the image itself.
- **The name belongs to the catalogue.** It is an identification made by the community; it may be absent, and it may be incorrect.

A row reading "AmiBoardInfo · 0x7A0000 · 0x12C0" therefore states that the file holds a module at that address of that size, and that the catalogue records that GUID as being commonly called AmiBoardInfo.

## How old the copy is

A catalogue is kept in the browser's own cache, so a bench with no network still has yesterday's lists rather than none. What is held is shown with the date it was fetched, because yesterday's data must never be mistaken for today's:

- Younger than a day, and it is used without asking the network at all.
- Older, and it is used **at once** while the check runs behind it — a bench never waits on a name.
- A check that cannot be made keeps what is held, and says how old it is.

## Offline

No function of the program requires the network. Without a connection, or where the request is blocked, the tools display identifiers in place of names and report nothing further: no dialogs and no repeated attempts. Everything read from the bytes is unaffected.

The requests go to fixed addresses of these catalogues, and a request carries nothing out of the open file: the page downloads a catalogue whole and matches it against the dump locally.

Neither the bytes of the image nor the identifiers found in it are therefore transmitted. The dump does not leave the machine.

! Clearing this site's data clears the cached catalogues with it, along with the bookmarks and the settings. The next parse fetches them again where there is a network, and manages without where there is not.
