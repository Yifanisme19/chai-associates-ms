const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  rpc: (method, args) => ipcRenderer.invoke("chai:rpc", method, args),
  settings: () => ipcRenderer.invoke("chai:settings"),
  chooseDatabase: (mode) => ipcRenderer.invoke("chai:database", mode),
  backup: () => ipcRenderer.invoke("chai:backup"),
  dataOptions: (enabled) => ipcRenderer.invoke("chai:data-options", enabled),
  managedBackup: () => ipcRenderer.invoke("chai:managed-backup"),
  reveal: (name = null) => ipcRenderer.invoke("chai:reveal", name),
  exportData: () => ipcRenderer.invoke("chai:export-data"),
  prepareImport: (name = null) =>
    ipcRenderer.invoke("chai:prepare-import", name),
  cancelImport: () => ipcRenderer.invoke("chai:cancel-import"),
  applyImport: (token, mode) =>
    ipcRenderer.invoke("chai:apply-import", token, mode),
  checkData: () => ipcRenderer.invoke("chai:check-data"),
  export: (id, format) => ipcRenderer.invoke("chai:export", id, format),
});
