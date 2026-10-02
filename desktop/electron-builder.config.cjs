// The Windows build's configuration is the "build" block of package.json; this
// adds only the version, which is the web edition's (../package.json). It is
// handed over here because electron-builder refuses a package.json whose own
// version is not semver, and ours ("0.9-1") is upstream's release and a build
// number, not semver. Set as extra metadata it is only required to be there:
// the artifacts are named with it as it is, and the executable's numeric file
// version is derived from it ("0.9.0.0").
const desktop = require("./package.json");
const web = require("../package.json");

module.exports = { ...desktop.build, extraMetadata: { version: web.version } };
