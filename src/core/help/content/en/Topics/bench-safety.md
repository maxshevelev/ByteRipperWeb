# Constraints on Editing an Image

> The properties of a firmware image that limit what may be changed in it, and the confirmations the program raises accordingly.

A firmware image is not an arbitrary file. Its addresses are absolute, parts of it are verified by the platform before the firmware runs, and parts of it hold values belonging to one individual board. This page states those constraints and names the facilities of the program that relate to each.

## The length of the image is fixed

The capacity of a flash chip is fixed, and every address inside a firmware image is absolute: the descriptor states the boundaries of the regions, the [[term:fit|FIT]] names the address of each microcode component, a signature covers a fixed range. A byte inserted or deleted moves everything after it and invalidates all of these.

The program's default editing behaviour follows from this:

- Typing overwrites, and [[key:paste]] overwrites. Neither moves any following byte.
- Delete and Backspace fill with `0x00` rather than shortening the file, and **Edit ▸ Fill Selection with…** fills a selection with a chosen byte.
- The three operations that do change the length — switching insert mode on, a [[key:paste]] made in it, and **Edit ▸ Delete Bytes…** — each raise a confirmation before acting. The confirmations can be turned off in [[topic:settings|Settings ▸ Editing]].

The size of the file is reported in the status line under each pane. See [[topic:editing|Editing Bytes]].

## Parts of the image are verified by the platform

Current Intel platforms verify parts of the image before the processor executes firmware code, and the descriptor can withhold write access to whole regions.

- Where an image declares [[term:boot-guard|Boot Guard]] protected ranges, the UEFI panel's summary line reports how many. A signature over such a range cannot be recomputed without the manufacturer's private key.
- The [[term:me-region|ME region]] is verified by the engine itself before it starts. A region altered in place is not accepted by it; the state the tool reports for such a region is described in [[topic:recipe-me-check|Reading the ME Region Report]].
- The [[term:flash-master|flash master]] permissions in the descriptor govern writes **made through the chipset** — by a utility such as Intel's Flash Programming Tool, or by a manufacturer's firmware update. A programmer attached to the chip itself does not pass through the chipset and is not subject to them. This is set out in full in [[topic:flash-writes|Who Writes to the Flash]].

The distinction matters because the two are independent: a write that the descriptor permits may still produce an image the platform refuses at start-up, and a write made with a programmer bypasses the permissions without bypassing the verification.

## Parts of the image belong to one board

An image obtained from another board, or from the internet, carries the identifying data of that board — or, where the publisher removed it, carries empty fields in its place. Which parts of an image these are, and why two boards of one model differ, is set out in [[topic:recipe-board-data|Data Unique to a Board]].

## What the program keeps separate

- **The file on disk is not changed until it is saved.** Edited bytes are shown in red and exist only inside ByteRipper until [[key:save]] ([[topic:saving|Saving]]).
- **Every edit is one undo step**, including the large ones: joining files, filling, a write made by a tool panel, a fragment written back to its parent.
- **File ▸ Duplicate** copies the content of a pane into a free pane as a new unsaved document, which is how a file is edited without the original being the thing edited.
- **A comparison against the original file** reports every address at which the edited image differs from it.

! ByteRipper does not communicate with a programmer and does not write to hardware. It edits files; reading a chip and writing it back are done by the programmer.
