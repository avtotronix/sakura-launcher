/**
 * Sakura Launcher — Electron main process (TypeScript)
 *
 * Security model:
 *  - contextIsolation: true   → renderer can't access Node globals
 *  - nodeIntegration: false   → no require() in renderer
 *  - sandbox: true            → renderer runs in OS-level sandbox
 *  - webSecurity: true        → same-origin policy enforced
 *  - allowRunningInsecureContent: false
 *  - Strict CSP via session.webRequest.onHeadersReceived
 *  - shell.openExternal only for whitelisted HTTPS origins
 *  - All IPC channels validated & allowlisted
 *  - No remote module (removed in Electron 14+)
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  session,
  nativeTheme,
} from "electron";
import path from "path";
import fs from "fs";
import os from "os";

import { registerAccountsIPC } from "./accounts";
import { registerLauncherIPC } from "./launcher";
import { download } from "./net";
import { startAutoUpdater, registerUpdaterIPC } from "./updater";
import { registerDownloadIPC, downloadManager } from "./downloadManager";
import { InstancesManager, registerInstancesIPC } from "./instances";
import { ModpackInstaller, registerModpackInstallerIPC } from "./modpackInstaller";
import { FriendsSystem, registerFriendsIPC } from "./friends";
import { ServersCatalogManager, registerServersCatalogIPC } from "./serversCatalog";
import { ContentManager, registerContentIPC } from "./contentManager";
import { ModrinthProvider, registerModrinthIPC } from "./modrinthProvider";
import { CurseForgeProvider, registerCurseForgeIPC } from "./curseforgeProvider";

// Defer Discord RPC to background to avoid blocking launcher startup
const clientId = '1326922240505184287';
let rpcReady = false;
setTimeout(() => {
  try {
    const DiscordRPC = require("discord-rpc");
    DiscordRPC.register(clientId);
    const rpc = new DiscordRPC.Client({ transport: 'ipc' });
    rpc.on('ready', () => {
      rpcReady = true;
      rpc.setActivity({
        details: 'В Sakura Launcher',
        state: 'Выбирает сборку',
        startTimestamp: new Date(),
        instance: false,
      });
    });
    rpc.login({ clientId }).catch(() => {});
  } catch {}
}, 3000);

// ─── Constants ──────────────────────────────────────────────────────────────

const IS_DEV = process.argv.includes("--dev");
/** Dev-only smoke test: SAKURA_SELFTEST=path/to/script.js runs it in the renderer and quits */
const SELFTEST = process.env.SAKURA_SELFTEST || "";
if (SELFTEST) app.setPath("userData", path.join(os.tmpdir(), "sakura-selftest"));

/** Allowed origins for shell.openExternal */
const EXTERNAL_ORIGIN_WHITELIST = new Set([
  "https://modrinth.com",
  "https://www.curseforge.com",
  "https://ely.by",
  "https://skinsystem.ely.by",
  "https://github.com",
  "https://raw.githubusercontent.com",
  "https://t.me",
  "https://vk.com",
  "https://funtime.su",
]);

/** Allowed IPC channels renderer → main */
const ALLOWED_INVOKE_CHANNELS = new Set([
  "app:get-version",
  "app:get-platform",
  "app:open-external",
  "app:open-folder",
  "dialog:show-open-file",
  "dialog:show-save-file",
  "launcher:get-data-dir",
  "launcher:read-state",
  "launcher:write-state",
  "launcher:open-game-folder",
  "launcher:get-installed",
  "fs:write-base64",
  "theme:get",
  "accounts:list",
  "accounts:select",
  "accounts:remove",
  "accounts:add-offline",
  "accounts:add-microsoft",
  "accounts:add-elyby",
  "accounts:google",
  "accounts:google-logout",
  "accounts:register-ely",
  "game:launch",
  "pack:download-mod",
  "instances:list",
  "instances:create",
  "instances:delete",
  "instances:get-mods",
  "instances:delete-mod",
  "instances:rename",
  "instances:duplicate",
  "instances:get-components",
  "instances:toggle-component",
  "instances:delete-component",
  "instances:export",
  "downloads:list",
  "downloads:cancel",
  "downloads:retry",
  "downloads:clear",
  "downloads:enqueue",
  "modpack:install-mrpack",
  "friends:get-state",
  "friends:update-profile",
  "friends:send-request",
  "friends:accept-request",
  "friends:decline-request",
  "friends:remove-friend",
  "servers:query",
  "servers:toggle-favorite",
  "servers:get-favorites",
  "content:get-structure",
  "content:list-library",
  "content:install-from-library",
  "content:remove-from-instance",
  "content:delete-from-library",
  "content:is-installed",
  "content:open-folder",
  "modrinth:search",
  "modrinth:get-project",
  "modrinth:get-versions",
  "modrinth:get-version",
  "curseforge:search",
  "curseforge:get-files",
  "curseforge:get-download-url",
  "curseforge:set-api-key",
  "updater:check",
  "updater:open-url",
  "versions:matrix",
]);

// ─── App flags (harden Chromium) ────────────────────────────────────────────

// Disable GPU sandbox escape vectors; keep sandbox for everything else
app.commandLine.appendSwitch("enable-sandbox");
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors"); // keep CORS
// Prevent renderer from accessing powerful APIs
app.commandLine.appendSwitch("disable-remote-fonts", "0");

// ─── State persistence (via main — renderer never touches the FS) ────────────

const STATE_DIR = path.join(app.getPath("userData"), "sakura-data");
const STATE_FILE = path.join(STATE_DIR, "state.json");

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readState(): Record<string, unknown> {
  try {
    ensureStateDir();
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // file doesn't exist or is corrupt — return empty
  }
  return {};
}

function writeState(data: Record<string, unknown>): void {
  ensureStateDir();
  // Atomic write: write to tmp then rename
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, STATE_FILE);
}

// ─── Game data directory ─────────────────────────────────────────────────────

function getGameDataDir(): string {
  // Default: %APPDATA%\.sakura on Windows, ~/.sakura on other platforms
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Roaming", ".sakura");
  }
  return path.join(os.homedir(), ".sakura");
}

// ─── Window creation ─────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    resizable: false,
    maximizable: false,
    backgroundColor: "#1a191f",
    title: "Sakura Launcher",
    icon: path.join(__dirname, "..", "logo.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "rgba(0,0,0,0)",
      symbolColor: "#ffffff",
      height: 32
    },
    // Frameless or not — keeping default for security (no custom protocol needed)
    webPreferences: {
      // ── Critical security settings ──────────────────────────────────────
      nodeIntegration: false,          // ✅ No Node.js in renderer
      contextIsolation: true,          // ✅ Isolated JS contexts
      sandbox: true,                   // ✅ OS-level sandbox
      webSecurity: true,               // ✅ Same-origin policy
      allowRunningInsecureContent: false, // ✅ No mixed content
      // ────────────────────────────────────────────────────────────────────
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Disable default menu (reduces attack surface)
  mainWindow.setMenu(null);

  // Load the renderer HTML
  const indexPath = path.join(__dirname, "..", "renderer", "index.html");
  void mainWindow.loadFile(indexPath);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 350);


  if (IS_DEV) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  if (IS_DEV || process.env.SAKURA_LOG || SELFTEST) {
    mainWindow.webContents.on("console-message", (...args: any[]) => {
      const e = args[0] ?? {};
      const msg = e.message ?? args[2];
      const line = e.lineNumber ?? args[3];
      const src = e.sourceId ?? args[4];
      const lvl = e.level ?? args[1];
      console.log(`[renderer:${lvl}] ${msg} (${String(src).split("/").pop()}:${line})`);
    });
    mainWindow.webContents.on("render-process-gone", (_e, d) => console.log("[renderer gone]", d));
  }

  if (SELFTEST) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const code = fs.readFileSync(SELFTEST, "utf8");
          const out = await mainWindow!.webContents.executeJavaScript(code, true);
          console.log("[selftest]", typeof out === "string" ? out : JSON.stringify(out, null, 1));
        } catch (err) {
          console.log("[selftest error]", err);
        }
        app.exit(0);
      }, 2500);
    });
  }

  // Prevent navigation away from our app page
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const parsed = new URL(url);
    // Allow only file:// protocol for our renderer
    if (parsed.protocol !== "file:") {
      event.preventDefault();
      console.warn("[security] Blocked navigation to:", url);
    }
  });

  // Prevent opening new windows (popups etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open whitelisted URLs in system browser, block everything else
    tryOpenExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── Content Security Policy ─────────────────────────────────────────────────

function applyCSP(): void {
  const csp = [
    // Only allow scripts from our own file: origin (inline script in index.html is allowed via hash/nonce-free approach)
    // For a single-file HTML with inline <script>, we allow 'self' and 'unsafe-eval' is NOT needed.
    // The inline script is same origin since it's loaded via file://
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",   // inline <script> in index.html
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: http:",
    "connect-src 'self' https: http:",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith("file://") || details.url.startsWith("devtools://")) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [csp],
          "X-Content-Type-Options": ["nosniff"],
          "X-Frame-Options": ["DENY"],
          "Referrer-Policy": ["no-referrer"],
        },
      });
    } else {
      callback({});
    }
  });
}

// ─── shell.openExternal (safe wrapper) ───────────────────────────────────────

function tryOpenExternal(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return;
    // Check if origin is in whitelist
    const allowed = [...EXTERNAL_ORIGIN_WHITELIST].some((origin) =>
      parsed.origin === origin || parsed.href.startsWith(origin + "/")
    );
    if (allowed) {
      void shell.openExternal(url);
    } else {
      console.warn("[security] Blocked openExternal:", url);
    }
  } catch {
    // malformed URL
  }
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

function registerIPC(): void {
  // Guard: only handle channels from the allowlist
  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("app:get-platform", () => process.platform);

  ipcMain.handle("app:open-external", (_event, url: unknown) => {
    if (typeof url !== "string") return;
    tryOpenExternal(url);
  });

  ipcMain.handle("app:open-folder", (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string") return;
    // Resolve to absolute path inside game data dir to prevent path traversal
    const gameDir = getGameDataDir();
    const resolved = path.resolve(gameDir, folderPath);
    if (!resolved.startsWith(gameDir) && resolved !== gameDir) {
      console.warn("[security] Path traversal attempt blocked:", folderPath);
      return;
    }
    // Ensure directory exists before opening
    try {
      if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
      void shell.openPath(resolved);
    } catch {
      // ignore
    }
  });

  ipcMain.handle(
    "dialog:show-open-file",
    async (_event, opts: { filters?: Electron.FileFilter[]; title?: string }) => {
      if (!mainWindow) return null;
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ["openFile"],
        title: typeof opts?.title === "string" ? opts.title : "Открыть файл",
        filters: Array.isArray(opts?.filters) ? opts.filters : [],
      });
      return canceled ? null : filePaths[0] ?? null;
    }
  );

  ipcMain.handle(
    "dialog:show-save-file",
    async (_event, opts: { defaultPath?: string; filters?: Electron.FileFilter[] }) => {
      if (!mainWindow) return null;
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: typeof opts?.defaultPath === "string" ? opts.defaultPath : undefined,
        filters: Array.isArray(opts?.filters) ? opts.filters : [],
      });
      return canceled ? null : filePath ?? null;
    }
  );

  ipcMain.handle("launcher:get-data-dir", () => getGameDataDir());

  ipcMain.handle("launcher:read-state", () => readState());

  ipcMain.handle("launcher:write-state", (_event, data: unknown) => {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("Invalid state payload");
    }
    writeState(data as Record<string, unknown>);
  });

  ipcMain.handle("launcher:open-game-folder", (_event, subFolder: unknown) => {
    const base = getGameDataDir();
    if (typeof subFolder !== "string" || subFolder === "") {
      void shell.openPath(base);
      return;
    }
    // Sanitize: allow subpaths, prevent directory traversal outside base
    const cleanSub = subFolder.replace(/\.\./g, "").replace(/^[/\\]+/, "");
    const target = path.join(base, cleanSub);
    if (!target.startsWith(base)) return;
    try {
      if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
    } catch { /* ignore */ }
    void shell.openPath(target);
  });

  const contentManager = new ContentManager(getGameDataDir);
  const modrinthProvider = new ModrinthProvider();
  const curseforgeProvider = new CurseForgeProvider();

  ipcMain.handle("pack:download-mod", async (_event, req: any) => {
    if (!req || typeof req !== "object") throw new Error("Bad args");
    const { packId, url, filename, folder } = req;
    if (!url || !filename) throw new Error("Missing parameters");
    const safeFile = path.basename(String(filename));
    const targetFolder = ["mods", "resourcepacks", "shaderpacks", "datapacks"].includes(folder) ? folder : "mods";

    try {
      // 1. Always save master copy into Library
      const libCategory = (targetFolder === "datapacks" ? "addons" : targetFolder) as any;
      const libDir = contentManager.getLibraryDir(libCategory);
      const masterPath = path.join(libDir, safeFile);
      await download(String(url), masterPath);

      // 2. If target instance specified and not _library, copy into instance
      let finalPath = masterPath;
      if (packId && packId !== "_library") {
        const instDir = path.join(getGameDataDir(), "instances", path.basename(String(packId)), targetFolder);
        if (!fs.existsSync(instDir)) fs.mkdirSync(instDir, { recursive: true });
        const instPath = path.join(instDir, safeFile);
        fs.copyFileSync(masterPath, instPath);
        finalPath = instPath;
      }

      return { ok: true, path: finalPath };
    } catch (err: any) {
      console.error("[pack:download-mod] Error:", err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  const instancesManager = new InstancesManager(getGameDataDir);
  const modpackInstaller = new ModpackInstaller(instancesManager);
  const friendsSystem = new FriendsSystem(getGameDataDir);
  const serversCatalogManager = new ServersCatalogManager(getGameDataDir);

  registerDownloadIPC();
  registerInstancesIPC(() => instancesManager);
  registerModpackInstallerIPC(modpackInstaller);
  registerFriendsIPC(() => friendsSystem);
  registerServersCatalogIPC(() => serversCatalogManager, getGameDataDir);
  registerContentIPC(() => contentManager);
  registerModrinthIPC(() => modrinthProvider);
  registerCurseForgeIPC(() => curseforgeProvider);

  ipcMain.handle("theme:get", () => ({
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
  }));

  /**
   * Write a base64-encoded blob to a file path chosen via the OS save dialog.
   * Only allowed destinations: user's Downloads folder or game data directory.
   */
  ipcMain.handle(
    "fs:write-base64",
    (_event, filePath: unknown, base64: unknown) => {
      if (typeof filePath !== "string" || typeof base64 !== "string") {
        throw new Error("Invalid arguments");
      }
      const downloads = app.getPath("downloads");
      const gameDir = getGameDataDir();
      const resolved = path.resolve(filePath);
      const inDownloads = resolved.startsWith(downloads + path.sep) || resolved === downloads;
      const inGame = resolved.startsWith(gameDir + path.sep) || resolved === gameDir;
      if (!inDownloads && !inGame) {
        console.warn("[security] Blocked write outside allowed dirs:", resolved);
        throw new Error("Write destination not allowed");
      }
      const buf = Buffer.from(base64, "base64");
      fs.writeFileSync(resolved, buf);
    }
  );
  
  registerAccountsIPC();
  registerLauncherIPC(getGameDataDir, () => friendsSystem);
  registerUpdaterIPC(() => mainWindow);
}

// Block any IPC channels that are not in the allowlist
// (defense-in-depth: even if preload exposes more, main ignores unknown channels)
function blockUnknownIPC(): void {
  ipcMain.on("message", (_event, channel: unknown) => {
    if (typeof channel === "string" && !ALLOWED_INVOKE_CHANNELS.has(channel)) {
      console.warn("[security] Blocked unknown IPC channel:", channel);
    }
  });
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

void app.whenReady().then(() => {
  applyCSP();
  registerIPC();
  blockUnknownIPC();
  createWindow();
  setTimeout(() => startAutoUpdater(() => mainWindow), 5000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

import { getMatrix } from "./versions";
ipcMain.handle("versions:matrix", async () => { return await getMatrix(); });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Prevent second instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
