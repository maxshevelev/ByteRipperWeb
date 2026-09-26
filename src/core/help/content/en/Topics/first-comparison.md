# Your First Comparison

> Open the bad dump and a good one, and let the app show you where they disagree.

1. Open the dump you are diagnosing: the open button on the empty screen, **File ▸ Open…** in the toolbar's menu, or drag the file onto the workspace.
2. Open the second one the same way, or ask for it by name with **File ▸ Compare with…**. It lands in the other half — the app now has **File A** on the left and **File B** on the right.
3. Look at the colour. Every byte that differs between the two files is painted with the difference background. A long stretch of colour means a whole area differs; a scattering of single cells means a few bytes do.
4. Jump between the differences instead of scrolling: **⌥⌘→** goes to the next one, **⌥⌘←** to the previous one. The status bar reads how much of the image differs — `differing 0.4%` — which is a share of the longer file, counted per byte.
5. Read the offset of the current position in the status bar. On a firmware dump that offset is what tells you *which part* of the image you are looking at.
6. Turn on a tool panel — **UEFI Structure**, from the toolbar's Tools control — and the offsets stop being numbers: the panel names the region or the volume each address falls in.

## Reading the result

A comparison of two dumps of the same board usually looks like one of these:

- **Almost nothing differs.** A handful of bytes, all in one small area. That area is nearly always board-unique data — a MAC address, a serial number, a machine UUID, a saved setup variable. See [[topic:recipe-board-data|Keeping board-unique data]].
- **One large block differs and the rest matches.** Different firmware versions, or one region has been erased or corrupted. The [[topic:tool-uefi|UEFI panel]] will say which region it is.
- **Everything differs from some address on.** The two files are not the same size, or one of them was read with the wrong chip settings. Check the sizes in the status bars first.
- **The whole file differs.** Different chips, a wrong dump, or one file is compressed or encrypted. Compare the sizes and the first 16 bytes before going further.

## If the two files are different sizes

ByteRipper still compares them, from address zero, and marks the tail that only one file has. An 8 MB dump against a 16 MB dump is almost always a wrong read rather than a real difference — many programmers default to the wrong capacity.

See also: [[topic:navigation|Moving around]], [[topic:colors|What the colours mean]].
