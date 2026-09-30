// What the page may ask of the shell: to show its command menu as the window's
// menu bar, and to zoom the window. Data crosses, nothing else — the page keeps
// its commands.
// A chosen item comes back through main.cjs, not through here: it has to
// arrive as a user gesture, which a message over IPC is not.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("byteripperDesktop", {
  setMenu: (menus) => ipcRenderer.send("menu:set", menus),
  zoom: (step) => ipcRenderer.send("zoom", step),
  quit: () => ipcRenderer.send("quit"),
  canInstallUpdate: ipcRenderer.sendSync("update:installable"),
  installUpdate: (version) => ipcRenderer.invoke("update:install", version),
  latestRelease: () => ipcRenderer.invoke("update:latest"),
  cancelUpdate: () => ipcRenderer.send("update:cancel"),
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
});
