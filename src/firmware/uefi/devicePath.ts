import { decodeUtf8 } from "@/core/text/utf";
import { guidFromBytes, guidText } from "@/firmware/uefi/efiGuid";

/**
 * A UEFI device path in the text form of UEFI §10.6 —
 * `PciRoot(0x0)/Pci(0x1F,0x2)/Sata(0x0,0xFFFF,0x0)/HD(1,GPT,…)/\EFI\BOOT\BOOTX64.EFI`.
 *
 * The nodes a boot entry or a console variable is built from are spelled out; any
 * other node reads as `Path(type,subtype)`, which names it without claiming to know
 * its fields.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DevicePath.swift#DevicePath
 */

/**
 * The path `bytes` hold, exactly: nodes that fit one after another and end in an
 * end-of-path node at the last byte, at least one node before it. Nothing
 * otherwise — which is what lets a value be told for a path by its bytes alone.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DevicePath.swift#DevicePath.text
 */
export function devicePathText(bytes: Uint8Array): string | undefined {
  const instances: string[][] = [[]];
  let at = 0;
  while (at + 4 <= bytes.length) {
    const type = bytes[at] ?? 0;
    const subtype = bytes[at + 1] ?? 0;
    const length = (bytes[at + 2] ?? 0) | ((bytes[at + 3] ?? 0) << 8);
    if (length < 4 || at + length > bytes.length || !((type >= 1 && type <= 5) || type === 0x7f)) {
      return undefined;
    }
    const node = bytes.subarray(at, at + length);
    at += length;
    if (type === 0x7f) {
      if (subtype === 0xff) {
        if (at !== bytes.length || instances.some((one) => one.length === 0)) return undefined;
        return instances.map((one) => one.join("/")).join(",");
      }
      if (subtype !== 0x01) return undefined;
      instances.push([]);
    } else {
      (instances[instances.length - 1] as string[]).push(nodeText(type, subtype, node));
    }
  }
  return undefined;
}

// MARK: - Nodes

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DevicePath.swift#DevicePath.nodeText */
function nodeText(type: number, subtype: number, node: Uint8Array): string {
  const f = new Fields(node);
  const n = node.length;
  const key = type * 256 + subtype;
  switch (key) {
    // Hardware.
    case 0x0101:
      if (n >= 6) return `Pci(${hex(node[5] ?? 0)},${hex(node[4] ?? 0)})`;
      break;
    case 0x0102:
      if (n >= 5) return `PcCard(${hex(node[4] ?? 0)})`;
      break;
    case 0x0103:
      if (n >= 24) return `MemoryMapped(${hex(f.u32(4))},${hex(f.u64(8))},${hex(f.u64(16))})`;
      break;
    case 0x0104:
      if (n >= 20) return `VenHw(${f.guid(4)})`;
      break;
    case 0x0105:
      if (n >= 8) return `Ctrl(${hex(f.u32(4))})`;
      break;
    // ACPI.
    case 0x0201:
      if (n >= 12) return acpiText(f.u32(4), f.u32(8));
      break;
    case 0x0203:
      if (n >= 8) return `AcpiAdr(${hex(f.u32(4))})`;
      break;
    // Messaging.
    case 0x0301:
      if (n >= 8) return `Ata(${node[4]},${node[5]},${f.u16(6)})`;
      break;
    case 0x0302:
      if (n >= 8) return `Scsi(${hex(f.u16(4))},${hex(f.u16(6))})`;
      break;
    case 0x0305:
      if (n >= 6) return `USB(${hex(node[4] ?? 0)},${hex(node[5] ?? 0)})`;
      break;
    case 0x030a:
      if (n >= 20) return `VenMsg(${f.guid(4)})`;
      break;
    case 0x030b:
      if (n >= 37) {
        const address = [...node.subarray(4, 10)]
          .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
          .join("");
        return `MAC(${address},${hex(node[36] ?? 0)})`;
      }
      break;
    case 0x030c:
      if (n >= 12) return `IPv4(${[...node.subarray(8, 12)].join(".")})`;
      break;
    case 0x030d:
      return "IPv6()";
    case 0x030f:
      if (n >= 11) {
        return `UsbClass(${hex(f.u16(4))},${hex(f.u16(6))},${hex(node[8] ?? 0)},${hex(node[9] ?? 0)},${hex(node[10] ?? 0)})`;
      }
      break;
    case 0x0312:
      if (n >= 10) return `Sata(${hex(f.u16(4))},${hex(f.u16(6))},${hex(f.u16(8))})`;
      break;
    case 0x0317:
      if (n >= 16) {
        const eui = [...node.subarray(8, 16)]
          .reverse()
          .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
          .join("-");
        return `NVMe(${hex(f.u32(4))},${eui})`;
      }
      break;
    case 0x0318:
      return `Uri(${decodeUtf8(node.subarray(4))})`;
    case 0x031a:
      if (n >= 5) return `SD(${hex(node[4] ?? 0)})`;
      break;
    case 0x031d:
      if (n >= 5) return `eMMC(${hex(node[4] ?? 0)})`;
      break;
    // Media.
    case 0x0401:
      if (n >= 42) return hardDriveText(f, node);
      break;
    case 0x0402:
      if (n >= 24) return `CDROM(${hex(f.u32(4))},${hex(f.u64(8))},${hex(f.u64(16))})`;
      break;
    case 0x0403:
      if (n >= 20) return `VenMedia(${f.guid(4)})`;
      break;
    case 0x0404: {
      let text = "";
      for (let at = 4; at + 1 < n; at += 2) {
        const unit = (node[at] ?? 0) | ((node[at + 1] ?? 0) << 8);
        if (unit === 0) break;
        text += String.fromCharCode(unit);
      }
      return text;
    }
    case 0x0405:
      if (n >= 20) return `Media(${f.guid(4)})`;
      break;
    case 0x0406:
      if (n >= 20) return `FvFile(${f.guid(4)})`;
      break;
    case 0x0407:
      if (n >= 20) return `Fv(${f.guid(4)})`;
      break;
    case 0x0408:
      if (n >= 24) return `Offset(${hex(f.u64(8))},${hex(f.u64(16))})`;
      break;
    // BIOS boot specification.
    case 0x0501:
      if (n >= 8) {
        const types: Readonly<Record<number, string>> = {
          1: "Floppy",
          2: "HD",
          3: "CDROM",
          4: "PCMCIA",
          5: "USB",
          6: "Network",
        };
        const device = f.u16(4);
        let end = 8;
        while (end < n && node[end] !== 0) end++;
        const description = decodeUtf8(node.subarray(8, end));
        return `BBS(${types[device] ?? hex(device)},${description},${hex(f.u16(6))})`;
      }
      break;
  }
  return `Path(${type},${subtype})`;
}

/**
 * The ACPI node, by the device its EISA id names where the spec gives it a word of
 * its own.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DevicePath.swift#DevicePath.acpiText
 */
function acpiText(hid: number, uid: number): string {
  if ((hid & 0xffff) !== 0x41d0) return `Acpi(${hex(hid)},${hex(uid)})`;
  const pnp = hid >>> 16;
  switch (pnp) {
    case 0x0a03:
      return `PciRoot(${hex(uid)})`;
    case 0x0a08:
      return `PcieRoot(${hex(uid)})`;
    case 0x0604:
      return `Floppy(${hex(uid)})`;
    case 0x0301:
      return `Keyboard(${hex(uid)})`;
    case 0x0501:
      return `Serial(${hex(uid)})`;
    case 0x0401:
      return `ParallelPort(${hex(uid)})`;
    default:
      return `Acpi(PNP${pnp.toString(16).toUpperCase().padStart(4, "0")},${hex(uid)})`;
  }
}

/**
 * A partition: its number, the table it is in, its signature, where it starts and
 * how long it is, in sectors.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DevicePath.swift#DevicePath.hardDriveText
 */
function hardDriveText(f: Fields, node: Uint8Array): string {
  const number = f.u32(4);
  const start = hex(f.u64(8));
  const size = hex(f.u64(16));
  const signatureType = node[41] ?? 0;
  switch (signatureType) {
    case 1:
      return `HD(${number},MBR,0x${f.u32(24).toString(16).toUpperCase().padStart(8, "0")},${start},${size})`;
    case 2:
      return `HD(${number},GPT,${f.guid(24)},${start},${size})`;
    default:
      return `HD(${number},${hex(signatureType)},0,${start},${size})`;
  }
}

/** Little-endian fields of a node. */
class Fields {
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  u16(at: number): number {
    return (this.bytes[at] ?? 0) | ((this.bytes[at + 1] ?? 0) << 8);
  }
  u32(at: number): number {
    return (this.u16(at) | (this.u16(at + 2) << 16)) >>> 0;
  }
  u64(at: number): bigint {
    return BigInt(this.u32(at)) | (BigInt(this.u32(at + 4)) << 32n);
  }
  guid(at: number): string {
    return guidText(guidFromBytes(this.bytes, at));
  }
}

function hex(value: number | bigint): string {
  return `0x${value.toString(16).toUpperCase()}`;
}
