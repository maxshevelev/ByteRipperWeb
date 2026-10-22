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
  newWindow: (handover) => ipcRenderer.send("window:new", handover),
  // The workspace this window's page is (Design/DESKTOP_WINDOWS.md, D2): what its launch restores,
  // asked once as the page starts, and the page's word back on which it is and whether it records.
  workspace: {
    launch: () => ipcRenderer.sendSync("window:launch"),
    hold: (id, restores) => ipcRenderer.send("workspace:hold", id, restores),
  },
  // Projects (D3): every window's, kept by the shell in the folder of the one open.
  project: {
    window: () => ipcRenderer.invoke("project:window"),
    record: (workspace) => ipcRenderer.invoke("project:record", workspace),
    keeps: (keys) => ipcRenderer.invoke("project:keeps", keys),
    writeKept: (key, kind, bytes) => ipcRenderer.invoke("project:kept-write", key, kind, bytes),
    readKept: (key) => ipcRenderer.invoke("project:kept-read", key),
    open: (path, suggestedName) => ipcRenderer.invoke("project:open", path, suggestedName),
    saveAs: (suggestedName) => ipcRenderer.invoke("project:save-as", suggestedName),
    close: () => ipcRenderer.invoke("project:close"),
    recent: () => ipcRenderer.invoke("project:recent"),
    clearRecent: () => ipcRenderer.invoke("project:clear-recent"),
  },
  closeWindow: () => ipcRenderer.send("window:close"),
  // The app's own windows (D7): the help, the annotations, the agent — one of each, opened or
  // brought forward at what is named, and in such a window, the next thing it is asked to show.
  own: {
    open: (kind, message) => ipcRenderer.send("window:own", kind, message),
    onShow: (callback) => listen("own:show", callback),
    // Through the shell, which keeps where the window stood: a page's own `window.close()` ends
    // the page and leaves the shell nothing to hear.
    close: () => ipcRenderer.send("window:close"),
  },
  // Show in Its Window (D4): this window brought forward.
  focusWindow: () => ipcRenderer.send("window:focus"),
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
