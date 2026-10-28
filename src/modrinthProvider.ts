/**
 * Modrinth Provider for Sakura Minecraft Launcher
 * Provides official Modrinth v2 API integration, caching, project searching,
 * version retrieval, dependencies resolution, and modpack indexing.
 */
import { ipcMain } from "electron";
import { getJson } from "./net";

const BASE_URL = "https://api.modrinth.com/v2";
const HORIZON_REGISTRY_URL = "https://horizon-rust.github.io/horizon-mods/index.json";

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

  private async getHorizonRegistryProjects(): Promise<any[]> {
    const cached = this.getCached<any[]>("horizon:registry");
    if (cached) return cached;
    try {
      const idx = await getJson<any>(HORIZON_REGISTRY_URL);
      const list = Array.isArray(idx?.projects) ? idx.projects : [];
      this.setCached("horizon:registry", list, 10 * 60 * 1000);
      return list;
    } catch {
      return [];
    }
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
    const loaderLower = (opts.loader || "").toLowerCase();
    const isHorizon = loaderLower === "horizon";

    const facets: string[][] = [];
    facets.push([`project_type:${pt}`]);

    if (opts.gameVersion && pt === "mod") {
      if (opts.gameVersion.startsWith("26.") || isHorizon) {
        facets.push([
          `versions:${opts.gameVersion}`,
          "versions:26.3",
          "versions:26.2",
          "versions:1.21.4",
          "versions:1.21.1",
        ]);
      } else {
        facets.push([`versions:${opts.gameVersion}`]);
      }
    }

    if (opts.loader && pt === "mod" && loaderLower !== "vanilla") {
      if (isHorizon) {
        facets.push([
          "categories:fabric",
          "categories:neoforge",
          "categories:forge",
          "categories:quilt",
        ]);
      } else {
        facets.push([`categories:${loaderLower}`]);
      }
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
      let horizonHits: ModrinthProjectHit[] = [];
      if (pt === "mod" && (isHorizon || opts.gameVersion === "26.3") && offset === 0) {
        const reg = await this.getHorizonRegistryProjects();
        const qLow = q.toLowerCase();
        horizonHits = reg
          .filter((p: any) => p.kind === "mod")
          .filter((p: any) => {
            if (!qLow) return true;
            const text = `${p.id} ${p.name} ${p.summary || ""} ${p.description || ""}`.toLowerCase();
            return text.includes(qLow);
          })
          .map((p: any) => ({
            id: `hmod:${p.id}`,
            slug: p.id,
            title: `${p.name} (Horizon .hmod)`,
            description: p.summary || p.description || "Нативный WASM-мод для Horizon 26.3",
            categories: ["horizon", "utility"],
            clientSide: "required",
            serverSide: "optional",
            projectType: "mod" as const,
            downloads: p.downloads || 1000,
            iconUrl: p.icon || null,
            author: (Array.isArray(p.authors) && p.authors[0]) || "Horizon",
            versions: ["26.3"],
            latestVersion: p.versions?.[0]?.version || "1.0.0",
            dateCreated: p.versions?.[0]?.published || "",
            dateModified: p.versions?.[0]?.published || "",
          }));
      }

      const res = await getJson<any>(`${BASE_URL}/search?${queryParams.toString()}`);
      const mrHits: ModrinthProjectHit[] = (res.hits || []).map((h: any) => ({
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

      const hits = [...horizonHits, ...mrHits];
      const out = {
        hits,
        totalHits: (res.total_hits || 0) + horizonHits.length,
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

    const cleanHmodId = idOrSlug.startsWith("hmod:") ? idOrSlug.slice(5) : idOrSlug;
    const isHorizonReq =
      idOrSlug.startsWith("hmod:") ||
      (Array.isArray(loaders) && loaders.some((l) => l.toLowerCase() === "horizon"));

    if (isHorizonReq) {
      const reg = await this.getHorizonRegistryProjects();
      const found = reg.find((p: any) => p.id === cleanHmodId);
      if (found && Array.isArray(found.versions) && found.versions.length > 0) {
        const hMapped: ModrinthVersion[] = found.versions
          .filter((v: any) => v.file && v.file.url && v.file.name)
          .map((v: any) => ({
            id: `${found.id}-${v.version}`,
            projectId: `hmod:${found.id}`,
            name: `${found.name} ${v.version}`,
            versionNumber: v.version,
            gameVersions: [v.game || "26.3"],
            loaders: ["horizon"],
            featured: true,
            files: [
              {
                url: v.file.url,
                filename: v.file.name,
                primary: true,
                size: v.file.size || 0,
                hashes: { sha1: "", sha512: "" },
              },
            ],
            dependencies: [],
            datePublished: v.published || "",
            changelog: v.changelog || "",
          }));
        if (hMapped.length > 0) {
          this.setCached(key, hMapped);
          return hMapped;
        }
      }
    }

    let normalizedLoaders: string[] | undefined;
    if (Array.isArray(loaders) && loaders.length > 0) {
      const lower = loaders.map((l) => l.toLowerCase());
      if (lower.includes("horizon")) {
        normalizedLoaders = ["fabric", "neoforge", "forge", "quilt"];
      } else {
        normalizedLoaders = lower;
      }
    }

    const fetchVersions = async (ld?: string[], gv?: string[]): Promise<ModrinthVersion[]> => {
      const params = new URLSearchParams();
      if (Array.isArray(ld) && ld.length > 0) {
        params.set("loaders", JSON.stringify(ld));
      }
      if (Array.isArray(gv) && gv.length > 0) {
        params.set("game_versions", JSON.stringify(gv));
      }
      const qs = params.toString();
      const url = `${BASE_URL}/project/${encodeURIComponent(cleanHmodId)}/version${qs ? `?${qs}` : ""}`;
      const res = await getJson<any[]>(url);
      return (res || []).map((v: any) => ({
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
    };

    try {
      let mapped = await fetchVersions(normalizedLoaders, gameVersions);
      if (
        mapped.length === 0 &&
        Array.isArray(gameVersions) &&
        gameVersions.some((v) => v.startsWith("26."))
      ) {
        mapped = await fetchVersions(normalizedLoaders, ["26.3", "26.2", "1.21.4", "1.21.1"]);
      }
      if (mapped.length === 0 && normalizedLoaders) {
        mapped = await fetchVersions(normalizedLoaders, undefined);
      }
      if (mapped.length === 0) {
        mapped = await fetchVersions(undefined, undefined);
      }

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
