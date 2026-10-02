import { DellSetupCatalogue, type DellSetupSetting } from "@/firmware/uefi/dellSetupForms";
import type { WireDvarSetting } from "@/workers/protocol";

/**
 * What Dell's Setup forms say each DVAR variable is, as it crosses between the
 * workers and the page: a catalogue holds a Map keyed by GUID text, which a
 * structured clone would carry without its methods.
 *
 * @web-only the reading and the panel are on either side of a worker boundary
 */
export function dvarSettingsToWire(catalogue: DellSetupCatalogue): WireDvarSetting[] {
  return catalogue.entries().map(({ namespace, nameId, setting }) => ({
    namespace,
    nameId,
    prompt: setting.prompt,
    keyword: setting.keyword,
    help: setting.help,
    form: setting.form,
    kind: setting.kind,
    options: setting.options.map((one) => ({ value: one.value.toString(), text: one.text })),
  }));
}

/** The catalogue a wire list stands for. */
export function dvarSettingsFromWire(settings: readonly WireDvarSetting[]): DellSetupCatalogue {
  const map = new Map<string, DellSetupSetting>();
  for (const one of settings) {
    map.set(`${one.namespace}|${one.nameId}`, {
      prompt: one.prompt,
      keyword: one.keyword,
      help: one.help,
      form: one.form,
      kind: one.kind,
      options: one.options.map((option) => ({ value: BigInt(option.value), text: option.text })),
    });
  }
  return new DellSetupCatalogue(map);
}
