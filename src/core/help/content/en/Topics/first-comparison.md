# Your First Comparison

> Open two dumps and the program reports the addresses at which they differ.

1. Open the dump to be examined: the open button on the empty screen, **File ▸ Open…** in the toolbar's menu, or drag the file onto the workspace.
2. Open the second file with **File ▸ Compare with…**, or drag it onto the workspace. It lands in the other file pane, and the comparison starts automatically. (**File ▸ Open…** would replace the first file.)
3. Observe the colour of the bytes. Every byte that differs between the two files is painted **orange**. A long stretch of colour means a whole area differs; isolated cells mean individual bytes differ.
4. Move between the differences: **[[key:nextDifference]]** to the next one, **[[key:previousDifference]]** to the previous one. The status bar reports the proportion of the image that differs — `differing 0.4%` — counted per byte against the length of the longer file.
5. The status bar reports the address of the current caret position.
6. Turn on a tool — **UEFI Structure**, from the toolbar's Tools control. It decodes the structure of the file and presents the dump as a tree of named regions and volumes. **Show the node under the caret in the tree** in the panel's header opens the node of that tree which the caret's address falls in.

## If the two files are different sizes

ByteRipper compares them from address zero regardless, and marks the tail of the longer file as differing bytes.

See also: [[topic:navigation|Moving Around]], [[topic:colors|What the Colours Mean]].
