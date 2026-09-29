// Copies the web edition's production build (`../dist`) into `web/`, which is
// what the desktop shell serves and what electron-builder packs. A copy rather
// than a path out of this directory: the packer takes files from here only.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../dist", import.meta.url));
const to = fileURLToPath(new URL("./web", import.meta.url));

if (!existsSync(from)) throw new Error("../dist is missing: build the web edition first");
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`copied ${from} → ${to}`);
