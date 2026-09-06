const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let win, store, Store, exporter, config, configPath, transfer, Backups, backups;
let queue = Promise.resolve(),
  pendingImport = null,
  autoBackupError = null;
function serialize(fn) {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
}
app.setPath(
  "userData",
  process.env.CHAI_USER_DATA ||
    path.join(app.getPath("appData"), "chai-associates-desktop"),
);
const entry = path.join(__dirname, "../dist/index.html");
const localURL = pathToFileURL(entry).href;
function publicSettings() {
  return {
    mode: "local",
    database: config.database,
    autoBackup: config.autoBackup !== false,
    backupDirectory: backups.directory,
    backups: backups.list(),
    autoBackupError,
    counts: {
      quotations: store.db.prepare("SELECT COUNT(*) AS n FROM quotations").get()
        .n,
      templates: store.db.prepare("SELECT COUNT(*) AS n FROM templates").get()
        .n,
    },
  };
}
function saveConfig(next) {
  const temp = configPath + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(temp, configPath);
  config = next;
}
async function rpc(method, args = {}) {
  return store.rpc(method, args);
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      event.senderFrame.url !== localURL
    )
      throw new Error("Untrusted caller.");
    try {
      return { result: await serialize(() => fn(...args)) };
    } catch (e) {
      return { error: e.message };
    }
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else
  app
    .whenReady()
    .then(async () => {
      ({ Store } = await import("../core/store.mjs"));
      exporter = await import("../core/export.mjs");
      transfer = await import("../core/data-transfer.mjs");
      ({ Backups } = await import("../core/backups.mjs"));
      configPath = path.join(app.getPath("userData"), "storage.json");
      config = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, "utf8"))
        : {
            mode: "local",
            database: path.join(app.getPath("userData"), "chai.sqlite"),
          };
      // Never silently replace a missing existing database with an empty database.
      config = {
        mode: "local",
        database: config.database,
        autoBackup: config.autoBackup !== false,
      };
      {
        if (fs.existsSync(configPath) && !fs.existsSync(config.database))
          throw new Error(
            `Configured database is missing: ${config.database}. Restore the file before reopening.`,
          );
        store = new Store(config.database);
      }
      backups = new Backups(
        path.join(app.getPath("userData"), "backups"),
        config.database,
      );
      async function automaticBackup() {
        if (config.autoBackup) {
          try {
            await backups.daily(store);
            autoBackupError = null;
          } catch (e) {
            autoBackupError = e.message;
          }
        }
      }
      await automaticBackup();
      const backupTimer = setInterval(
        () => serialize(automaticBackup),
        15 * 60 * 1000,
      );
      backupTimer.unref();
      saveConfig(config);
      handle("chai:rpc", rpc);
      handle("chai:settings", publicSettings);
      handle("chai:database", async (mode) => {
        if (!["open", "move"].includes(mode))
          throw new Error("Invalid database action.");
        let target;
        if (mode === "open") {
          const result = await dialog.showOpenDialog(win, {
            title: "Open a Chai desktop database on a local disk",
            properties: ["openFile"],
            filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }],
          });
          if (result.canceled) return null;
          target = result.filePaths[0];
        } else {
          const result = await dialog.showSaveDialog(win, {
            title: "Copy current database to a new local location",
            defaultPath: "chai.sqlite",
            filters: [{ name: "SQLite", extensions: ["sqlite"] }],
          });
          if (result.canceled) return null;
          target = result.filePath;
        }
        if (path.resolve(target) === path.resolve(config.database)) return null;
        if (mode === "move") await store.backupTo(target);
        const candidate = new Store(target, { create: false });
        try {
          saveConfig({ ...config, database: target });
        } catch (e) {
          candidate.close();
          throw e;
        }
        store.close();
        store = candidate;
        pendingImport = null;
        backups = new Backups(backups.directory, config.database);
        await automaticBackup();
        return publicSettings();
      });
      handle("chai:backup", async () => {
        const result = await dialog.showSaveDialog(win, {
          defaultPath: `chai-backup-${Date.now()}.sqlite`,
          filters: [{ name: "SQLite backup", extensions: ["sqlite"] }],
        });
        if (result.canceled) return null;
        return store.backupTo(result.filePath);
      });
      handle("chai:data-options", async (enabled) => {
        if (typeof enabled !== "boolean")
          throw new Error("Invalid backup setting.");
        saveConfig({ ...config, autoBackup: enabled });
        await automaticBackup();
        return publicSettings();
      });
      handle("chai:managed-backup", async () => {
        const file = await backups.create(store);
        return { file, settings: publicSettings() };
      });
      handle("chai:reveal", async (name) => {
        const file = name === null ? config.database : backups.path(name);
        shell.showItemInFolder(file);
        return true;
      });
      handle("chai:export-data", async () => {
        const target = await dialog.showSaveDialog(win, {
          title: "Export all quotations and templates",
          defaultPath: `chai-data-${Date.now()}.json`,
          filters: [{ name: "Chai data", extensions: ["json"] }],
        });
        if (target.canceled) return null;
        return transfer.exportJSON(store, target.filePath);
      });
      handle("chai:prepare-import", async (name) => {
        pendingImport = null;
        let file;
        if (name) file = backups.path(name);
        else {
          const selection = await dialog.showOpenDialog(win, {
            title: "Import Chai data or restore a backup",
            properties: ["openFile"],
            filters: [
              {
                name: "Chai desktop data",
                extensions: ["sqlite", "db", "json"],
              },
            ],
          });
          if (selection.canceled) return null;
          file = selection.filePaths[0];
        }
        const data = transfer.readImport(file),
          plan = transfer.mergePlan(store, data);
        const token = require("node:crypto").randomUUID();
        pendingImport = { token, data };
        return {
          token,
          file,
          quotations: data.quotations.length,
          templates: data.templates.length,
          merge: {
            quotations: plan.quotations.length,
            templates: plan.templates.length,
            skipped: plan.skipped,
            conflicts: plan.conflicts.slice(0, 50),
            conflictCount: plan.conflicts.length,
          },
        };
      });
      handle("chai:cancel-import", () => {
        pendingImport = null;
        return true;
      });
      handle("chai:apply-import", async (token, mode) => {
        if (!pendingImport || pendingImport.token !== token)
          throw new Error("Import preview expired. Select the file again.");
        if (!["merge", "restore"].includes(mode))
          throw new Error("Invalid import mode.");
        const { data } = pendingImport;
        const safety = await backups.create(
          store,
          mode === "restore" ? "before-restore" : "before-import",
        );
        let result;
        if (mode === "merge") result = transfer.applyImport(store, data);
        else {
          const target = path.join(
            path.dirname(config.database),
            `chai-restored-${Date.now()}-${require("node:crypto").randomUUID().slice(0, 8)}.sqlite`,
          );
          const candidate = new Store(target);
          try {
            result = transfer.applyImport(candidate, data, "restore");
            saveConfig({ ...config, database: target });
          } catch (e) {
            candidate.close();
            throw e;
          }
          store.close();
          store = candidate;
          backups = new Backups(backups.directory, config.database);
        }
        pendingImport = null;
        return { ...result, safetyBackup: safety, settings: publicSettings() };
      });
      handle("chai:check-data", () => {
        const result = store.db.prepare("PRAGMA integrity_check").all();
        if (result.some((r) => r.integrity_check !== "ok"))
          throw new Error(
            "SQLite integrity check failed. Restore a verified backup.",
          );
        transfer.snapshot(store);
        return {
          checkedAt: new Date().toISOString(),
          settings: publicSettings(),
        };
      });
      handle("chai:export", async (id, format) => {
        if (!["pdf", "csv", "xlsx"].includes(format))
          throw new Error("Invalid export format.");
        const q = await rpc("quotations.get", { id });
        const target = await dialog.showSaveDialog(win, {
          defaultPath: `${q.number}.${format}`,
          filters: [{ name: format.toUpperCase(), extensions: [format] }],
        });
        if (target.canceled) return null;
        if (format === "csv")
          fs.writeFileSync(target.filePath, exporter.csv(q));
        else if (format === "xlsx")
          fs.writeFileSync(target.filePath, await exporter.xlsx(q));
        else {
          const printWin = new BrowserWindow({
            show: false,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          try {
            await printWin.loadURL(
              "data:text/html;charset=utf-8," +
                encodeURIComponent(exporter.documentHTML(q)),
            );
            const pdf = await printWin.webContents.printToPDF({
              printBackground: true,
              pageSize: "A4",
            });
            fs.writeFileSync(target.filePath, pdf);
          } finally {
            printWin.destroy();
          }
        }
        return target.filePath;
      });
      win = new BrowserWindow({
        width: 1440,
        height: 980,
        minWidth: 600,
        minHeight: 560,
        title: "Chai & Associates",
        icon: path.join(__dirname, "../dist/images/chai-associates-logo.jpg"),
        backgroundColor: "#ffffff",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e, url) => {
        if (url !== localURL) e.preventDefault();
      });
      win.webContents.on("will-prevent-unload", (event) => {
        const choice = dialog.showMessageBoxSync(win, {
          type: "question",
          buttons: ["Keep editing", "Discard changes"],
          defaultId: 0,
          cancelId: 0,
          message: "Close without saving your changes?",
        });
        if (choice === 1) event.preventDefault();
      });
      win.webContents.session.setPermissionRequestHandler(
        (_web, _permission, callback) => callback(false),
      );
      await win.loadFile(entry);
    })
    .catch((e) => {
      dialog.showErrorBox("Unable to open Chai Associates", e.message);
      app.quit();
    });
app.on("second-instance", () => {
  win?.show();
  win?.focus();
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  store?.close();
  store = null;
});
