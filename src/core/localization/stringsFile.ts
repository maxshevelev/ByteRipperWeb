/**
 * Reading a `.strings` file.
 *
 * Apple's own format — `"key" = "value";`, with comments of both C shapes —
 * because a translator's tools already know it, and because it is the format
 * the macOS app's own catalogues are written in: a sentence the two editions
 * share can be carried across without being re-typed.
 *
 * A file that will not parse comes back empty rather than half-read: half a
 * language is worse than none, and the coverage script reports the file long
 * before a reader sees it (`Skills/help-coverage`).
 *
 * @upstream Packages/Localization/Sources/Localization/StringsFile.swift#StringsFile
 * @upstream-differs upstream hands the text to `PropertyListSerialization`,
 * which is the platform's own parser; a browser has no such thing, so the
 * format's small grammar is read here — and read strictly, so that a file it
 * cannot account for is refused whole rather than trusted in part
 */

/**
 * Every entry of `text`, or nothing at all if it is not a `.strings` file.
 *
 * @upstream Packages/Localization/Sources/Localization/StringsFile.swift#StringsFile.parse
 */
export function parseStringsFile(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  let at = 0;

  /** Past whitespace and both kinds of comment, to the next thing that matters. */
  const skipTrivia = (): boolean => {
    for (;;) {
      while (at < text.length && /\s/.test(text[at] as string)) at += 1;
      if (text.startsWith("//", at)) {
        const line = text.indexOf("\n", at);
        at = line === -1 ? text.length : line + 1;
        continue;
      }
      if (text.startsWith("/*", at)) {
        const end = text.indexOf("*/", at + 2);
        if (end === -1) return false; // A comment nobody closed: the rest is anybody's guess.
        at = end + 2;
        continue;
      }
      return true;
    }
  };

  /** The quoted string at the cursor, with its escapes resolved. */
  const readQuoted = (): string | undefined => {
    if (text[at] !== '"') return undefined;
    at += 1;
    let value = "";
    while (at < text.length) {
      const character = text[at] as string;
      if (character === '"') {
        at += 1;
        return value;
      }
      if (character !== "\\") {
        value += character;
        at += 1;
        continue;
      }
      const escaped = text[at + 1];
      if (escaped === undefined) return undefined;
      at += 2;
      switch (escaped) {
        case "n":
          value += "\n";
          break;
        case "t":
          value += "\t";
          break;
        case "r":
          value += "\r";
          break;
        case "u": {
          const code = text.slice(at, at + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(code)) return undefined;
          value += String.fromCharCode(Number.parseInt(code, 16));
          at += 4;
          break;
        }
        default:
          // `\"` and `\\` are the two that matter; anything else escaped is
          // itself, which is what the platform's parser does with it too.
          value += escaped;
      }
    }
    return undefined; // A string nobody closed.
  };

  for (;;) {
    if (!skipTrivia()) return {};
    if (at >= text.length) return entries;

    const key = readQuoted();
    if (key === undefined) return {};
    if (!skipTrivia()) return {};
    if (text[at] !== "=") return {};
    at += 1;
    if (!skipTrivia()) return {};
    const value = readQuoted();
    if (value === undefined) return {};
    if (!skipTrivia()) return {};
    if (text[at] !== ";") return {};
    at += 1;

    entries[key] = value;
  }
}
