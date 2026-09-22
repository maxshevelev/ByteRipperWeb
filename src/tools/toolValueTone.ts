/**
 * How a labelled value is drawn — the colour intent the side that knows the
 * fact behind a value decides (e.g. a File System State's status). The view
 * resolves each tone into the app's palette; a value carries `standard` unless
 * it says otherwise.
 *
 * Shared code rather than one panel's, for upstream's own reason: it is the
 * same kind of thing as `ToolRowMarks` — a vocabulary two panels draw by,
 * belonging to neither. The ME engine has no opinion on a colour, and a tool
 * may not reach another tool's presentation, so this is the one place both can.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolValueTone.swift#ToolValueTone
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolValueTone.swift#ToolValueTone.standard
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolValueTone.swift#ToolValueTone.good
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolValueTone.swift#ToolValueTone.caution
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolValueTone.swift#ToolValueTone.bad
 * @upstream-differs a string union, where upstream's enum also carries the
 * colour, the font and the drawing: a browser reads those off the stylesheet
 */
export type ToolValueTone = "standard" | "good" | "caution" | "bad";

/**
 * Whether the value carries a status at all. One that does is drawn bold as
 * well as coloured: the weight is what makes a state read at a glance rather
 * than as one more line of text.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolValueTone.swift#ToolValueTone.isStatus
 */
export const isStatusTone = (tone: ToolValueTone): boolean => tone !== "standard";
