import { type EFIGUID, guid, guidBytes, guidFromBytes, guidKey } from "@/firmware/uefi/efiGuid";
import type { SpaceReaders } from "@/firmware/uefi/spaceReaders";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";

/**
 * What Dell's BIOS Setup says a DVAR variable is (`UEFI_IMAGE_FORMAT.md` §9).
 *
 * A DVAR variable is only a number in a namespace. The firmware's Setup pages are
 * what give it a meaning: Dell's forms are standard HII — an IFR form package per
 * page and string packages beside them, compiled into the driver that publishes
 * them (`DellSetupFormSets`) — and each question that is kept in DVAR is followed,
 * at its own level, by a GUID opcode of Dell's (`A5D58BCF-…`, subtype `0x1D`)
 * naming the namespace and the name id. So the question's prompt, its help, the
 * page it is on and, for a list, the text of each value are all in the dump, in
 * the image's own words.
 *
 * The `x-UEFI` strings, where the driver has them, are each question's keyword —
 * `AllowBiosDowngrade`, `AutoOnSun` — the name Dell's own tools set the option by.
 * A prompt is the line on its page and is often meaningless alone ("Sunday",
 * "Clear"); the keyword is not.
 *
 * Read off the bytes as they are, with no driver run: a prompt a driver fills in
 * at run time reads as whatever placeholder was compiled in.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup
 */

/**
 * The GUID of Dell's IFR opcodes.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.opcodeGuid
 */
export const DELL_OPCODE_GUID = guid("A5D58BCF-EB5C-44FC-9122-CA4369B9ABE6");
/**
 * The opcode that ties the question before it to a DVAR variable: subtype, the
 * namespace's GUID, a 32-bit name id.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.bindsVariable
 */
export const BINDS_VARIABLE = 0x1d;
/** @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.pe32Section */
export const PE32_SECTION = 0x10;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Key */
export interface DellSetupKey {
  readonly namespace: EFIGUID;
  readonly nameId: number;
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Setting.Kind */
export type DellSetupKind = "checkbox" | "oneOf" | "numeric" | "string" | "other";

/** @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Setting.Option */
export interface DellSetupOption {
  readonly value: bigint;
  readonly text: string;
}

/**
 * One Setup question, as its page shows it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Setting
 */
export interface DellSetupSetting {
  /** The line on the page, in English. */
  readonly prompt: string;
  /** The `x-UEFI` keyword, when the driver has one for the question. */
  readonly keyword: string | undefined;
  readonly help: string | undefined;
  /** The title of the page the question is on. */
  readonly form: string | undefined;
  readonly kind: DellSetupKind;
  /** A list's values and what each is called, in the page's order. */
  readonly options: readonly DellSetupOption[];
}

/**
 * What a row is called: the keyword, which is unambiguous, and the prompt where
 * there is none.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Setting.name
 */
export const settingName = (setting: DellSetupSetting): string => setting.keyword ?? setting.prompt;

/**
 * The text of the option `value` is, for a list.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Setting.option
 */
export const settingOption = (setting: DellSetupSetting, value: bigint): string | undefined =>
  setting.options.find((one) => one.value === value)?.text;

const keyText = (namespace: EFIGUID, nameId: number): string => `${guidKey(namespace)}|${nameId}`;

/**
 * Every setting the image's forms tie to a DVAR variable.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Catalogue
 */
export class DellSetupCatalogue {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Catalogue.settings */
  readonly settings: ReadonlyMap<string, DellSetupSetting>;

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Catalogue.init */
  constructor(settings: ReadonlyMap<string, DellSetupSetting> = new Map()) {
    this.settings = settings;
  }

  /** @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Catalogue.isEmpty */
  get isEmpty(): boolean {
    return this.settings.size === 0;
  }

  /**
   * The setting a DVAR entry holds, by the namespace and name id its row was
   * given. Nothing for an entry the tree could not place in a namespace, and for
   * one no page asks about.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Catalogue.setting
   */
  settingFor(entry: {
    readonly kind: string;
    readonly guid?: EFIGUID | undefined;
    readonly name: string;
  }): DellSetupSetting | undefined {
    if (entry.kind !== "dvarEntry" || entry.guid === undefined) return undefined;
    return this.settingIn(entry.guid, entry.name);
  }

  /**
   * The setting of the variable `nameId` — in hex, as a row names it — in
   * `namespace`.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.Catalogue.setting
   */
  settingIn(namespace: EFIGUID, nameId: string): DellSetupSetting | undefined {
    if (!/^[0-9a-f]+$/i.test(nameId)) return undefined;
    const number = Number.parseInt(nameId, 16);
    return number > 0xffff_ffff ? undefined : this.settings.get(keyText(namespace, number));
  }

  /** The settings, as plain entries — what a caller across a worker boundary keeps. */
  entries(): {
    readonly namespace: string;
    readonly nameId: number;
    readonly setting: DellSetupSetting;
  }[] {
    return [...this.settings].map(([key, setting]) => {
      const at = key.lastIndexOf("|");
      return {
        namespace: key.slice(0, at),
        nameId: Number(key.slice(at + 1)),
        setting,
      };
    });
  }
}

/**
 * The settings of every driver in `image` that carries Dell's opcode — read over
 * the sections the tree has materialized, so a caller that wants them all opens
 * everything first.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.read
 */
export function readDellSetup(image: UEFIImage, readers: SpaceReaders): DellSetupCatalogue {
  const settings = new Map<string, DellSetupSetting>();
  const pattern = guidBytes(DELL_OPCODE_GUID);
  for (const node of image.allNodes) {
    if (node.kind !== "section" || node.subtype !== PE32_SECTION) continue;
    const reader = readers.readerFor(node.space);
    const body = reader?.bytes(node.body);
    if (body === undefined || !contains(pattern, body)) continue;
    for (const [key, setting] of dellSettingsIn(body))
      if (!settings.has(key)) settings.set(key, setting);
  }
  return new DellSetupCatalogue(settings);
}

/**
 * The settings one driver's bytes define: its string packages, and the questions
 * of its form packages that Dell's opcode ties to a variable.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.settings
 */
export function dellSettingsIn(bytes: Uint8Array): Map<string, DellSetupSetting> {
  const strings = stringPackages(bytes);
  const text =
    strings.find((one) => one.language === "en-US") ??
    strings.find((one) => one.language.startsWith("en")) ??
    strings.find((one) => !one.language.startsWith("x-"));
  const keywords = strings.find((one) => one.language === "x-UEFI");
  const string = (id: number): string | undefined => {
    const found = text?.strings.get(id)?.trim();
    return found === undefined || found === "" ? undefined : found;
  };
  const keyword = (id: number): string | undefined => {
    // Some carry a condition after the word: `TpmClear[SuppressIf:…]`.
    const raw = keywords?.strings.get(id);
    if (raw === undefined) return undefined;
    const bracket = raw.indexOf("[");
    const word = (bracket < 0 ? raw : raw.slice(0, bracket)).trim();
    return word === "" ? undefined : word;
  };

  const settings = new Map<string, DellSetupSetting>();
  for (const form of formPackages(bytes)) {
    for (const question of questionsIn(form, bytes)) {
      const prompt = string(question.prompt);
      const word = keyword(question.prompt);
      const name = prompt ?? word;
      if (name === undefined) continue;
      const setting: DellSetupSetting = {
        prompt: name,
        keyword: word,
        help: string(question.help),
        form: question.form === undefined ? undefined : string(question.form),
        kind: question.kind,
        options: question.options.map((one) => ({
          value: one.value,
          text: string(one.text) ?? "",
        })),
      };
      for (const key of question.keys) {
        const at = keyText(key.namespace, key.nameId);
        if (!settings.has(at)) settings.set(at, setting);
      }
    }
  }
  return settings;
}

// MARK: - HII string packages

interface StringPackage {
  readonly language: string;
  readonly strings: Map<number, string>;
}

/**
 * `EFI_HII_PACKAGE_STRINGS`: a header whose size is where the strings start, a
 * language tag, and string blocks up to an end block.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.stringPackages
 */
function stringPackages(bytes: Uint8Array): StringPackage[] {
  const found: StringPackage[] = [];
  let offset = 0;
  while (offset + 48 <= bytes.length) {
    const at = offset;
    offset += 1;
    if (bytes[at + 3] !== 0x04) continue;
    const length = u24(bytes, at);
    const headerSize = u32(bytes, at + 4);
    if (
      headerSize !== u32(bytes, at + 8) ||
      headerSize < 48 ||
      headerSize > 0x100 ||
      length <= headerSize ||
      at + length > bytes.length
    ) {
      continue;
    }
    // The language: printable ASCII, ending inside the header.
    const header = bytes.subarray(at + 46, at + headerSize);
    const zero = header.indexOf(0);
    const tag = zero < 0 ? header : header.subarray(0, zero);
    if (tag.length === 0 || tag.length >= headerSize - 46) continue;
    if (!tag.every((byte) => byte >= 0x21 && byte <= 0x7e)) continue;
    const strings = stringBlocks(bytes, at + headerSize, at + length);
    if (strings === undefined) continue;
    found.push({ language: String.fromCharCode(...tag), strings });
    offset = at + length;
  }
  return found;
}

/**
 * The string blocks from `start` up to the end block, by id; nothing when they do
 * not read as blocks up to one inside `end`.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.stringBlocks
 */
function stringBlocks(
  bytes: Uint8Array,
  start: number,
  end: number
): Map<number, string> | undefined {
  const strings = new Map<number, string>();
  let id = 1;
  let at = start;
  type Reader = (from: number) => { text: string; next: number } | undefined;
  const ucs2: Reader = (from) => {
    const units: number[] = [];
    let cursor = from;
    while (cursor + 1 < end) {
      const unit = (bytes[cursor] ?? 0) | ((bytes[cursor + 1] ?? 0) << 8);
      cursor += 2;
      if (unit === 0) return { text: String.fromCharCode(...units), next: cursor };
      units.push(unit);
    }
    return undefined;
  };
  const scsu: Reader = (from) => {
    const zero = bytes.subarray(from, end).indexOf(0);
    if (zero < 0) return undefined;
    return {
      text: new TextDecoder("utf-8").decode(bytes.subarray(from, from + zero)),
      next: from + zero + 1,
    };
  };
  const take = (read: Reader, count: number, from: number): number | undefined => {
    let cursor = from;
    for (let one = 0; one < count; one++) {
      const found = read(cursor);
      if (found === undefined) return undefined;
      strings.set(id, found.text);
      id = (id + 1) & 0xffff;
      cursor = found.next;
    }
    return cursor;
  };
  while (at < end) {
    const type = bytes[at] ?? 0;
    let next: number | undefined;
    switch (type) {
      case 0x00:
        return strings; // end
      case 0x10:
        next = take(scsu, 1, at + 1);
        break;
      case 0x11:
        next = take(scsu, 1, at + 2); // + font
        break;
      case 0x12:
        if (at + 3 <= end) next = take(scsu, u16(bytes, at + 1), at + 3);
        break;
      case 0x13:
        if (at + 4 <= end) next = take(scsu, u16(bytes, at + 2), at + 4);
        break;
      case 0x14:
        next = take(ucs2, 1, at + 1);
        break;
      case 0x15:
        next = take(ucs2, 1, at + 2);
        break;
      case 0x16:
        if (at + 3 <= end) next = take(ucs2, u16(bytes, at + 1), at + 3);
        break;
      case 0x17:
        if (at + 4 <= end) next = take(ucs2, u16(bytes, at + 2), at + 4);
        break;
      case 0x20: // duplicate
        if (at + 3 <= end) {
          const copied = strings.get(u16(bytes, at + 1));
          if (copied !== undefined) strings.set(id, copied);
          else strings.delete(id);
          id = (id + 1) & 0xffff;
          next = at + 3;
        }
        break;
      case 0x21: // skip2
        if (at + 3 <= end) {
          id = (id + u16(bytes, at + 1)) & 0xffff;
          next = at + 3;
        }
        break;
      case 0x22: // skip1
        if (at + 2 <= end) {
          id = (id + (bytes[at + 1] ?? 0)) & 0xffff;
          next = at + 2;
        }
        break;
      case 0x30: // ext1
        if (at + 3 <= end) next = at + (bytes[at + 2] ?? 0);
        break;
      case 0x31: // ext2
        if (at + 4 <= end) next = at + u16(bytes, at + 2);
        break;
      case 0x32: // ext4
        if (at + 6 <= end) next = at + u32(bytes, at + 2);
        break;
      default:
        next = undefined;
    }
    if (next === undefined || next <= at || next > end) return undefined;
    at = next;
  }
  return undefined;
}

// MARK: - IFR form packages

const FORM_SET_OP = 0x0e;
const FORM_OP = 0x01;
const ONE_OF_OPTION_OP = 0x09;
const GUID_OP = 0x5f;
const END_OP = 0x29;
const QUESTION_KINDS: ReadonlyMap<number, DellSetupKind> = new Map([
  [0x05, "oneOf"],
  [0x06, "checkbox"],
  [0x07, "numeric"],
  [0x1c, "string"],
  [0x08, "other"],
  [0x1a, "other"],
  [0x1b, "other"],
  [0x23, "other"],
]);

/**
 * `EFI_HII_PACKAGE_FORMS` that open on a form set and whose opcodes run exactly to
 * their end, with every scope closed.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.formPackages
 */
function formPackages(bytes: Uint8Array): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const at = offset;
    offset += 1;
    if (bytes[at + 3] !== 0x02 || bytes[at + 4] !== FORM_SET_OP) continue;
    const length = u24(bytes, at);
    if (length <= 8 || at + length > bytes.length) continue;
    let cursor = at + 4;
    let depth = 0;
    while (cursor + 2 <= at + length) {
      const size = (bytes[cursor + 1] ?? 0) & 0x7f;
      if (size < 2) break;
      if (((bytes[cursor + 1] ?? 0) & 0x80) !== 0) depth += 1;
      if (bytes[cursor] === END_OP) depth -= 1;
      cursor += size;
    }
    if (cursor !== at + length || depth !== 0) continue;
    found.push({ start: at + 4, end: at + length });
    offset = at + length;
  }
  return found;
}

interface Question {
  readonly prompt: number;
  readonly help: number;
  readonly form: number | undefined;
  readonly kind: DellSetupKind;
  readonly options: { value: bigint; text: number }[];
  readonly keys: DellSetupKey[];
}

/**
 * The questions of one form package that Dell's opcode ties to a variable. The
 * opcode follows the question it is about at the question's own level, right after
 * the question's scope closes — or right after the question, when it has none — so
 * it ties to the question just finished, and any other opcode in between unties
 * it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/DellSetupForms.swift#DellSetup.questions
 */
function questionsIn(form: { start: number; end: number }, bytes: Uint8Array): Question[] {
  /** An open scope: the question it belongs to, if any, and the title of the page it is on. */
  interface Scope {
    readonly question: number | undefined;
    readonly form: number | undefined;
  }
  const questions: Question[] = [];
  const scopes: Scope[] = [];
  let finished: number | undefined;
  const opcode = pattern(DELL_OPCODE_GUID);
  let at = form.start;
  while (at + 2 <= form.end) {
    const op = bytes[at] ?? 0;
    const size = (bytes[at + 1] ?? 0) & 0x7f;
    const opensScope = ((bytes[at + 1] ?? 0) & 0x80) !== 0;
    const next = at + size;
    if (size < 2 || next > form.end) break;
    let opened: number | undefined;
    let isBinding = false;

    if (
      op === GUID_OP &&
      size >= 39 &&
      equalBytes(bytes, at + 2, opcode) &&
      bytes[at + 18] === BINDS_VARIABLE
    ) {
      isBinding = true;
      if (finished !== undefined) {
        const target = questions[finished];
        target?.keys.push({
          namespace: guidFromBytes(bytes.subarray(at + 19, at + 35)),
          nameId: u32(bytes, at + 35),
        });
      }
    } else if (QUESTION_KINDS.has(op) && size >= 13) {
      questions.push({
        prompt: u16(bytes, at + 2),
        help: u16(bytes, at + 4),
        form: scopes[scopes.length - 1]?.form,
        kind: QUESTION_KINDS.get(op) ?? "other",
        options: [],
        keys: [],
      });
      opened = questions.length - 1;
    } else if (op === ONE_OF_OPTION_OP && size >= 7) {
      const owner = [...scopes].reverse().find((one) => one.question !== undefined)?.question;
      if (owner !== undefined) {
        let value: bigint;
        switch (bytes[at + 5]) {
          case 1:
            value = size >= 8 ? BigInt(u16(bytes, at + 6)) : BigInt(bytes[at + 6] ?? 0);
            break;
          case 2:
            value = size >= 10 ? BigInt(u32(bytes, at + 6)) : BigInt(bytes[at + 6] ?? 0);
            break;
          case 3:
            value =
              size >= 14
                ? BigInt(u32(bytes, at + 6)) | (BigInt(u32(bytes, at + 10)) << 32n)
                : BigInt(bytes[at + 6] ?? 0);
            break;
          default:
            value = BigInt(bytes[at + 6] ?? 0);
        }
        questions[owner]?.options.push({ value, text: u16(bytes, at + 2) });
      }
    }

    if (!isBinding) finished = undefined;
    if (opensScope) {
      const title =
        op === FORM_OP && size >= 6 ? u16(bytes, at + 4) : scopes[scopes.length - 1]?.form;
      scopes.push({ question: opened, form: title });
    } else if (opened !== undefined) {
      finished = opened;
    }
    if (op === END_OP) {
      const closed = scopes.pop();
      if (closed?.question !== undefined) finished = closed.question;
    }
    at = next;
  }
  return questions.filter((one) => one.keys.length > 0);
}

// MARK: - Bytes

const u16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const u24 = (bytes: Uint8Array, at: number): number =>
  u16(bytes, at) | ((bytes[at + 2] ?? 0) << 16);
const u32 = (bytes: Uint8Array, at: number): number =>
  (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;

const pattern = (value: EFIGUID): Uint8Array => guidBytes(value);

const equalBytes = (bytes: Uint8Array, at: number, expected: Uint8Array): boolean =>
  expected.every((byte, index) => bytes[at + index] === byte);

function contains(needle: Uint8Array, bytes: Uint8Array): boolean {
  const first = needle[0];
  if (first === undefined || bytes.length < needle.length) return false;
  for (let hit = bytes.indexOf(first); hit >= 0; hit = bytes.indexOf(first, hit + 1)) {
    if (hit + needle.length > bytes.length) return false;
    if (equalBytes(bytes, hit, needle)) return true;
  }
  return false;
}
