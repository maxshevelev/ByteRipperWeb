# Working with an Agent

> An agent — Claude Code, Claude Desktop or another program that speaks MCP — can be connected to ByteRipper. It then sees the files open in the program, reads their bytes and shows places in them, while the conversation with it goes on in its own window.

@covers settings.agent
@covers window.agent
@covers window.agent.details
@covers toolbar.agent
@covers window.agent.follow
@covers window.agent.tools
@covers menu.window.agent
@covers settings.agent.edits

[[edition:**This page is about the Windows application.** The agent service needs a connection that a page in a browser cannot open, so the browser edition has none; nothing below exists there.||]]

The agent works on the same windows as the person at the bench. When it is asked about "this" byte, it reads the position of the caret and the selection; when it refers to a place in the dump, it moves the view there and selects it. The two therefore point at the same bytes rather than describing addresses to each other in words.

## Switching the service on

The service is off after installation. It is switched on in **Settings ▸ Agent** with **Let agents connect to ByteRipper**. While it is on, the toolbar has a button for the Agent window, drawn as three joined points; the points are filled while an agent is connected. A connection counts as an agent once its program has sent its first message: one that connected and has said nothing is not counted.

The connection is local. ByteRipper opens a named pipe, `\\.\pipe\ByteRipper-agent-<user name>`, which a program of the same user account opens as it would a file; there is no network port. Where the pipe's name has to be different — a second copy run beside the first — the environment variable `BYTERIPPER_AGENT_SOCKET` names another.

The bytes an agent reads are, however, passed by the agent's own program to the model behind it. For Claude that is Anthropic's service. A dump that must not leave the workshop is not to be opened while an agent is connected.

## Connecting a program

In **Settings ▸ Agent** the menu **Configuration for:** chooses the program the agent runs in. The text that program needs is shown in full below the menu, with a line saying where it goes, and **Copy** puts it on the clipboard:

- **Claude Code** — a command for a terminal. Run once, it registers ByteRipper with Claude Code for every folder.
- **Claude Desktop** — a JSON block for Claude Desktop's configuration file, `%APPDATA%\Claude\claude_desktop_config.json`. Claude Desktop reads it when it starts.
- **Cursor** — the same JSON block, for `%USERPROFILE%\.cursor\mcp.json` (every project) or `.cursor/mcp.json` inside one project.
- **Other Client** — the parameters one by one: the name `byteripper`, the transport `stdio`, the command, its argument and the environment variable. This is what a client asks for in a form of its own.

A configuration file that already lists other servers takes the `byteripper` entry beside them, inside the same `mcpServers`.

Every form names ByteRipper's own executable and the script `relay.cjs` that lies beside it, and sets the environment variable `ELECTRON_RUN_AS_NODE=1`, which makes the executable run the script instead of opening the window. If ByteRipper is moved to another folder, or installed again in another one, the text is copied again.

If ByteRipper is not running when the agent's program starts, the script starts it. If the service is switched off, the agent's program reports that ByteRipper's agent service is not running.

## Why not over HTTP

Some programs, Claude Desktop among them, add a server reached over HTTP from their own settings, without a configuration file and without a restart. ByteRipper does not offer such a server, on purpose:

- A server over HTTP listens on a network port, and every program on the computer can reach it — web pages open in a browser included. It would need a password of its own, kept in the agent's configuration, and checks against requests from pages. The named pipe ByteRipper opens can be reached only by programs of the same user account; there is nothing to set up and nothing to leak.
- An agent reads dumps and, when allowed, changes them. Access to it is therefore no wider than access to the dumps themselves.
- The agent's program starts the script itself. The script starts ByteRipper when it is not running and says so when the service is switched off; a server over HTTP is simply not there in either case.

The price is the configuration step described above, made once per program, and a connection from the same computer only: an agent running on another computer cannot connect.

## What an agent can do

At present an agent can:

- list the open files, with their names, sizes and whether they have unsaved edits;
- read the position of the caret, the selection and the rows on screen;
- read bytes — as hex rows, as text, or as 16-, 32- and 64-bit numbers — including unsaved edits;
- show a place: bring its pane forward, scroll to it and select it;
- read the structure of a firmware image as **UEFI Structure** shows it — the tree, the fields of a node, the nodes holding an address — and search it by name, GUID or type; the fields of a node are the panel's details, the name the GUID catalogue gives a file included. It can also check every checksum of the image at once — a volume's, a file's, a microcode's, a PSP directory's — and list the wrong ones with the value each should have, as the panel's red marks do. This works whether or not the panel is open;
- read the FIT table as **FIT Table** shows it — its rows, what each points at, the rules it breaks — and the Intel ME firmware as **ME Analyzer** shows it: the summary and the decoded structure. This too works with the panels closed;
- list the NVRAM variables of a dump with their values, read as their types, and set the variables of two dumps side by side by name and GUID: which only one of them has, which differ and in which bytes. Two dumps of different boards or BIOS versions compare as well as two of one board, and a folder of dumps can be compared with one of them at once;
- set the files of the ME file systems (MFS and EFS) of two dumps side by side by their number in the volume and by content, not by address: which are the same, which differ and in how many bytes, which only one dump has. The volume moves its data to spread the wear on the chip, so in two dumps of one machine the same file can lie at different addresses; a byte comparison of the partition then shows moved data, while this comparison shows which files changed. The Integrity table at the end of a protected file is compared separately: it changes every time the engine writes the file again. A volume one of the dumps cannot be read in is named as not compared, and its files are not counted as missing;
- mark bytes while explaining them: a dashed outline in a colour of its own, with a short label; resting the pointer on the marked bytes shows the agent's note. A mark can name others it is about — a pointer and its target, a checksum and what it covers; those are listed after the note, under **Related Marks:**, by their number and label;
- open a file by its path without putting it on screen, and ask the same question of every dump in a folder at once — how many copies of a variable each holds, which address a structure starts at — getting the answers grouped by value. A file opened this way is only read; when there is something in it to show, the agent puts it in a free pane of the window — never over a file that is open there; with both panes taken it says so, and the person makes room;
- record findings: each a sentence and the place it is about, listed in the Agent window;
- compare two files byte by byte, as the comparison of two panes does — at the same addresses, without aligning shifted data. The answer is either a list of the stretches that differ, each with the part of the firmware it lies in (a region, a volume, a variable, an ME partition or file), or a summary over the regions, volumes and ME partitions that names the unchanged ones too. A folder of dumps can be compared with one of them at once;
- find a text or bytes in a file — as ASCII or UTF-16, in any case, with `??` for a byte that may be anything — including inside the compressed sections of a firmware image, which the file holds only compressed; each match with the part of the firmware it lies in;
- find who in a firmware image refers to an address or a GUID — the modules whose code holds it, in the file and inside compressed sections — listed by FFS file. An address is looked for as the processor sees the BIOS region below 4 GiB, as a file address and as an offset in the BIOS region; a match of four bytes in code can be chance, so each says which of these forms it is;
- judge the areas the parser cannot name — padding, unused and unknown areas of the flash map, raw files — by their bytes: empty, text, data or code, with a few of the strings in them. An area the flash map names MSDM, Password or Key is judged without its strings, and a search shows no bytes around a match in it;
- read the bytes of a node of **UEFI Structure**, a node inside a compressed section included, and open a stretch of a file or a node as a part over the file, as **Open Zone** does, so two blocks at different addresses are compared from their beginnings;
- show two files side by side as a pair — beside a file that is alone in the window, in the free pane — and step through their differences as the difference arrows of the window do;
- open a tool panel on a document, as the **Tools** menu does, and choose a node in the open **UEFI Structure** panel. The tree opens down to the node and the dump scrolls to its bytes.

Each place an agent shows, each panel it opens and each node it chooses is a step of the navigation history: **View ▸ Back** (**[[key:back]]**) returns to the place the view was at before ([[topic:navigation|Moving Around]]).

An agent cannot save a file, and changes one only when that is allowed (below). Addresses in its answers are given in hex, as in the dump.

## Letting an agent edit

**Let agents edit open files** in **Settings ▸ Agent** is off after installation, and is separate from the switch that lets agents connect. While it is off, an agent asked to change something says what it would change instead.

While it is on, an agent can:

- overwrite bytes in an open file. A write replaces as many bytes as it carries and never inserts or deletes; it can be made conditional on the bytes that are there now;
- copy a stretch of one of the window's two files over the same addresses in the other, as **Edit ▸ Copy to Other Pane** does with the selection. The bytes pass from file to file inside ByteRipper and not through the agent, so a whole region is copied at once; the answer says how many bytes actually changed. A copy past the end of the other file is refused;
- put a checksum right — a volume's, a file's, a microcode's or a PSP directory's in **UEFI Structure**, the table's in **FIT Table** — computed by the same code as the panels' **Fix Checksum**. In **UEFI Structure** the agent can put every wrong checksum right at once, as one undo step; a file that holds a volume is put right after the files inside it. A checksum inside a compressed section is not changed: the file holds those bytes compressed;
- add, update, replace and remove microcode in the FIT from the same online catalogue **FIT Table** offers, with the same checks: an update already in the table under another of its CPUIDs is refused, an update whose extended signature table serves a processor a row already serves takes that row's place, and a replacement that would leave two microcodes for one processor is refused naming the row to replace. The agent can also say which of the image's microcodes the catalogue has a newer revision for.

Each change is one step of the file's undo, named **Agent:** and what the agent said the change is, so **Edit ▸ Undo** (**[[key:undo]]**) takes it back. The changed bytes are red until the file is saved, like an edit made by hand, and the dump scrolls to them as a step of the navigation history. The file is saved only by the person. A file the agent opened by its path without a tab is never changed.

## The Agent window

**Window ▸ Agent** shows whether the service is running, and has four lists. While the service is switched on, the toolbar has a button for it between **?** and the pane arrangement; it opens the window as a panel over the panes, with a pill in the dock along the bottom edge as the help has, and closes it when it is up. Folding the panel (**Esc** or the pill) leaves the pill, so the window is one click away; ✕ on the pill closes it. The keyboard is then on the list of the page shown, and the arrow keys move through its rows; choosing another page moves the keyboard to that page's list.

The panel's header is the one every panel in the dock has: **⌄** folds the panel into its pill, and the header pulls it down into the pill. The columns of every list are made wider or narrower by dragging the boundary between their headings; a double-click on the boundary restores the original widths. The widths are kept after the program quits. On **Log** and **Tools** the details under the list [[topic:tools-overview|open in a large view]] as a tool panel's do: **Space** in the list, or the expand button in the corner of the details, shows them in a large card on the right of the window. While the card is open the arrow keys still move the selection in the list, and the card shows the row selected; **Space** or **Esc** closes it.

**Log** lists every request the agent has made: the time, the tool, the arguments as the agent wrote them, how long the answer took, its size and the result. A refused request is shown in red, with the reason the agent was given. The table shortens long arguments; the list under it shows the selected request whole: the time, the client, how long the answer took, its size in bytes, the full result and, under **Arguments**, the whole JSON the agent sent, one member to a line. Its text can be selected and copied. **Follow New Requests** below the log scrolls it to each new request as it arrives; while it is off, the log stays where it was left. The selected request stays selected as new ones arrive. **Clear Log** empties the list; the list is not kept after the program quits.

**Marks** lists the marks the agent has left in every open file: the label, the file, the bytes and the note; the marks a mark is about follow its note, after **Related Marks:**. A double-click on a row brings its file forward and selects its bytes, as a step of the navigation history. **Remove Mark** removes the selected rows, **Clear Marks** removes them all. A mark also goes when its file is closed or when the agent removes it.

**Findings** lists what the agent found and where: the sentence, the file, the bytes or the node. A double-click opens the file at that place — in the pane that already has it, or in a free pane. **Clear Findings** empties the list.

**Tools** lists every tool an agent is offered, in sections headed by where the tools come from — a part of ByteRipper, or a panel such as **UEFI Structure** — with each tool's name and kind: **Read** changes nothing, **On Screen** changes what the window shows (the view, a mark, a finding, a pane), **Edits a File** writes into an open file. Beside each, how it has been used since ByteRipper started: the calls, those **Not Answered**, the average time, the size of its answers and the last call. The list under it shows the selected tool as the agent is told about it: the **Description** and, under **Arguments**, the arguments it takes as a JSON schema, both in English, as the agent reads them. **Reset Statistics** sets the counts back to zero; they are not kept after the program quits.

## Files outside the open windows

An agent reads a file by its path with the rights of the user account ByteRipper runs under; Windows asks nothing, and a file the account cannot read is reported to the agent as one it could not open.

## When the service does not start

The status line in **Settings ▸ Agent** gives the reason. The usual one is a second copy of ByteRipper already running with the service switched on: only one copy can serve agents at a time, and the second leaves the first one's connection alone.
