// The release's signature: Ed25519 over SHA256SUMS, made with a key that is
// never on GitHub, and checked by the Windows build before it runs a setup
// (desktop/update.cjs). The checksums alone say a download is whole; the
// signature says it is ours — whoever can upload to the release cannot make one.
//
//   node sign.mjs keygen <private.pem> <desktop/release-key.cjs>
//   node sign.mjs sign <private.pem> <SHA256SUMS> <SHA256SUMS.sig>
//   node sign.mjs verify <desktop/release-key.cjs> <SHA256SUMS> <SHA256SUMS.sig>
//
// Node's own crypto, like the build's check: no dependency. Python's standard
// library has no Ed25519, which is why this half of release.py is a script of
// its own.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const [command, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(`sign: ${message}`);
  process.exit(1);
}

if (command === "keygen") {
  const [privatePath, publicPath] = args;
  if (fs.existsSync(privatePath)) fail(`${privatePath} exists; a new key would orphan every installed build`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.mkdirSync(path.dirname(privatePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const pem = publicKey.export({ type: "spki", format: "pem" }).trim();
  fs.writeFileSync(
    publicPath,
    "// The public half of the key the releases are signed with " +
      "(Skills/release/scripts/sign.mjs).\n" +
      "// A setup is run only when SHA256SUMS carries a signature this key checks.\n" +
      `module.exports = ${JSON.stringify(pem)};\n`
  );
  console.log(`private key ${privatePath} (keep a copy offline), public key ${publicPath}`);
} else if (command === "sign") {
  const [privatePath, sumsPath, sigPath] = args;
  if (!fs.existsSync(privatePath)) fail(`no signing key at ${privatePath} (release.py keygen)`);
  const key = crypto.createPrivateKey(fs.readFileSync(privatePath));
  const signature = crypto.sign(null, fs.readFileSync(sumsPath), key);
  fs.writeFileSync(sigPath, `${signature.toString("base64")}\n`);
} else if (command === "verify") {
  const [publicPath, sumsPath, sigPath] = args;
  const pem = createRequire(import.meta.url)(path.resolve(publicPath));
  const signature = Buffer.from(fs.readFileSync(sigPath, "utf8").trim(), "base64");
  if (!crypto.verify(null, fs.readFileSync(sumsPath), crypto.createPublicKey(pem), signature)) {
    fail(`${sigPath} is not a signature of ${sumsPath} by the key in ${publicPath}`);
  }
} else {
  fail("keygen | sign | verify");
}
