/**
 * The maker of an SPI flash chip, from the first byte of its JEDEC id.
 *
 * That byte is the manufacturer code of JEDEC JEP106, so it names the vendor
 * even for a part the chip catalogue does not list. The two device bytes after
 * it are the vendor's own and say nothing across vendors. Only codes seen on
 * SPI flash are here, taken from the vendors the generated chip catalogue
 * groups and from flashrom's `flashchips.h`; a code with a continuation
 * prefix (`7F`…) is not read. A vendor that sells under a code it does not
 * own — XMC uses Micron's `20` — is named by the code's owner, never guessed.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/FlashVendors.swift#FlashVendors.name
 */
export function flashVendor(ofJedecID: number): string | undefined {
  return TABLE[(ofJedecID >>> 16) & 0xff];
}

/** The JEP106 first-byte codes seen on SPI flash, by code. */
const TABLE: Readonly<Record<number, string>> = {
  1: "AMD / Spansion", // 0x01
  4: "Fujitsu", // 0x04
  11: "XTX", // 0x0B
  14: "Zbit", // 0x0E
  28: "EON", // 0x1C
  31: "Atmel / Adesto", // 0x1F
  32: "Micron / ST", // 0x20
  55: "AMIC", // 0x37
  98: "Sanyo", // 0x62
  137: "Intel", // 0x89
  140: "ESMT", // 0x8C
  157: "ISSI / PMC", // 0x9D
  186: "Zetta", // 0xBA
  191: "SST / Microchip", // 0xBF
  194: "Macronix", // 0xC2
  200: "GigaDevice", // 0xC8
  239: "Winbond", // 0xEF
  248: "Fidelix", // 0xF8
};
