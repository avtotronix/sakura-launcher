/**
 * Sakura Launcher — Preload script
 *
 * Runs in a privileged context with access to ipcRenderer,
 * but exposes ONLY a minimal typed API to the renderer via contextBridge.
 *
 * The renderer NEVER gets direct access to ipcRenderer, Node.js, or Electron APIs.
 */

import { contextBridge, ipcRenderer } from "electron";

// ─── Type-safe channel allowlist ─────────────────────────────────────────────

/** Channels the renderer is allowed to invoke (request/response) */
const INVOKE_CHANNELS = [
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
  "versions:matrix",
  "game:launch",
  "pack:download-mod",
  "instances:list",
  "instances:create",
  "instances:delete",
  "instances:get-mods",
  "instances:delete-mod",
  "updater:check",
  "updater:open-url",
] as const;

type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

function safeInvoke(channel: InvokeChannel, ...args: unknown[]): Promise<unknown> {
  // Belt-and-suspenders: verify channel at runtime
  if (!(INVOKE_CHANNELS as readonly string[]).includes(channel)) {
    return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

// ─── Public API exposed to renderer ──────────────────────────────────────────

export interface SakuraAPI {
  /** App version string */
  getVersion(): Promise<string>;
  /** OS platform identifier */
  getPlatform(): Promise<string>;

  /**
   * Open a URL in the system browser.
   * Main process only allows whitelisted HTTPS origins.
   */
  openExternal(url: string): Promise<void>;

  /**
   * Open a sub-folder inside the game data directory.
   * Empty string or omitting opens the root game folder.
   */
  openGameFolder(subFolder?: string): Promise<void>;

  /** Read launcher state from disk (returns {} on first run) */
  readState(): Promise<Record<string, unknown>>;

  /**
   * Persist launcher state to disk.
   * Main process performs an atomic write (tmp → rename).
   */
  writeState(data: Record<string, unknown>): Promise<void>;

  /** Absolute path to the game data directory */
  getDataDir(): Promise<string>;

  /** List of installed versions from disk */
  getInstalledVersions(): Promise<string[]>;

  /** Show OS file-open dialog; returns selected path or null */
  showOpenFile(opts?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;

  /** Show OS save-as dialog; returns target path or null */
  showSaveFile(opts?: {
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;

  /**
   * Write base64-encoded data to a file path.
   * Main process validates the path is within Downloads or game data dir.
   */
  writeBase64(filePath: string, base64: string): Promise<void>;

  /** Current OS-level dark-mode preference */
  getTheme(): Promise<{ shouldUseDarkColors: boolean }>;

  /** Accounts API */
  accountsList(): Promise<any>;
  accountsSelect(id: string): Promise<any>;
  accountsRemove(id: string): Promise<any>;
  accountsAddOffline(nick: string): Promise<any>;
  accountsAddMicrosoft(): Promise<any>;
  accountsAddElyby(login: string, password?: string, totp?: string): Promise<any>;
  accountsGoogle(): Promise<any>;
  accountsGoogleLogout(): Promise<any>;
  accountsRegisterEly(): Promise<any>;
  versionsMatrix(): Promise<any>;
  
  /** Launch Minecraft */
  launchMinecraft(opts: any): Promise<any>;
  downloadModToPack(packId: string, url: string, filename: string): Promise<any>;
  listInstances(): Promise<any[]>;
  createInstance(opts: { id: string; name: string; desc?: string; v: string; l: string }): Promise<boolean>;
  deleteInstance(packId: string): Promise<boolean>;
  getPackMods(packId: string): Promise<any[]>;
  deletePackMod(packId: string, filename: string): Promise<boolean>;

  /** Listen for launcher events */
  onLauncherEvent(channel: 'log' | 'progress', callback: (data: any) => void): void;

  /** Updater API */
  checkForUpdates(): Promise<any>;
  openUpdateUrl(url: string): Promise<boolean>;
  onUpdateAvailable(callback: (info: any) => void): void;
}

const sakuraAPI: SakuraAPI = {
  getVersion: () => safeInvoke("app:get-version") as Promise<string>,

  getPlatform: () => safeInvoke("app:get-platform") as Promise<string>,

  openExternal: (url: string) => {
    if (typeof url !== "string") return Promise.resolve();
    return safeInvoke("app:open-external", url) as Promise<void>;
  },

  openGameFolder: (subFolder?: string) =>
    safeInvoke("launcher:open-game-folder", subFolder ?? "") as Promise<void>,

  readState: () =>
    safeInvoke("launcher:read-state") as Promise<Record<string, unknown>>,

  writeState: (data: Record<string, unknown>) => {
    if (typeof data !== "object" || data === null) return Promise.resolve();
    return safeInvoke("launcher:write-state", data) as Promise<void>;
  },

  getDataDir: () =>
    safeInvoke("launcher:get-data-dir") as Promise<string>,

  getInstalledVersions: () =>
    safeInvoke("launcher:get-installed") as Promise<string[]>,

  showOpenFile: (opts?) =>
    safeInvoke("dialog:show-open-file", opts ?? {}) as Promise<string | null>,

  showSaveFile: (opts?) =>
    safeInvoke("dialog:show-save-file", opts ?? {}) as Promise<string | null>,

  writeBase64: (filePath: string, base64: string) =>
    safeInvoke("fs:write-base64", filePath, base64) as Promise<void>,

  getTheme: () =>
    safeInvoke("theme:get") as Promise<{ shouldUseDarkColors: boolean }>,

  accountsList: () => safeInvoke("accounts:list"),
  accountsSelect: (id) => safeInvoke("accounts:select", id),
  accountsRemove: (id) => safeInvoke("accounts:remove", id),
  accountsAddOffline: (nick) => safeInvoke("accounts:add-offline", nick),
  accountsAddMicrosoft: () => safeInvoke("accounts:add-microsoft"),
  accountsAddElyby: (login, password, totp) => safeInvoke("accounts:add-elyby", login, password, totp),
  accountsGoogle: () => safeInvoke("accounts:google"),
  accountsGoogleLogout: () => safeInvoke("accounts:google-logout"),
  accountsRegisterEly: () => safeInvoke("accounts:register-ely"),

  versionsMatrix: () => safeInvoke("versions:matrix"),
  launchMinecraft: (opts) => safeInvoke("game:launch", opts),
  downloadModToPack: (packId: string, url: string, filename: string) =>
    safeInvoke("pack:download-mod", { packId, url, filename }) as Promise<{ ok: boolean; path: string }>,
  listInstances: () => safeInvoke("instances:list") as Promise<any[]>,
  createInstance: (opts: { id: string; name: string; desc?: string; v: string; l: string }) =>
    safeInvoke("instances:create", opts) as Promise<boolean>,
  deleteInstance: (packId: string) => safeInvoke("instances:delete", packId) as Promise<boolean>,
  getPackMods: (packId: string) => safeInvoke("instances:get-mods", packId) as Promise<any[]>,
  deletePackMod: (packId: string, filename: string) => safeInvoke("instances:delete-mod", { packId, filename }) as Promise<boolean>,
  onLauncherEvent: (channel, callback) => {
    ipcRenderer.on(`game:${channel}`, (_event, data) => callback(data));
    ipcRenderer.on(`launcher:${channel}`, (_event, data) => callback(data));
  },
  checkForUpdates: () => safeInvoke("updater:check"),
  openUpdateUrl: (url: string) => safeInvoke("updater:open-url", url) as Promise<boolean>,
  onUpdateAvailable: (callback: (info: any) => void) => {
    ipcRenderer.on("app:update-available", (_event, data) => callback(data));
  }
};

// Expose under window.sakura — deliberately NOT window.electron to avoid
// confusing with older patterns that had full Electron access.
contextBridge.exposeInMainWorld("sakura", sakuraAPI);
