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
  renameInstance(packId: string, newName: string, newDesc?: string): Promise<boolean>;
  duplicateInstance(packId: string, newId: string, newName: string): Promise<boolean>;
  getInstanceComponents(packId: string, type?: string): Promise<any[]>;
  toggleInstanceComponent(packId: string, folder: string, filename: string): Promise<boolean>;
  deleteInstanceComponent(packId: string, folder: string, filename: string): Promise<boolean>;
  exportInstance(packId: string, outZipPath: string): Promise<boolean>;

  /** Download Manager API */
  getDownloads(): Promise<any[]>;
  cancelDownload(id: string): Promise<boolean>;
  retryDownload(id: string): Promise<boolean>;
  clearDownloads(): Promise<boolean>;
  enqueueDownload(req: {
    name: string;
    type: string;
    url: string;
    dest: string;
    targetPackId?: string;
    expectedHash?: { algo: string; hash: string };
  }): Promise<string>;
  onDownloadProgress(callback: (task: any) => void): void;
  onDownloadCompleted(callback: (task: any) => void): void;
  onDownloadFailed(callback: (task: any) => void): void;

  /** Modpack Installer */
  installMrpack(url: string, packName: string): Promise<{ ok: boolean; instanceId?: string; error?: string }>;
  onModpackProgress(callback: (data: { stage: string; pct: number }) => void): void;

  /** Friends & Presence API */
  getFriendsState(): Promise<any>;
  updateFriendProfile(update: any): Promise<boolean>;
  sendFriendRequest(target: string): Promise<{ ok: boolean; error?: string }>;
  acceptFriendRequest(reqId: string): Promise<boolean>;
  declineFriendRequest(reqId: string): Promise<boolean>;
  removeFriend(friendId: string): Promise<boolean>;
  onFriendsUpdate(callback: (state: any) => void): void;

  /** Servers Catalog API */
  queryServers(opts?: {
    search?: string;
    mode?: string;
    platform?: string;
    version?: string;
    favoritesOnly?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{ servers: any[]; total: number; page: number; totalPages: number }>;
  toggleServerFavorite(id: string): Promise<boolean>;
  getServerFavorites(): Promise<string[]>;

  /** Content & Unified Library API */
  contentGetStructure(): Promise<{ root: string }>;
  contentListLibrary(category: string): Promise<any[]>;
  contentInstallFromLibrary(category: string, filename: string, instanceId: string): Promise<boolean>;
  contentRemoveFromInstance(category: string, filename: string, instanceId: string): Promise<boolean>;
  contentDeleteFromLibrary(category: string, filename: string): Promise<boolean>;
  contentIsInstalled(category: string, filename: string, targetInstanceId?: string): Promise<boolean>;
  contentOpenFolder(subPath?: string): Promise<boolean>;

  /** Modrinth Provider API */
  modrinthSearch(opts: any): Promise<any>;
  modrinthGetProject(idOrSlug: string): Promise<any>;
  modrinthGetVersions(idOrSlug: string, loaders?: string[], gameVersions?: string[]): Promise<any[]>;
  modrinthGetVersion(versionId: string): Promise<any>;

  /** CurseForge Provider API */
  curseforgeSearch(opts: any): Promise<any>;
  curseforgeGetFiles(modId: string | number, gameVersion?: string, loader?: string): Promise<any[]>;
  curseforgeGetDownloadUrl(modId: string | number, fileId: string | number): Promise<string | null>;
  curseforgeSetApiKey(key: string): Promise<boolean>;

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
  downloadModToPack: (packId: string, url: string, filename: string, folder?: string) =>
    safeInvoke("pack:download-mod", { packId, url, filename, folder }) as Promise<{ ok: boolean; path: string }>,
  listInstances: () => safeInvoke("instances:list") as Promise<any[]>,
  createInstance: (opts: { id: string; name: string; desc?: string; v: string; l: string }) =>
    safeInvoke("instances:create", opts) as Promise<boolean>,
  deleteInstance: (packId: string) => safeInvoke("instances:delete", packId) as Promise<boolean>,
  getPackMods: (packId: string) => safeInvoke("instances:get-mods", packId) as Promise<any[]>,
  deletePackMod: (packId: string, filename: string) => safeInvoke("instances:delete-mod", { packId, filename }) as Promise<boolean>,
  renameInstance: (packId: string, newName: string, newDesc?: string) =>
    safeInvoke("instances:rename", { packId, newName, newDesc }) as Promise<boolean>,
  duplicateInstance: (packId: string, newId: string, newName: string) =>
    safeInvoke("instances:duplicate", { packId, newId, newName }) as Promise<boolean>,
  getInstanceComponents: (packId: string, type?: string) =>
    safeInvoke("instances:get-components", { packId, type }) as Promise<any[]>,
  toggleInstanceComponent: (packId: string, folder: string, filename: string) =>
    safeInvoke("instances:toggle-component", { packId, folder, filename }) as Promise<boolean>,
  deleteInstanceComponent: (packId: string, folder: string, filename: string) =>
    safeInvoke("instances:delete-component", { packId, folder, filename }) as Promise<boolean>,
  exportInstance: (packId: string, outZipPath: string) =>
    safeInvoke("instances:export", { packId, outZipPath }) as Promise<boolean>,

  // Download Manager
  getDownloads: () => safeInvoke("downloads:list") as Promise<any[]>,
  cancelDownload: (id: string) => safeInvoke("downloads:cancel", id) as Promise<boolean>,
  retryDownload: (id: string) => safeInvoke("downloads:retry", id) as Promise<boolean>,
  clearDownloads: () => safeInvoke("downloads:clear") as Promise<boolean>,
  enqueueDownload: (req: any) => safeInvoke("downloads:enqueue", req) as Promise<string>,
  onDownloadProgress: (cb: (t: any) => void) => {
    ipcRenderer.on("download:progress", (_e, data) => cb(data));
  },
  onDownloadCompleted: (cb: (t: any) => void) => {
    ipcRenderer.on("download:completed", (_e, data) => cb(data));
  },
  onDownloadFailed: (cb: (t: any) => void) => {
    ipcRenderer.on("download:failed", (_e, data) => cb(data));
  },

  // Modpack
  installMrpack: (url: string, packName: string) =>
    safeInvoke("modpack:install-mrpack", { url, packName }) as Promise<any>,
  onModpackProgress: (cb: (data: any) => void) => {
    ipcRenderer.on("modpack:install-progress", (_e, data) => cb(data));
  },

  // Friends & Presence
  getFriendsState: () => safeInvoke("friends:get-state") as Promise<any>,
  updateFriendProfile: (update: any) => safeInvoke("friends:update-profile", update) as Promise<boolean>,
  sendFriendRequest: (target: string) => safeInvoke("friends:send-request", target) as Promise<any>,
  acceptFriendRequest: (reqId: string) => safeInvoke("friends:accept-request", reqId) as Promise<boolean>,
  declineFriendRequest: (reqId: string) => safeInvoke("friends:decline-request", reqId) as Promise<boolean>,
  removeFriend: (friendId: string) => safeInvoke("friends:remove-friend", friendId) as Promise<boolean>,
  onFriendsUpdate: (cb: (s: any) => void) => {
    ipcRenderer.on("friends:update", (_e, data) => cb(data));
  },

  // Servers
  queryServers: (opts?: any) => safeInvoke("servers:query", opts || {}) as Promise<any>,
  toggleServerFavorite: (id: string) => safeInvoke("servers:toggle-favorite", id) as Promise<boolean>,
  getServerFavorites: () => safeInvoke("servers:get-favorites") as Promise<string[]>,

  // Content & Unified Library
  contentGetStructure: () => safeInvoke("content:get-structure") as Promise<any>,
  contentListLibrary: (category: string) => safeInvoke("content:list-library", category) as Promise<any[]>,
  contentInstallFromLibrary: (category: string, filename: string, instanceId: string) =>
    safeInvoke("content:install-from-library", { category, filename, instanceId }) as Promise<boolean>,
  contentRemoveFromInstance: (category: string, filename: string, instanceId: string) =>
    safeInvoke("content:remove-from-instance", { category, filename, instanceId }) as Promise<boolean>,
  contentDeleteFromLibrary: (category: string, filename: string) =>
    safeInvoke("content:delete-from-library", { category, filename }) as Promise<boolean>,
  contentIsInstalled: (category: string, filename: string, targetInstanceId?: string) =>
    safeInvoke("content:is-installed", { category, filename, targetInstanceId }) as Promise<boolean>,
  contentOpenFolder: (subPath?: string) => safeInvoke("content:open-folder", subPath) as Promise<boolean>,

  // Modrinth Provider
  modrinthSearch: (opts: any) => safeInvoke("modrinth:search", opts) as Promise<any>,
  modrinthGetProject: (idOrSlug: string) => safeInvoke("modrinth:get-project", idOrSlug) as Promise<any>,
  modrinthGetVersions: (idOrSlug: string, loaders?: string[], gameVersions?: string[]) =>
    safeInvoke("modrinth:get-versions", { idOrSlug, loaders, gameVersions }) as Promise<any[]>,
  modrinthGetVersion: (versionId: string) => safeInvoke("modrinth:get-version", versionId) as Promise<any>,

  // CurseForge Provider
  curseforgeSearch: (opts: any) => safeInvoke("curseforge:search", opts) as Promise<any>,
  curseforgeGetFiles: (modId: any, gameVersion?: string, loader?: string) =>
    safeInvoke("curseforge:get-files", { modId, gameVersion, loader }) as Promise<any[]>,
  curseforgeGetDownloadUrl: (modId: any, fileId: any) =>
    safeInvoke("curseforge:get-download-url", { modId, fileId }) as Promise<string | null>,
  curseforgeSetApiKey: (key: string) => safeInvoke("curseforge:set-api-key", key) as Promise<boolean>,
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
