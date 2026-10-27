/**
 * CurseForge Provider for Sakura Minecraft Launcher
 * Provides official CurseForge v1 API integration, secure key configuration,
 * class ID mapping, caching, and download URL resolution.
 */
import { ipcMain } from "electron";
import { getJson } from "./net";

const BASE_URL = "https://api.curseforge.com/v1";
const DEFAULT_KEY = "$2a$10$v/nb3RPgkpaiHiIDVjykhusULrRjahh8fEugJrQ/njdfZzDvId8sa";

export type CurseForgeContentType = "mod" | "resourcepack" | "shader" | "datapack" | "modpack";

const CLASS_IDS: Record<CurseForgeContentType, number> = {
  mod: 6,
  resourcepack: 12,
  shader: 6552,
  datapack: 6945,
  modpack: 4471,
};

const LOADER_TYPES: Record<string, number> = {
  forge: 1,
  cauldron: 2,
  liteloader: 3,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

export interface CurseForgeHit {
  id: string;
  name: string;
  summary: string;
  downloadCount: number;
  iconUrl: string | null;
  websiteUrl: string | null;
  authors: string[];
  categories: string[];
  dateModified: string;
  latestFiles: Array<{
    id: number;
    gameVersion: string[];
    fileName: string;
    downloadUrl: string;
    fileLength: number;
  }>;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class CurseForgeProvider {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTTL = 5 * 60 * 1000;
  private apiKey: string = DEFAULT_KEY;

  public setApiKey(key: string): void {
    if (key && key.trim()) {
      this.apiKey = key.trim();
    } else {
      this.apiKey = DEFAULT_KEY;
    }
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCached<T>(key: string, data: T, ttlMs = this.defaultTTL): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  private getHeaders(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "Accept": "application/json",
    };
  }

  public async search(opts: {
    query?: string;
    contentType?: CurseForgeContentType;
    gameVersion?: string;
    loader?: string;
    sortField?: number; // 1: Featured, 2: Popularity, 3: LastUpdated, 4: Name, 5: TotalDownloads
    offset?: number;
    pageSize?: number;
  }): Promise<{ hits: CurseForgeHit[]; totalCount: number; offset: number; pageSize: number }> {
    const q = (opts.query || "").trim();
    const type = opts.contentType || "mod";
    const classId = CLASS_IDS[type] || 6;
    const offset = Math.max(0, opts.offset || 0);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize || 20));
    const sortField = opts.sortField || (q ? 2 : 6); // 2: Popularity, 6: Downloads

    const params = new URLSearchParams({
      gameId: "432",
      classId: String(classId),
      searchFilter: q,
      sortField: String(sortField),
      sortOrder: "desc",
      pageSize: String(pageSize),
      index: String(offset),
    });

    if (opts.gameVersion && type === "mod") {
      params.set("gameVersion", opts.gameVersion);
    }

    if (opts.loader && type === "mod") {
      const lt = LOADER_TYPES[opts.loader.toLowerCase()];
      if (lt) params.set("modLoaderType", String(lt));
    }

    const cacheKey = `cf:search:${type}:${q}:${opts.gameVersion}:${opts.loader}:${sortField}:${offset}:${pageSize}`;
    const cached = this.getCached<any>(cacheKey);
    if (cached) return cached;

    try {
      const url = `${BASE_URL}/mods/search?${params.toString()}`;
      const res = await getJson<any>(url, { headers: this.getHeaders() });
      const hits: CurseForgeHit[] = (res.data || []).map((h: any) => ({
        id: String(h.id),
        name: h.name,
        summary: h.summary || "",
        downloadCount: h.downloadCount || 0,
        iconUrl: h.logo?.thumbnailUrl || null,
        websiteUrl: h.links?.websiteUrl || null,
        authors: (h.authors || []).map((a: any) => a.name),
        categories: (h.categories || []).map((c: any) => c.name),
        dateModified: h.dateModified,
        latestFiles: (h.latestFiles || []).map((f: any) => ({
          id: f.id,
          gameVersion: f.gameVersions || [],
          fileName: f.fileName,
          downloadUrl: f.downloadUrl,
          fileLength: f.fileLength || 0,
        })),
      }));

      const out = {
        hits,
        totalCount: res.pagination?.totalCount || 0,
        offset,
        pageSize,
      };

      this.setCached(cacheKey, out);
      return out;
    } catch (err: any) {
      console.warn("CurseForge search error:", err);
      return { hits: [], totalCount: 0, offset, pageSize };
    }
  }

  public async getModFiles(
    modId: string | number,
    gameVersion?: string,
    loader?: string
  ): Promise<any[]> {
    const key = `cf:files:${modId}:${gameVersion}:${loader}`;
    const cached = this.getCached<any[]>(key);
    if (cached) return cached;

    const params = new URLSearchParams({ pageSize: "50" });
    if (gameVersion) params.set("gameVersion", gameVersion);
    if (loader) {
      const lt = LOADER_TYPES[loader.toLowerCase()];
      if (lt) params.set("modLoaderType", String(lt));
    }

    try {
      const url = `${BASE_URL}/mods/${encodeURIComponent(modId)}/files?${params.toString()}`;
      const res = await getJson<any>(url, { headers: this.getHeaders() });
      const data = res.data || [];
      this.setCached(key, data);
      return data;
    } catch {
      return [];
    }
  }

  public async getDownloadUrl(modId: string | number, fileId: string | number): Promise<string | null> {
    try {
      const url = `${BASE_URL}/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}/download-url`;
      const res = await getJson<any>(url, { headers: this.getHeaders() });
      return res.data || null;
    } catch {
      return null;
    }
  }
}

export function registerCurseForgeIPC(getProvider: () => CurseForgeProvider) {
  ipcMain.handle("curseforge:search", (_e, opts: any) => {
    return getProvider().search(opts);
  });
  ipcMain.handle("curseforge:get-files", (_e, { modId, gameVersion, loader }: any) => {
    return getProvider().getModFiles(modId, gameVersion, loader);
  });
  ipcMain.handle("curseforge:get-download-url", (_e, { modId, fileId }: any) => {
    return getProvider().getDownloadUrl(modId, fileId);
  });
  ipcMain.handle("curseforge:set-api-key", (_e, key: string) => {
    getProvider().setApiKey(key);
    return true;
  });
}
