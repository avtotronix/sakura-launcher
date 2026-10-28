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
/**
 * URL for version check.
 * Checks the official GitHub Releases endpoint for avtotronix/sakura-launcher.
 */
const GITHUB_API_URL = "https://api.github.com/repos/avtotronix/sakura-launcher/releases/latest";

let lastResult: UpdateCheckResult | null = null;
let updateTimer: NodeJS.Timeout | null = null;

export async function checkUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion();
  try {
    const data = await getJson<any>(GITHUB_API_URL, {
      headers: {
        "User-Agent": "SakuraLauncher",
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!data || !data.tag_name) {
      throw new Error("Неверный ответ GitHub API");
    }

    const latestVer = String(data.tag_name).replace(/^v/i, "").trim();
    const hasUpdate = isNewerVersion(latestVer, current);

    // Look for installer asset or portable asset
    let downloadUrl = data.html_url;
    if (Array.isArray(data.assets)) {
      const installer = data.assets.find((a: any) =>
        a.name && a.name.toLowerCase().includes("installer") && a.name.endsWith(".exe")
      );
      if (installer && installer.browser_download_url) {
        downloadUrl = installer.browser_download_url;
      }
    }

    lastResult = {
      hasUpdate,
      currentVersion: current,
      latestVersion: latestVer,
      title: data.name || `Обновление v${latestVer}`,
      changelog: data.body || "Улучшения стабильности и исправления ошибок.",
      downloadUrl: downloadUrl || "https://github.com/avtotronix/sakura-launcher/releases/latest",
      mandatory: false,
    };
    return lastResult;
  } catch (err: any) {
    console.warn("[updater] Check failed:", err.message || err);
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
