import { describe, expect, it } from "vitest";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { MAP_DATA_VERSIONS } from "@/firmware/mapData/mapDataVersions";
import { fnv1a32, MapDataError, MapFile } from "@/firmware/mapData/mapFile";
import {
  cpuStrapMapForME,
  decodeLayoutMaps,
  layoutMapFailure,
  mipCPUStraps,
  mipStrapContainers,
  mipStrapMapForME,
  sphyNvarMapForME,
  sphyNvarReadings,
} from "@/firmware/me/configuration/layoutMaps";

/**
 * CSME 18's three layouts — the MIP containers, the CPU strap message and the SPHY nvar
 * — as the binary states them, and the readers that take each out of a FITC partition's
 * payload.
 */

function present<T>(value: T | undefined, what = "value"): T {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
}

const le16 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const le32 = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

/** A FITC payload — record count, one record at 0x10 — whose value is `value`. */
function fitcRecord(fileID: number, value: Uint8Array): Uint8Array {
  return new Uint8Array([
    ...le32(1), // one record
    ...le32(fileID),
    ...le32(0x10), // value at 4 + 12
    ...le16(value.length), // size
    ...le16(0), // flags
    ...value,
  ]);
}

/** The smip nvar's File ID. */
const SMIP_FILE_ID = 0x1002_3e00;

/** A MIP table of the given blocks, contiguous from the end of the header. */
function mipTable(blocks: readonly { type: number; data: Uint8Array }[]): Uint8Array {
  const headerSize = 4 + blocks.length * 8;
  const size = headerSize + blocks.reduce((sum, block) => sum + block.data.length, 0);
  const table: number[] = [...le16(blocks.length), ...le16(size)];
  let offset = headerSize;
  for (const block of blocks) {
    table.push(...le16(block.type), ...le16(offset), ...le16(block.data.length), ...le16(0));
    offset += block.data.length;
  }
  for (const block of blocks) table.push(...block.data);
  return new Uint8Array(table);
}

const byName = (readings: readonly { name: string; value: number }[]) =>
  new Map(readings.map((one) => [one.name, one.value]));

const bundled = () => fixtureBytes("src/firmware/mapData/data/LayoutMaps.bin").slice();
const expected = MAP_DATA_VERSIONS.layout.version;

function failureOf(read: () => unknown) {
  try {
    read();
  } catch (error) {
    if (error instanceof MapDataError) return error.failure;
    throw error;
  }
  throw new Error("expected a MapDataError");
}

/** FNV-1a with the checksum field zeroed, as the compiler writes it. */
function resigned(bytes: Uint8Array): Uint8Array {
  bytes.fill(0, 20, 24);
  new DataView(bytes.buffer).setUint32(20, fnv1a32(bytes), true);
  return bytes;
}

/**
 * The binary CSME 18 layouts: the MIP containers, the CPU strap message and the SPHY
 * nvar, and what the reader refuses.
 */
describe("the layout map file", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/LayoutMapDataTests.swift#LayoutMapDataTests.testTheResourceLoadsWithTheVersionTheCodeWasMarkedWith
  it("loads with the version the code was marked with", () => {
    expect(layoutMapFailure()).toBeUndefined();
    const mip = mipStrapMapForME(18);
    expect(mip?.containers.map((container) => container.fields.length)).toEqual([
      253, 5, 249, 133, 515, 253, 42,
    ]);
    expect(cpuStrapMapForME(18)?.fields.length).toBe(35);
    const sphy = sphyNvarMapForME(18);
    expect(sphy?.anchors.length).toBe(7);
    expect(sphy?.fields.length).toBe(522);
  });

  // The containers keep the block type and length the MIP descriptor uses to choose
  // them, and the CPU message keeps its byte offset and bit.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/LayoutMapDataTests.swift#LayoutMapDataTests.testTheLayoutsKeepTheirSelectionKeys
  it("keeps the layouts' selection keys", () => {
    const mip = present(mipStrapMapForME(18));
    const ioe = mip.containers.filter((container) => container.name === "IOE");
    expect(ioe.map((container) => container.blockLength)).toEqual([0x3c, 0xd0]);
    expect(new Set(ioe.map((container) => container.blockType))).toEqual(new Set([4]));
    const pmc = present(mip.containers.find((container) => container.name === "PMC SoC"));
    expect(pmc.blockType).toBe(1);
    expect(pmc.blockLength).toBe(0x58);
    expect(pmc.length).toBe(0x48);

    const cpu = present(cpuStrapMapForME(18));
    const cores = present(cpu.fields.find((field) => field.name.includes("ATOM_CORES")));
    expect(cores.offset).toBeGreaterThanOrEqual(0);
    expect(cores.bit).toBeGreaterThanOrEqual(0);
    expect(cpu.fields.find((field) => field.options !== undefined)).toBeDefined();

    const sphy = present(sphyNvarMapForME(18));
    const anchor = present(sphy.anchors.find((one) => one.name === "Sub_Section_Entry2_Header_8"));
    expect(anchor.value).toBe(5);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/LayoutMapDataTests.swift#LayoutMapDataTests.testAStaleVersionIsRefusedBeforeAnySectionIsRead
  it("refuses a stale version before any section is read", () => {
    const data = bundled();
    new DataView(data.buffer).setUint32(8, expected + 1, true);
    expect(failureOf(() => decodeLayoutMaps(new MapFile(data, expected)))).toEqual({
      kind: "versionMismatch",
      file: expected + 1,
      code: expected,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/LayoutMapDataTests.swift#LayoutMapDataTests.testAnotherFormatAndKindAreRefused
  it("refuses another format and another kind", () => {
    const data = bundled();
    data[4] = 2;
    expect(failureOf(() => new MapFile(data, expected))).toEqual({
      kind: "unsupportedFormat",
      format: 2,
    });
    const kind = bundled();
    kind[12] = 1;
    expect(failureOf(() => decodeLayoutMaps(new MapFile(resigned(kind), expected)))).toEqual({
      kind: "wrongKind",
      mapKind: 1,
    });
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/LayoutMapDataTests.swift#LayoutMapDataTests.testAnEditedFileFailsItsChecksum
  it("fails the checksum of an edited file", () => {
    const data = bundled();
    data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
    expect(failureOf(() => new MapFile(data, expected)).kind).toBe("corrupt");
  });
});

/**
 * The MIP table's non-CPU strap containers: the tool's layouts, and reading CSME, PMC
 * IOE and IOE out of a FITC partition's payload.
 */
describe("the MIP strap map", () => {
  /** A FITC payload whose one record is a MIP table of the given blocks. */
  const fitcPayload = (blocks: readonly { type: number; data: Uint8Array }[]) =>
    fitcRecord(SMIP_FILE_ID, mipTable(blocks));

  // The map holds the three containers — CSME at block type 0, PMC IOE at 2, IOE at 4 —
  // and both IOE layouts, chosen by the block's length.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MIPStrapMapTests.swift#MIPStrapMapTests.testTheMapIsTheToolsContainers
  it("is the tool's containers", () => {
    const map = present(mipStrapMapForME(18));
    expect(map.containers.map((container) => container.name)).toEqual([
      "PMC SoC",
      "CSME",
      "PMC IOE",
      "IOE",
      "IOE",
      "PMC SOC 2",
      "CPU 2",
    ]);
    expect(map.containers.map((container) => container.blockType)).toEqual([1, 0, 2, 4, 4, 3, 3]);
    expect(map.containers.map((container) => container.blockLength)).toEqual([
      0x58, 0x8, 0x40, 0x3c, 0xd0, 0x60, 0x60,
    ]);
    expect(map.containers.map((container) => container.offset)).toEqual([0, 0, 0, 0, 0, 0, 0x48]);
    expect(map.containers.map((container) => container.length)).toEqual([
      0x48, 0x8, 0x40, 0x3c, 0xd0, 0x48, 0x18,
    ]);
    expect(map.containers.map((container) => container.fields.length)).toEqual([
      253, 5, 249, 133, 515, 253, 42,
    ]);
    // The PMC SoC block also carries the CPU message header and message, whose fields
    // are the CPU map's, not this one's.
    expect(map.containers[0]?.fields.some((field) => field.name.startsWith("CPU_smip_"))).toBe(
      false
    );
    const ioEP = present(
      map.containers[4]?.fields.find((field) => field.name === "IOE_smip_Strap_IOEP_PCIED_RPCFG")
    );
    expect(ioEP.bitOffset, "a field may start at any bit of the block").toBe(1);
    expect(ioEP.count).toBe(3);
    const csme = present(
      map.containers[1]?.fields.find(
        (field) => field.name === "CSME_smip_Strap_CSME_Early_USB_DbC_ME_Boot_Stall_Enable"
      )
    );
    expect(csme.bitOffset).toBe(48);
    expect(csme.label).toBe("Enable early USB2 DbC connection");
    expect(csme.options).toEqual(
      new Map([
        [0, "No"],
        [1, "Yes"],
      ])
    );
    expect(mipStrapMapForME(16)).toBeUndefined();
  });

  // The containers of the dump's table: CSME's five fields, PMC IOE's and IOE's read
  // from their blocks, the IOE layout picked by the block length.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MIPStrapMapTests.swift#MIPStrapMapTests.testReadsTheContainersOfTheMIPTable
  it("reads the containers of the MIP table", () => {
    const blocks = [
      { type: 1, data: new Uint8Array(0x58) },
      { type: 2, data: new Uint8Array(0x40) },
      { type: 4, data: new Uint8Array(0xd0) },
      { type: 0, data: new Uint8Array(0x8) },
    ] as const;
    blocks[0].data[0] = 0x01; // PMC SoC: CPWRG_STCH_WTDIS
    blocks[1].data[0] = 0x01; // PMC IOE: CPWRG_STCH_WTDIS
    blocks[2].data[0] = 0x02; // IOE: RPCFG = 1 (bits 1–3)
    blocks[3].data[6] = 0x01; // CSME: Early USB DbC at bit 48
    const payload = fitcPayload(blocks);
    const map = present(mipStrapMapForME(18));
    const containers = present(mipStrapContainers(payload, map));
    expect(containers.map((container) => container.name)).toEqual([
      "PMC SoC",
      "CSME",
      "PMC IOE",
      "IOE",
    ]);
    const [soc, csme, pmc, ioe] = [0, 1, 2, 3].map((index) => present(containers[index]));
    if (soc === undefined || csme === undefined || pmc === undefined || ioe === undefined) {
      throw new Error("four containers");
    }

    expect(byName(soc.readings).get("PMC_SoC_smip_Strap_CPWRG_STCH_WTDIS")).toBe(1);
    expect(soc.length).toBe(0x48);

    const csmeValues = byName(csme.readings);
    expect(csmeValues.get("CSME_smip_Strap_CSME_Early_USB_DbC_ME_Boot_Stall_Enable")).toBe(1);
    expect(csmeValues.get("CSME_smip_Strap_CSME_DAM_EN")).toBe(0);

    expect(byName(pmc.readings).get("PMC_IOE_smip_Strap_pmc_ioem_smip_CPWRG_STCH_WTDIS")).toBe(1);
    expect(pmc.length).toBe(0x40);

    const ioeValues = byName(ioe.readings);
    expect(ioeValues.get("IOE_smip_Strap_IOEP_PCIED_RPCFG")).toBe(1);
    expect(ioeValues.get("IOE_smip_Strap_IOEP_PCIED_LNREV")).toBe(0);
    expect(ioe.length).toBe(0xd0);
  });

  // The five-block table's `PmcAndCpu_2` block (type 3): PMC SOC 2 from the block's
  // first byte, CPU 2 from its 0x48. No image at hand has one; the shape is the tool's
  // struct defaults and the two documents' extents.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MIPStrapMapTests.swift#MIPStrapMapTests.testReadsPmcAndCpu2OfAFiveBlockTable
  it("reads PMC SOC 2 and CPU 2 of a five-block table", () => {
    const blocks = [
      { type: 4, data: new Uint8Array(0xd0) },
      { type: 0, data: new Uint8Array(0x8) },
      { type: 3, data: new Uint8Array(0x60) },
    ] as const;
    blocks[2].data[0] = 0x01; // PMC SOC 2: CPWRG_STCH_WTDIS
    blocks[2].data[0x48 + 4] = 0x01; // CPU 2: SMT_Disable
    const payload = fitcPayload(blocks);
    const map = present(mipStrapMapForME(18));
    const containers = present(mipStrapContainers(payload, map));
    expect(containers.map((container) => container.name)).toEqual([
      "CSME",
      "IOE",
      "PMC SOC 2",
      "CPU 2",
    ]);
    const soc2 = byName(present(containers[2]).readings);
    expect(soc2.get("PMC_SOC_2_smip_Strap_pmc_soc_smip2_CPWRG_STCH_WTDIS")).toBe(1);
    const cpu2 = present(containers[3]);
    expect(byName(cpu2.readings).get("CPU_2_smip_Strap_CPU2_SMT_Disable")).toBe(1);
    expect(cpu2.length).toBe(0x18);
  });

  // A 0x3C IOE block is MTL-M's layout, not the 0xD0 one: the block's length is what
  // chooses between them.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MIPStrapMapTests.swift#MIPStrapMapTests.testTheIOELayoutIsChosenByTheBlockLength
  it("chooses the IOE layout by the block length", () => {
    const blocks = [
      { type: 4, data: new Uint8Array(0x3c) },
      { type: 0, data: new Uint8Array(0x8) },
    ] as const;
    blocks[0].data[0] = 0x01;
    const payload = fitcPayload(blocks);
    const map = present(mipStrapMapForME(18));
    const containers = present(mipStrapContainers(payload, map));
    const ioe = present(containers.find((container) => container.name === "IOE"));
    expect(ioe.length).toBe(0x3c);
    expect(ioe.readings[0]?.name).toBe("IOE_smip_Strap_IOEM_TCSS_XHCI_XHC_PORT1_OWNERSHIP_STRAP");
    expect(ioe.readings[0]?.value).toBe(1);
  });

  // A payload with no MIP table answers nothing.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/MIPStrapMapTests.swift#MIPStrapMapTests.testAPayloadWithoutAMIPTableAnswersNothing
  it("answers nothing for a payload without a MIP table", () => {
    const map = present(mipStrapMapForME(18));
    expect(mipStrapContainers(new Uint8Array(0x40).fill(0xff), map)).toBeUndefined();
  });
});

/**
 * CSME 18's CPU strap message: the tool's `CPU_smip` layout, and reading the message out
 * of the FITC partition's MIP table.
 */
describe("the CPU strap map", () => {
  /**
   * A FITC payload — record count, one record — whose record value is a MIP table of
   * four contiguous blocks, the first carrying the CPU header and the message. The
   * blocks after it are padding of the sizes the dump has.
   */
  function fitcPayload(message: readonly number[]): Uint8Array {
    const block1 = new Uint8Array(0x58);
    block1.set([0x00, 0x00, 0x00, 0x03], 0x48);
    block1.set(message, 0x4c);
    const table = mipTable([
      { type: 1, data: block1 },
      { type: 2, data: new Uint8Array(0x40) },
      { type: 4, data: new Uint8Array(0xd0) },
      { type: 0, data: new Uint8Array(8) },
    ]);
    expect(table.length).toBe(4 + 4 * 8 + 0x58 + 0x40 + 0xd0 + 8);
    return fitcRecord(SMIP_FILE_ID, table);
  }

  // The map is the tool's own: 35 fields, its labels and option words.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPUStrapMapTests.swift#CPUStrapMapTests.testTheMapIsTheToolsOwnCPULayout
  it("is the tool's own CPU layout", () => {
    const map = present(cpuStrapMapForME(18));
    expect(map.fields.length).toBe(35);
    const smt = present(
      map.fields.find((field) => field.name === "CPU_smip_Strap_CPU_SMT_Disable")
    );
    expect(smt.offset).toBe(0);
    expect(smt.bit).toBe(0);
    expect(smt.count).toBe(1);
    expect(smt.label).toBe("Disable Hyperthreading");
    expect(smt.section).toBe("CpuStraps");
    expect(smt.options).toEqual(
      new Map([
        [0, "No"],
        [1, "Yes"],
      ])
    );
    const atoms = present(
      map.fields.find((field) => field.name === "CPU_smip_Strap_CPU_NUM_OF_SOC_ATOM_CORES")
    );
    expect(atoms.offset).toBe(0);
    expect(atoms.bit).toBe(22);
    expect(atoms.count).toBe(3);
    expect(atoms.options).toEqual(
      new Map([
        [0, "Disable All Cores"],
        [1, "1 Core Active"],
        [2, "2 Cores Active"],
      ])
    );
    // The older generations keep their message in the descriptor, not here.
    expect(cpuStrapMapForME(16)).toBeUndefined();
  });

  // The MIP table of the CSME 18 dump at hand: four blocks, the CPU message header at
  // 0x48 of the first and the three words at 0x4C, its CRC-16 (CCITT-FALSE over the last
  // two words, field zeroed) matching.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPUStrapMapTests.swift#CPUStrapMapTests.testReadsTheDumpsMIPTable
  it("reads the dump's MIP table", () => {
    const payload = fitcPayload([
      0x00, 0x10, 0x80, 0x00, 0x00, 0x20, 0x00, 0x04, 0x00, 0x00, 0xce, 0xd6,
    ]);
    const map = present(cpuStrapMapForME(18));
    const straps = present(mipCPUStraps(payload, map));
    expect(straps.messageLengthWords).toBe(3);
    expect(straps.crcStored).toBe(0xd6ce);
    expect(straps.crcValid).toBe(true);
    const values = byName(straps.readings);
    expect(values.get("CPU_smip_Strap_CPU_SMT_Disable")).toBe(0);
    expect(values.get("CPU_smip_Strap_CPU_Num_Of_Big_Cores")).toBe(0);
    expect(values.get("CPU_smip_Strap_CPU_BIST")).toBe(0);
    expect(values.get("CPU_smip_Strap_CPU_FlexRatio")).toBe(0);
    expect(values.get("CPU_smip_Strap_CPU_Fast_wakeup")).toBe(1);
    expect(values.get("CPU_smip_Strap_CPU_NUM_OF_SOC_ATOM_CORES")).toBe(2);
    expect(values.get("CPU_smip_Strap_CPU_IA_VR_ADDR")).toBe(0);
    expect(values.get("CPU_smip_Strap_CPU_GT_VR_ADDR")).toBe(1);
    expect(values.get("CPU_smip_Strap_CPU_SA_VR_ADDR")).toBe(2);
  });

  // A payload with no MIP table, or a message whose CRC disagrees, is not read as
  // straps: the CRC is what says the placement is aligned.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/CPUStrapMapTests.swift#CPUStrapMapTests.testAPayloadWithoutAMIPTableAnswersNothing
  it("answers nothing for a payload without a MIP table", () => {
    const map = present(cpuStrapMapForME(18));
    expect(mipCPUStraps(new Uint8Array(0x40).fill(0xff), map)).toBeUndefined();
    const payload = fitcPayload(new Array(12).fill(0x11));
    const straps = present(mipCPUStraps(payload, map));
    expect(
      straps.crcValid,
      "the values are still the image's, the CRC says they are not aligned"
    ).toBe(false);
    payload[0] = 0;
    expect(mipCPUStraps(payload, map)).toBeUndefined();
  });
});

/**
 * The SPHY OEM configuration nvar: the tool's `SphyNvar` layout, its anchors, and
 * reading `phy_oem_cfg` out of a FITC partition's payload.
 */
describe("the SPHY nvar map", () => {
  // The map is the MTL layout the dump verifies — 522 fields — with the common header
  // and the one variant-discriminating field as anchors.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SphyNvarMapTests.swift#SphyNvarMapTests.testTheMapIsTheMTLLayout
  it("is the MTL layout", () => {
    const map = present(sphyNvarMapForME(18));
    expect(map.fields.length).toBe(522);
    expect(map.anchors.length).toBe(7);
    const header = present(
      map.anchors.find((anchor) => anchor.name === "SPHY_OEM_NVAR_Common_Header_1")
    );
    expect(header.bitOffset).toBe(0);
    expect(header.count).toBe(32);
    expect(header.value).toBe(3);
    const variant = present(
      map.anchors.find((anchor) => anchor.name === "Sub_Section_Entry2_Header_8")
    );
    expect(variant.value, "the 542-field variant states 0x19 here").toBe(5);
    expect(sphyNvarMapForME(16)).toBeUndefined();
  });

  // The dump's own nvar — its first bytes and the discriminator below — reads through
  // the layout; another variant's anchor makes it answer nothing.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/SphyNvarMapTests.swift#SphyNvarMapTests.testReadsTheDumpsNvarAndRefusesAnotherVariant
  it("reads the dump's nvar and refuses another variant", () => {
    const nvar = new Uint8Array(0x431);
    nvar.set([0x03, 0x00, 0x00, 0x00], 0);
    nvar.set([0x05, 0x00], 4);
    nvar.set([0x03, 0x00], 6);
    nvar.set([0xff, 0xff], 8);
    nvar[12] = 0x03;
    nvar[54] = 0x05; // Sub_Section_Entry2_Header_8
    const map = present(sphyNvarMapForME(18));

    const readings = present(sphyNvarReadings(fitcRecord(0x1001_f200, nvar), map));
    expect(readings.length).toBe(522);
    const values = byName(readings);
    expect(values.get("SPHY_OEM_NVAR_Common_Header_1")).toBe(3);
    expect(values.get("SPHY_OEM_NVAR_Common_Header_2")).toBe(5);
    expect(values.get("SPHY_OEM_NVAR_Common_Header_4")).toBe(0xffff);
    expect(values.get("Sub_Section_Entry2_Header_8")).toBe(5);

    // The other variant's discriminator: not this layout.
    const other = nvar.slice();
    other[54] = 0x19;
    expect(sphyNvarReadings(fitcRecord(0x1001_f200, other), map)).toBeUndefined();
    // No such record at all.
    expect(sphyNvarReadings(fitcRecord(0x1002_0000, nvar), map)).toBeUndefined();
  });
});
