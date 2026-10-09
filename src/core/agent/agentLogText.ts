import type { AgentCallRecord } from "@/core/agent/agentServer";
import { jsonText, prettyText } from "@/core/agent/json";
import { L } from "@/core/localization/localization";
import { friendlySize } from "@/core/text/byteSize";

/**
 * What the Agent window's log says of a call, column by column — the same words in the table and
 * in the details under it.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController
 */

/** @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.Column */
export type AgentLogColumn = "time" | "tool" | "arguments" | "duration" | "size" | "result";

export const AGENT_LOG_COLUMNS: readonly AgentLogColumn[] = [
  "time",
  "tool",
  "arguments",
  "duration",
  "size",
  "result",
];

export function columnTitle(column: AgentLogColumn): string {
  switch (column) {
    case "time":
      return L("Time");
    case "tool":
      return L("Tool");
    case "arguments":
      return L("Arguments");
    case "duration":
      return L("Took");
    case "size":
      return L("Answer");
    case "result":
      return L("Result");
  }
}

const two = (value: number) => String(value).padStart(2, "0");

/** @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.text */
export function logText(record: AgentCallRecord, column: AgentLogColumn): string {
  switch (column) {
    case "time":
      return `${two(record.finished.getHours())}:${two(record.finished.getMinutes())}:${two(record.finished.getSeconds())}`;
    case "tool":
      return record.tool;
    case "arguments":
      // The arguments as the agent wrote them: they are the agent's words, and what a reader
      // checks the agent against.
      return jsonText(record.arguments) === "{}" ? "" : jsonText(record.arguments);
    case "duration":
      return record.durationMilliseconds < 1000
        ? L("%1$@ ms", Math.round(record.durationMilliseconds))
        : L("%1$@ s", (record.durationMilliseconds / 1000).toFixed(1));
    case "size":
      return friendlySize(record.answerBytes);
    case "result":
      switch (record.outcome.kind) {
        case "answered":
          return L("Answered");
        case "toolError":
          return record.outcome.message;
        case "overBound":
          return L("Too long, not sent");
        case "cancelled":
          return L("Cancelled");
      }
  }
}

/** @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.isProblem */
export const isProblem = (record: AgentCallRecord): boolean => record.outcome.kind !== "answered";

/**
 * The arguments as the agent sent them, laid out: one member to a line, nested ones indented, keys
 * sorted.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.argumentsText
 */
export const argumentsText = (record: AgentCallRecord): string => prettyText(record.arguments);

/**
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.DetailField
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.DetailField.isProblem
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.DetailField.label
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.DetailField.value
 */
export interface DetailField {
  readonly label: string;
  readonly value: string;
  readonly isProblem: boolean;
}

/**
 * The rows the details list shows for `record`, above its arguments.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.detailFields
 */
export function detailFields(record: AgentCallRecord): DetailField[] {
  const fields: DetailField[] = [
    { label: L("Time"), value: record.finished.toLocaleTimeString(), isProblem: false },
    { label: L("Took"), value: logText(record, "duration"), isProblem: false },
    { label: L("Answer"), value: L("%1$@ bytes", record.answerBytes), isProblem: false },
    { label: L("Result"), value: logText(record, "result"), isProblem: isProblem(record) },
  ];
  if (record.client !== undefined) {
    fields.splice(1, 0, { label: L("Client"), value: record.client, isProblem: false });
  }
  return fields;
}
