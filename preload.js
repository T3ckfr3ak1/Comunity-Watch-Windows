const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cw", {
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    openSite: () => ipcRenderer.invoke("app:openSite")
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (next) => ipcRenderer.invoke("settings:set", next)
  },
  intel: {
    getBundledRules: () => ipcRenderer.invoke("intel:getBundledRules")
  },
  lan: {
    scan: (opts) => ipcRenderer.invoke("lan:scan", opts)
  }
});

