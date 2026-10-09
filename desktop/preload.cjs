// What the page may ask of the shell: to show its command menu as the window's
// menu bar, and to zoom the window. Data crosses, nothing else — the page keeps
// its commands.
// A chosen item comes back through main.cjs, not through here: it has to
// arrive as a user gesture, which a message over IPC is not.
const { contextBridge, ipcRenderer } = require("electron");

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
