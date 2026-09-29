#!/usr/bin/env python3
"""Builds build/icon.ico — the Windows icon — from upstream's app icon.

Upstream renders its icon once, at 1024 px, and slices the asset catalog out
of that master with sips (Design/render-appicon.sh). The Windows icon is taken
from the same images: the sizes the catalog already has are copied as they
are, and the two a Windows icon wants that a Mac's does not (24 and 48) are
downsampled from the 1024 master with sips, the way upstream makes its own.
Every entry is stored as PNG, which Windows has read inside .ico since Vista.

Usage (macOS, from desktop/): python3 make-icon.py
The ByteRipper clone is ../../ByteRipper, or $BYTERIPPER_REPO.
"""
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path(os.environ.get("BYTERIPPER_REPO", HERE.parent.parent / "ByteRipper"))
CATALOG = REPO / "ByteRipperApp/Assets.xcassets/AppIcon.appiconset"
MASTER = CATALOG / "icon_512x512@2x.png"

# Size -> the catalog image that is exactly that size, or None to downsample.
SIZES = {
    16: "icon_16x16.png",
    24: None,
    32: "icon_32x32.png",
    48: None,
    64: "icon_32x32@2x.png",
    128: "icon_128x128.png",
    256: "icon_256x256.png",
}


def png_of(size: int, name: str | None, scratch: Path) -> bytes:
    if name is not None:
        return (CATALOG / name).read_bytes()
    out = scratch / f"{size}.png"
    subprocess.run(["sips", "-Z", str(size), "--out", str(out), str(MASTER)],
                   check=True, stdout=subprocess.DEVNULL)
    return out.read_bytes()


def main() -> None:
    if not MASTER.exists():
        sys.exit(f"no upstream icon at {CATALOG}")
    with tempfile.TemporaryDirectory() as tmp:
        images = [(size, png_of(size, name, Path(tmp))) for size, name in SIZES.items()]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries, payload = b"", b""
    for size, data in images:
        side = 0 if size >= 256 else size  # 0 means 256 in an ICONDIRENTRY
        entries += struct.pack("<BBBBHHII", side, side, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    target = HERE / "build" / "icon.ico"
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(header + entries + payload)
    print(f"wrote {target.relative_to(HERE)}: {', '.join(str(s) for s in SIZES)} px")


main()
