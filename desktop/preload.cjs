// What the page may ask of the shell: to show its command menu as the window's
// menu bar, and to zoom the window. Data crosses, nothing else — the page keeps
// its commands.
// A chosen item comes back through main.cjs, not through here: it has to
// arrive as a user gesture, which a message over IPC is not.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// The agent service's end of the page (Design/PORT_AGENT.md): the connections an agent's relay
// makes, as bytes in and out, and files by path. No message is read here.
const listen = (channel, callback) => {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("byteripperDesktop", {
  agent: {
    setEnabled: (on) => ipcRenderer.invoke("agent:enable", on),
    info: () => ipcRenderer.invoke("agent:info"),
    onConnection: (callback) => listen("agent:connection", callback),
    onData: (callback) => listen("agent:data", callback),
    onClose: (callback) => listen("agent:close", callback),
    send: (id, bytes) => ipcRenderer.send("agent:send", id, bytes),
    end: (id) => ipcRenderer.send("agent:end", id),
    file: (request) => ipcRenderer.invoke("agent:file", request),
  },
  // The full path of a file the person opened — through the picker, the file input or a drop —
  // which a page is never told; and that file read again by it.
  files: {
    pathOf: (file) => {
      try {
        return webUtils.getPathForFile(file) || undefined;
      } catch {
        return undefined;
      }
    },
    file: (request) => ipcRenderer.invoke("file:read", request),
  },
  setMenu: (menus) => ipcRenderer.send("menu:set", menus),
  zoom: (step) => ipcRenderer.send("zoom", step),
  quit: () => ipcRenderer.send("quit"),
  newWindow: () => ipcRenderer.send("window:new"),
  // The workspace this window's page is (Design/DESKTOP_WINDOWS.md, D2): what its launch restores,
  // asked once as the page starts, and the page's word back on which it is and whether it records.
  workspace: {
    launch: () => ipcRenderer.sendSync("window:launch"),
    hold: (id, restores) => ipcRenderer.send("workspace:hold", id, restores),
  },
  closeWindow: () => ipcRenderer.send("window:close"),
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
