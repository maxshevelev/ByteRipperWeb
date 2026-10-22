const { ipcRenderer } = require("electron");
ipcRenderer.on("shell-port", (event) => window.postMessage("s0-shell-port", "*", event.ports));
