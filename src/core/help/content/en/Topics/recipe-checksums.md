# Checking and Fixing Checksums

> A structure that carries its own checksum will be rejected if you edit it and leave the old value.

Many firmware structures carry a [[term:checksum|checksum]] over their own header or body. Change a byte inside one and the checksum no longer matches, and whatever reads that structure — the firmware itself, a flashing tool, a parser — will treat it as damaged.

## In the UEFI panel

The [[topic:tool-uefi|UEFI Structure]] panel checks the headers it reads as it reads them:

- A node whose checksum does not match gets a red mark on its row.
- Its detail pane shows the value that is there and the value that should be there.
- Right-click the node ▸ **Fix Checksum** writes the correct value. One write, one undo step, and the bytes are shown in red until you save.

## What a bad checksum actually tells you

- **You edited inside the structure**, which is expected while patching — fix it before you flash.
- **The dump is damaged**, if you have not edited anything. A checksum failure in a fresh dump is a sign of a bad read or a genuinely corrupted chip. Read the chip again before concluding anything.
- **The structure is not what the parser thinks it is.** A checksum failure in a region the panel is unsure about may mean the panel mis-identified it rather than that the bytes are wrong.

## What Fix Checksum cannot do

It corrects **checksums** — simple arithmetic sums and [[term:crc|CRCs]] that anyone can compute. It cannot touch **signatures**: a cryptographic signature over a region cannot be recomputed without the vendor's private key. If the area you edited is covered by [[term:boot-guard|Boot Guard]] or by an ME [[term:manifest|manifest]], no tool will make the platform accept your edit. See [[topic:bench-safety|Bench rules]].
