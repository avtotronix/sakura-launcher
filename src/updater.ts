/**
 * Sakura Launcher — Auto Updater
 *
 * Checks a remote version endpoint (e.g. GitHub Releases raw JSON or custom URL),
 * compares with local semver version, and notifies the renderer when an update is available.
 */
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { getJson } from "./net";

export interface RemoteVersionInfo {
  version: string;
  title?: string;
  changelog?: string;
  downloadUrl?: string;
  mandatory?: boolean;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  title: string;
  changelog: string;
  downloadUrl: string;
  mandatory: boolean;
}

function parseVersion(v: string): number[] {
  const clean = v.replace(/^[^0-9]+/, "").split("-")[0];
  return clean.split(".").map((n) => parseInt(n, 10) || 0);
}

export function isNewerVersion(remote: string, current: string): boolean {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  const len = Math.max(r.length, c.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0;
    const cv = c[i] ?? 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

/**
 * URL for version check.
 * Can be overridden via env SAKURA_UPDATE_URL.
 * Owners can host a simple version.json file on GitHub (raw.githubusercontent.com) or any HTTPS server.
 */
const DEFAULT_UPDATE_URL =
  process.env.SAKURA_UPDATE_URL ||
  "https://raw.githubusercontent.com/SakuraLauncher/releases/main/version.json";

let lastResult: UpdateCheckResult | null = null;
let updateTimer: NodeJS.Timeout | null = null;

export async function checkUpdate(url = DEFAULT_UPDATE_URL): Promise<UpdateCheckResult> {
  const current = app.getVersion();
  try {
    const data = await getJson<RemoteVersionInfo>(url);
    if (!data || !data.version) {
      throw new Error("Неверный формат ответа сервера обновлений");
    }

    const hasUpdate = isNewerVersion(data.version, current);
    lastResult = {
      hasUpdate,
      currentVersion: current,
      latestVersion: data.version,
      title: data.title || `Версия ${data.version}`,
      changelog: data.changelog || "Улучшения стабильности и исправления ошибок.",
      downloadUrl: data.downloadUrl || "https://github.com/",
      mandatory: Boolean(data.mandatory),
    };
    return lastResult;
  } catch (err: any) {
    return {
      hasUpdate: false,
      currentVersion: current,
      latestVersion: current,
      title: "",
      changelog: "",
      downloadUrl: "",
      mandatory: false,
    };
  }
}

export function startAutoUpdater(getWin: () => BrowserWindow | null) {
  // First check 5 seconds after startup
  setTimeout(async () => {
    try {
      const res = await checkUpdate();
      if (res.hasUpdate) {
        const win = getWin();
        if (win && !win.isDestroyed()) {
          win.webContents.send("app:update-available", res);
        }
      }
    } catch {}
  }, 5000);

  // Periodic check every 15 minutes (15 * 60 * 1000)
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(async () => {
    try {
      const res = await checkUpdate();
      if (res.hasUpdate) {
        const win = getWin();
        if (win && !win.isDestroyed()) {
          win.webContents.send("app:update-available", res);
        }
      }
    } catch {}
  }, 15 * 60 * 1000);
}

export function registerUpdaterIPC(getWin: () => BrowserWindow | null) {
  ipcMain.handle("updater:check", async () => {
    const res = await checkUpdate();
    if (res.hasUpdate) {
      const win = getWin();
      if (win && !win.isDestroyed()) {
        win.webContents.send("app:update-available", res);
      }
    }
    return res;
  });

  ipcMain.handle("updater:open-url", (_event, url: unknown) => {
    if (typeof url === "string" && url.startsWith("https://")) {
      void shell.openExternal(url);
      return true;
    }
    return false;
  });
}
