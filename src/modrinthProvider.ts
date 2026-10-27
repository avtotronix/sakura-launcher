/**
 * Modrinth Provider for Sakura Minecraft Launcher
 * Provides official Modrinth v2 API integration, caching, project searching,
 * version retrieval, dependencies resolution, and modpack indexing.
 */
import { ipcMain } from "electron";
import { getJson } from "./net";

const BASE_URL = "https://api.modrinth.com/v2";

export interface ModrinthProjectHit {
  id: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  clientSide: string;
  serverSide: string;
  projectType: "mod" | "resourcepack" | "shader" | "datapack" | "modpack";
  downloads: number;
  iconUrl: string | null;
  author: string;
  versions: string[];
  latestVersion?: string;
  dateCreated: string;
  dateModified: string;
}

export interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  hashes: { sha1: string; sha512: string };
}

export interface ModrinthVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  featured: boolean;
  files: ModrinthVersionFile[];
  dependencies: Array<{
    versionId: string | null;
    projectId: string | null;
    fileName: string | null;
    dependencyType: "required" | "optional" | "incompatible" | "embedded";
  }>;
  datePublished: string;
  changelog?: string;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class ModrinthProvider {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes cache

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

  /**
   * Search Modrinth projects with faceted filters.
   */
  public async searchProjects(opts: {
    query?: string;
    projectType?: "mod" | "resourcepack" | "shader" | "datapack" | "modpack";
    gameVersion?: string;
    loader?: string;
    categories?: string[];
    index?: "relevance" | "downloads" | "follows" | "newest" | "updated";
    offset?: number;
    limit?: number;
  }): Promise<{ hits: ModrinthProjectHit[]; totalHits: number; offset: number; limit: number }> {
    const q = (opts.query || "").trim();
    const pt = opts.projectType || "mod";
    const index = opts.index || (q ? "relevance" : "downloads");
    const offset = Math.max(0, opts.offset || 0);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));

    const facets: string[][] = [];
    facets.push([`project_type:${pt}`]);

    if (opts.gameVersion && pt === "mod") {
      facets.push([`versions:${opts.gameVersion}`]);
    }

    if (opts.loader && pt === "mod" && opts.loader.toLowerCase() !== "vanilla") {
      facets.push([`categories:${opts.loader.toLowerCase()}`]);
    }

    if (Array.isArray(opts.categories) && opts.categories.length > 0) {
      for (const cat of opts.categories) {
        facets.push([`categories:${cat}`]);
      }
    }

    const cacheKey = `search:${pt}:${q}:${opts.gameVersion}:${opts.loader}:${opts.categories?.join(",")}:${index}:${offset}:${limit}`;
    const cached = this.getCached<any>(cacheKey);
    if (cached) return cached;

    const queryParams = new URLSearchParams({
      query: q,
      facets: JSON.stringify(facets),
      index,
      offset: String(offset),
      limit: String(limit),
    });

    try {
      const res = await getJson<any>(`${BASE_URL}/search?${queryParams.toString()}`);
      const hits: ModrinthProjectHit[] = (res.hits || []).map((h: any) => ({
        id: h.project_id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        categories: h.categories || [],
        clientSide: h.client_side,
        serverSide: h.server_side,
        projectType: h.project_type,
        downloads: h.downloads || 0,
        iconUrl: h.icon_url || null,
        author: h.author,
        versions: h.versions || [],
        latestVersion: h.latest_version,
        dateCreated: h.date_created,
        dateModified: h.date_modified,
      }));

      const out = {
        hits,
        totalHits: res.total_hits || 0,
        offset,
        limit,
      };

      this.setCached(cacheKey, out);
      return out;
    } catch (err: any) {
      console.warn("Modrinth search failed:", err);
      return { hits: [], totalHits: 0, offset, limit };
    }
  }

  /**
   * Get project details by ID or Slug.
   */
  public async getProject(idOrSlug: string): Promise<any | null> {
    const key = `project:${idOrSlug}`;
    const cached = this.getCached<any>(key);
    if (cached) return cached;

    try {
      const res = await getJson<any>(`${BASE_URL}/project/${encodeURIComponent(idOrSlug)}`);
      this.setCached(key, res);
      return res;
    } catch {
      return null;
    }
  }

  /**
   * Get compatible project versions.
   */
  public async getProjectVersions(
    idOrSlug: string,
    loaders?: string[],
    gameVersions?: string[]
  ): Promise<ModrinthVersion[]> {
    const key = `versions:${idOrSlug}:${loaders?.join(",")}:${gameVersions?.join(",")}`;
    const cached = this.getCached<ModrinthVersion[]>(key);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (Array.isArray(loaders) && loaders.length > 0) {
      params.set("loaders", JSON.stringify(loaders.map(l => l.toLowerCase())));
    }
    if (Array.isArray(gameVersions) && gameVersions.length > 0) {
      params.set("game_versions", JSON.stringify(gameVersions));
    }

    try {
      const qs = params.toString();
      const url = `${BASE_URL}/project/${encodeURIComponent(idOrSlug)}/version${qs ? `?${qs}` : ""}`;
      const res = await getJson<any[]>(url);
      const mapped: ModrinthVersion[] = (res || []).map((v: any) => ({
        id: v.id,
        projectId: v.project_id,
        name: v.name,
        versionNumber: v.version_number,
        gameVersions: v.game_versions || [],
        loaders: v.loaders || [],
        featured: !!v.featured,
        files: (v.files || []).map((f: any) => ({
          url: f.url,
          filename: f.filename,
          primary: !!f.primary,
          size: f.size || 0,
          hashes: f.hashes || {},
        })),
        dependencies: (v.dependencies || []).map((d: any) => ({
          versionId: d.version_id || null,
          projectId: d.project_id || null,
          fileName: d.file_name || null,
          dependencyType: d.dependency_type || "optional",
        })),
        datePublished: v.date_published,
        changelog: v.changelog,
      }));

      this.setCached(key, mapped);
      return mapped;
    } catch {
      return [];
    }
  }

  /**
   * Get single version by ID.
   */
  public async getVersion(versionId: string): Promise<ModrinthVersion | null> {
    const key = `version:${versionId}`;
    const cached = this.getCached<ModrinthVersion>(key);
    if (cached) return cached;

    try {
      const v = await getJson<any>(`${BASE_URL}/version/${encodeURIComponent(versionId)}`);
      const mapped: ModrinthVersion = {
        id: v.id,
        projectId: v.project_id,
        name: v.name,
        versionNumber: v.version_number,
        gameVersions: v.game_versions || [],
        loaders: v.loaders || [],
        featured: !!v.featured,
        files: (v.files || []).map((f: any) => ({
          url: f.url,
          filename: f.filename,
          primary: !!f.primary,
          size: f.size || 0,
          hashes: f.hashes || {},
        })),
        dependencies: (v.dependencies || []).map((d: any) => ({
          versionId: d.version_id || null,
          projectId: d.project_id || null,
          fileName: d.file_name || null,
          dependencyType: d.dependency_type || "optional",
        })),
        datePublished: v.date_published,
        changelog: v.changelog,
      };

      this.setCached(key, mapped);
      return mapped;
    } catch {
      return null;
    }
  }
}

export function registerModrinthIPC(getProvider: () => ModrinthProvider) {
  ipcMain.handle("modrinth:search", (_e, opts: any) => {
    return getProvider().searchProjects(opts);
  });
  ipcMain.handle("modrinth:get-project", (_e, idOrSlug: string) => {
    return getProvider().getProject(idOrSlug);
  });
  ipcMain.handle("modrinth:get-versions", (_e, { idOrSlug, loaders, gameVersions }: any) => {
    return getProvider().getProjectVersions(idOrSlug, loaders, gameVersions);
  });
  ipcMain.handle("modrinth:get-version", (_e, versionId: string) => {
    return getProvider().getVersion(versionId);
  });
}
