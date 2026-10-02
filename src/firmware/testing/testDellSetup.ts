import { BinaryWriter } from "@/firmware/testing/testImage";
import { BINDS_VARIABLE, DELL_OPCODE_GUID } from "@/firmware/uefi/dellSetupForms";
import { type EFIGUID, guid } from "@/firmware/uefi/efiGuid";

/**
 * A driver's HII, built byte for byte: string packages and an IFR form package, as
 * Dell's Setup driver carries them. Ported from `DellSetupFormsTests.swift`'s
 * `TestDellSetup`, in a fixture module because the tree's tests read it too.
 */

/**
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DvarParserTests.swift#DvarParserTests.namespace
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.namespace
 */
export const DELL_NAMESPACE = guid("417ACEE0-6FA9-4A82-99D7-F9B1DD271E48");

/**
 * A string package: the header, the language tag, the strings as UCS-2 blocks from
 * id 1, the end block.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.strings
 */
export function hiiStrings(language: string, texts: readonly string[]): number[] {
  const blocks: number[] = [];
  for (const text of texts) {
    blocks.push(0x14);
    for (let index = 0; index < text.length; index++) {
      const unit = text.charCodeAt(index);
      blocks.push(unit & 0xff, unit >> 8);
    }
    blocks.push(0, 0);
  }
  blocks.push(0x00);
  const headerSize = 46 + language.length + 1;
  return [
    ...new BinaryWriter()
      .u24(headerSize + blocks.length)
      .u8(0x04)
      .u32(headerSize)
      .u32(headerSize)
      .raw(new Array<number>(32).fill(0))
      .u16(1)
      .raw([...new TextEncoder().encode(language), 0])
      .raw(blocks).bytes,
  ];
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.op */
export function ifrOp(
  code: number,
  options: { scope?: boolean; body?: ArrayLike<number> } = {}
): number[] {
  const body = Array.from(options.body ?? []);
  return [code, (2 + body.length) | (options.scope === true ? 0x80 : 0), ...body];
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.end */
export const IFR_END: readonly number[] = ifrOp(0x29);

/**
 * A question: prompt, help, question id, variable store and offset, flags, then what
 * its kind adds; scoped when it has children.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.question
 */
export function ifrQuestion(
  code: number,
  options: {
    readonly prompt: number;
    readonly help?: number;
    readonly extra?: readonly number[];
    readonly children?: readonly (readonly number[])[];
  }
): number[] {
  const body = new BinaryWriter()
    .u16(options.prompt)
    .u16(options.help ?? 0)
    .u16(1)
    .u16(0x1000)
    .u16(0)
    .u8(0)
    .raw(options.extra ?? [0]).bytes;
  const children = options.children ?? [];
  const scoped = children.length > 0;
  return [...ifrOp(code, { scope: scoped, body }), ...children.flat(), ...(scoped ? IFR_END : [])];
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.option */
export const ifrOption = (text: number, value: number): number[] =>
  ifrOp(0x09, { body: [text & 0xff, text >> 8, 0, 0, value] });

/**
 * Dell's opcode that ties the question before it to a DVAR variable.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.binding
 */
export function dellBinding(nameId: number, namespace: EFIGUID = DELL_NAMESPACE): number[] {
  const body = new BinaryWriter()
    .guid(DELL_OPCODE_GUID)
    .u8(BINDS_VARIABLE)
    .guid(namespace)
    .u32(nameId).bytes;
  return ifrOp(0x5f, { body });
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.form */
export const ifrForm = (title: number, content: readonly (readonly number[])[]): number[] => [
  ...ifrOp(0x01, { scope: true, body: [1, 0, title & 0xff, title >> 8] }),
  ...content.flat(),
  ...IFR_END,
];

/**
 * A form package: the form set, its forms, the end of its scope.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.formPackage
 */
export function ifrFormPackage(forms: readonly (readonly number[])[]): number[] {
  const set = new BinaryWriter()
    .guid(guid("22222222-3333-4444-5555-666666666666"))
    .u16(0)
    .u16(0)
    .u8(0).bytes;
  const ops = [...ifrOp(0x0e, { scope: true, body: set }), ...forms.flat(), ...IFR_END];
  return [
    ...new BinaryWriter()
      .u24(4 + ops.length)
      .u8(0x02)
      .raw(ops).bytes,
  ];
}

/** @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.le32 */
const le32 = (value: number): number[] => [0, 8, 16, 24].map((shift) => (value >>> shift) & 0xff);

/**
 * Prompts and help in English, keywords in `x-UEFI`, one page of three questions: a
 * checkbox and a list, each tied to a variable, and a question whose opcode comes
 * after something else.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DellSetupFormsTests.swift#TestDellSetup.driver
 */
export function dellDriver(): Uint8Array {
  const english = hiiStrings("en-US", [
    "Allow BIOS Downgrade", // 1
    "Lets an older BIOS be flashed.", // 2
    "Security", // 3
    "Boot Mode", // 4
    "Legacy", // 5
    "UEFI", // 6
    "Sunday", // 7
  ]);
  const keywords = hiiStrings("x-UEFI", [
    "AllowBiosDowngrade",
    "",
    "",
    "BootMode[SuppressIf:Legacy]",
    "",
    "",
    "AutoOnSun",
  ]);
  const forms = ifrFormPackage([
    ifrForm(3, [
      ifrQuestion(0x06, {
        prompt: 1,
        help: 2,
        children: [ifrOp(0x5b, { scope: true, body: [0, 0, 8] }), IFR_END],
      }),
      dellBinding(0x535),
      ifrQuestion(0x05, {
        prompt: 4,
        extra: [0x10, 0, 1, 1],
        children: [ifrOption(5, 0), ifrOption(6, 1)],
      }),
      dellBinding(0x40),
      ifrQuestion(0x06, { prompt: 7 }),
      ifrOp(0x12, { body: [0x11, 0, 0, 0] }),
      dellBinding(0x600),
    ]),
  ]);
  // Code around them, as in a PE image, and each array's length first.
  const code = new Array<number>(0x41).fill(0xcc);
  return Uint8Array.from([
    ...code,
    ...le32(english.length + keywords.length + 4),
    ...english,
    ...keywords,
    ...code,
    ...le32(forms.length + 4),
    ...forms,
    ...code,
  ]);
}
