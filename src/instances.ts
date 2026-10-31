/**
 * Instances Manager for Sakura Launcher
 * Provides isolated directories, manifest tracking, components management,
 * import/export, and duplication.
 */
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { dialog, ipcMain } from "electron";
import { download, getJson } from "./net";

export interface InstanceManifestComponent {
  id: string;
  name: string;
  filename: string;
  type: "mod" | "resourcepack" | "shaderpack" | "datapack";
  source?: "mr" | "cf" | "manual";
  version?: string;
  url?: string;
  enabled: boolean;
  size?: number;
  dateAdded: number;
}

export interface InstanceMetadata {
  id: string;
  name: string;
  desc: string;
  v: string; // Minecraft version
  l: string; // Loader: Fabric, Forge, NeoForge, Vanilla
  loaderVersion?: string;
  jvmArgs?: string;
  memoryMax?: number;
  playtimeMinutes?: number;
  lastPlayed?: number;
  createdAt: number;
}

export interface InstanceSummary extends InstanceMetadata {
  dir: string;
  modsCount: number;
  mods?: Array<{ t: string; id?: string }>;
  resourcePacksCount: number;
  shaderPacksCount: number;
  savesCount: number;
}

export class InstancesManager {
  private baseDir: string;

  constructor(getBaseDir: () => string) {
    this.baseDir = path.join(getBaseDir(), "instances");
    this.ensureBase();
  }

  private ensureBase() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  public getInstancePath(packId: string): string {
    const cleanId = path.basename(packId);
    return path.join(this.baseDir, cleanId);
  }

  public list(): InstanceSummary[] {
    this.ensureBase();
    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    const list: InstanceSummary[] = [];

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const instDir = path.join(this.baseDir, ent.name);
      const metaFile = path.join(instDir, "instance.json");
      let meta: Partial<InstanceMetadata> = {};
      if (fs.existsSync(metaFile)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        } catch {}
      }

      const countFiles = (folder: string) => {
        const fp = path.join(instDir, folder);
        if (!fs.existsSync(fp)) return 0;
        try {
          return fs.readdirSync(fp).filter((f) => !f.endsWith(".part") && !f.endsWith(".tmp")).length;
        } catch {
          return 0;
        }
      };

      const stat = fs.statSync(instDir);
      list.push({
        id: ent.name,
        name: meta.name || ent.name,
        desc: meta.desc || "Изолированная сборка",
        v: meta.v || "1.21.4",
        l: meta.l || "Fabric",
        loaderVersion: meta.loaderVersion || "",
        jvmArgs: meta.jvmArgs || "",
        memoryMax: meta.memoryMax || 4,
        playtimeMinutes: meta.playtimeMinutes || 0,
        lastPlayed: meta.lastPlayed || 0,
        createdAt: meta.createdAt || stat.birthtimeMs || stat.mtimeMs,
        dir: instDir,
        modsCount: countFiles("mods"),
        mods: Array(countFiles("mods")).fill({ t: "Локальный мод", id: "" }),
        resourcePacksCount: countFiles("resourcepacks"),
        shaderPacksCount: countFiles("shaderpacks"),
        savesCount: countFiles("saves"),
      });
    }

    return list.sort((a, b) => (b.lastPlayed || b.createdAt) - (a.lastPlayed || a.createdAt));
  }

  public create(opts: {
    id: string;
    name: string;
    desc?: string;
    v: string;
    l: string;
    loaderVersion?: string;
    jvmArgs?: string;
  }): boolean {
    this.ensureBase();
    const safeId = path.basename(opts.id);
    const instDir = path.join(this.baseDir, safeId);
    if (fs.existsSync(instDir)) return false;

    // Create required standard directories
    const dirs = [
      "mods",
      "resourcepacks",
      "shaderpacks",
      "config",
      "defaultconfigs",
      "saves",
      "screenshots",
      "logs",
      "crash-reports",
    ];

    for (const d of dirs) {
      fs.mkdirSync(path.join(instDir, d), { recursive: true });
    }

    const meta: InstanceMetadata = {
      id: safeId,
      name: opts.name || safeId,
      desc: opts.desc || "",
      v: opts.v || "1.21.4",
      l: opts.l || "Fabric",
      loaderVersion: opts.loaderVersion || "",
      jvmArgs: opts.jvmArgs || "",
      createdAt: Date.now(),
    };

    fs.writeFileSync(path.join(instDir, "instance.json"), JSON.stringify(meta, null, 2), "utf8");
    fs.writeFileSync(path.join(instDir, "manifest.json"), JSON.stringify({ components: [] }, null, 2), "utf8");

    return true;
  }

  public delete(packId: string): boolean {
    const instDir = this.getInstancePath(packId);
    if (!fs.existsSync(instDir)) return false;
    try {
      fs.rmSync(instDir, { recursive: true, force: true });
      return true;
    } catch (e) {
      console.error("Failed to remove instance folder:", e);
      return false;
    }
  }

  public rename(packId: string, newName: string, newDesc?: string): boolean {
    const instDir = this.getInstancePath(packId);
    const metaFile = path.join(instDir, "instance.json");
    if (!fs.existsSync(metaFile)) return false;
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      meta.name = newName;
      if (newDesc !== undefined) meta.desc = newDesc;
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  public duplicate(packId: string, newId: string, newName: string): boolean {
    const srcDir = this.getInstancePath(packId);
    const destDir = this.getInstancePath(newId);
    if (!fs.existsSync(srcDir) || fs.existsSync(destDir)) return false;

    try {
      fs.cpSync(srcDir, destDir, { recursive: true });
      const metaFile = path.join(destDir, "instance.json");
      if (fs.existsSync(metaFile)) {
        const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
        meta.id = path.basename(newId);
        meta.name = newName;
        meta.createdAt = Date.now();
        fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf8");
      }
      return true;
    } catch (e) {
      console.error("Duplicate failed:", e);
      return false;
    }
  }

  public getComponents(packId: string, type?: "mods" | "resourcepacks" | "shaderpacks"): Array<{
    filename: string;
    name: string;
    folder: string;
    size: number;
    enabled: boolean;
    mtime: number;
  }> {
    const instDir = this.getInstancePath(packId);
    if (!fs.existsSync(instDir)) return [];

    const folders = type ? [type] : ["mods", "resourcepacks", "shaderpacks"];
    const results: any[] = [];

    for (const fld of folders) {
      const targetDir = path.join(instDir, fld);
      if (!fs.existsSync(targetDir)) continue;
      try {
        const files = fs.readdirSync(targetDir);
        for (const file of files) {
          if (file.endsWith(".part") || file.endsWith(".tmp")) continue;
          const fullPath = path.join(targetDir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) continue;

          const isEnabled = !file.endsWith(".disabled");
          const cleanName = file.replace(/\.disabled$/, "").replace(/\.(jar|zip)$/i, "");

          results.push({
            filename: file,
            name: cleanName,
            folder: fld,
            size: stat.size,
            enabled: isEnabled,
            mtime: stat.mtimeMs,
          });
        }
      } catch {}
    }

    return results;
  }

  public toggleComponent(packId: string, folder: string, filename: string): boolean {
    const instDir = this.getInstancePath(packId);
    const targetDir = path.join(instDir, folder);
    const curPath = path.join(targetDir, filename);
    if (!fs.existsSync(curPath)) return false;

    const newName = filename.endsWith(".disabled")
      ? filename.replace(/\.disabled$/, "")
      : filename + ".disabled";
    const newPath = path.join(targetDir, newName);

    try {
      fs.renameSync(curPath, newPath);
      return true;
    } catch {
      return false;
    }
  }

  public deleteComponent(packId: string, folder: string, filename: string): boolean {
    const instDir = this.getInstancePath(packId);
    const targetPath = path.join(instDir, folder, filename);
    if (!fs.existsSync(targetPath)) return false;
    try {
      fs.unlinkSync(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  public exportInstance(packId: string, outZipPath: string): boolean {
    const instDir = this.getInstancePath(packId);
    if (!fs.existsSync(instDir)) return false;

    try {
      const zip = new AdmZip();
      const exportDirs = ["mods", "resourcepacks", "shaderpacks", "config", "defaultconfigs"];
      for (const d of exportDirs) {
        const fullD = path.join(instDir, d);
        if (fs.existsSync(fullD)) {
          zip.addLocalFolder(fullD, d);
        }
      }
      const metaFile = path.join(instDir, "instance.json");
      if (fs.existsSync(metaFile)) {
        zip.addLocalFile(metaFile, "", "instance.json");
      }
      zip.writeZip(outZipPath);
      return true;
    } catch (e) {
      console.error("Export instance failed:", e);
      return false;
    }
  }

  public async importInstance(archivePath: string, customName?: string): Promise<{ ok: boolean; id?: string; name?: string; error?: string }> {
    if (!fs.existsSync(archivePath)) return { ok: false, error: "Файл архива не найден" };
    try {
      const zip = new AdmZip(archivePath);
      const zipEntries = zip.getEntries();

      let packName = customName || path.basename(archivePath, path.extname(archivePath));
      let mcVer = "1.21.4";
      let loader = "Fabric";
      let desc = "Импортированная сборка";

      // Check for modrinth.index.json
      const mrIndexEntry = zipEntries.find((e) => e.entryName === "modrinth.index.json");
      if (mrIndexEntry) {
        try {
          const mrData = JSON.parse(zip.readAsText(mrIndexEntry));
          if (mrData.name) packName = mrData.name;
          if (mrData.summary) desc = mrData.summary;
          if (mrData.dependencies?.minecraft) mcVer = mrData.dependencies.minecraft;
          if (mrData.dependencies?.["fabric-loader"]) loader = "Fabric";
          else if (mrData.dependencies?.["forge"]) loader = "Forge";
          else if (mrData.dependencies?.["neoforge"]) loader = "NeoForge";
          else if (mrData.dependencies?.["quilt-loader"]) loader = "Quilt";
        } catch {}
      }

      // Check for instance.json
      const instJsonEntry = zipEntries.find((e) => e.entryName === "instance.json");
      if (instJsonEntry) {
        try {
          const instData = JSON.parse(zip.readAsText(instJsonEntry));
          if (instData.name) packName = instData.name;
          if (instData.desc) desc = instData.desc;
          if (instData.v) mcVer = instData.v;
          if (instData.l) loader = instData.l;
        } catch {}
      }

      let safePackId = packName.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32);
      if (!safePackId || !safePackId.replace(/_/g, "")) safePackId = "imported_" + Date.now();
      let targetDir = path.join(this.baseDir, safePackId);
      let counter = 1;
      while (fs.existsSync(targetDir)) {
        targetDir = path.join(this.baseDir, `${safePackId}_${counter++}`);
      }
      safePackId = path.basename(targetDir);

      fs.mkdirSync(targetDir, { recursive: true });
      const resolvedTarget = path.resolve(targetDir);

      // If .mrpack, overrides/ folder should be extracted to root and files downloaded
      if (mrIndexEntry) {
        for (const entry of zipEntries) {
          const normName = entry.entryName.replace(/\\/g, "/");
          if ((normName.startsWith("overrides/") || normName.startsWith("client-overrides/")) && !entry.isDirectory) {
            const relPath = normName.replace(/^(overrides|client-overrides)\//, "");
            const outPath = path.resolve(targetDir, relPath);
            if (!outPath.startsWith(resolvedTarget + path.sep)) continue;
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, entry.getData());
          }
        }
        try {
          const mrData = JSON.parse(zip.readAsText(mrIndexEntry));
          if (Array.isArray(mrData.files)) {
            for (const f of mrData.files) {
              if (f.path && Array.isArray(f.downloads) && f.downloads[0]) {
                const normPath = String(f.path).replace(/\\/g, "/");
                const outPath = path.resolve(targetDir, normPath);
                if (!outPath.startsWith(resolvedTarget + path.sep)) continue;
                if (!fs.existsSync(outPath)) {
                  try {
                    await download(f.downloads[0], outPath);
                  } catch (e) {
                    console.warn("[mrpack] Could not download mod:", f.path, e);
                  }
                }
              }
            }
          }
        } catch {}
      } else {
        // Standard zip extraction with path validation (Zip Slip safe)
        for (const entry of zipEntries) {
          if (entry.isDirectory) continue;
          const outPath = path.resolve(targetDir, entry.entryName);
          if (!outPath.startsWith(resolvedTarget + path.sep)) continue;
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, entry.getData());
        }
      }

      // Ensure instance.json exists
      const metaPath = path.join(targetDir, "instance.json");
      if (!fs.existsSync(metaPath)) {
        const meta: InstanceMetadata = {
          id: safePackId,
          name: packName,
          desc,
          v: mcVer,
          l: loader,
          createdAt: Date.now(),
        };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
      }

      // Ensure required folders exist
      for (const d of ["mods", "config", "resourcepacks", "shaderpacks", "saves"]) {
        const dp = path.join(targetDir, d);
        if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
      }

      return { ok: true, id: safePackId, name: packName };
    } catch (err: any) {
      console.error("[Instances] Import error:", err);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  public async installOptimizationPreset(
    packId: string,
    version: string,
    loader: string
  ): Promise<{ ok: boolean; installed: string[]; error?: string }> {
    const instDir = this.getInstancePath(packId);
    if (!fs.existsSync(instDir)) return { ok: false, installed: [], error: "Сборка не найдена" };
    const modsDir = path.join(instDir, "mods");
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

    const isFabric = loader.toLowerCase().includes("fabric") || loader.toLowerCase().includes("quilt");
    const slugs = isFabric
      ? ["sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast"]
      : ["embeddium", "ferrite-core", "modernfix"];

    const existingJars = fs.readdirSync(modsDir).map((f) => f.toLowerCase());
    const installed: string[] = [];
    for (const slug of slugs) {
      const cleanSlug = slug.replace(/[^a-z0-9]/g, "");
      const alreadyHas = existingJars.some(
        (f) => f.includes(cleanSlug) && (f.endsWith(".jar") || f.endsWith(".jar.disabled"))
      );
      if (alreadyHas) {
        installed.push(`${slug} (уже установлен)`);
        continue;
      }
      try {
        const ldr = isFabric ? "fabric" : (loader.toLowerCase().includes("neoforge") ? "neoforge" : "forge");
        const url = `https://api.modrinth.com/v2/project/${slug}/version?game_versions=[%22${encodeURIComponent(version)}%22]&loaders=[%22${ldr}%22]`;
        const vers = await getJson<any[]>(url, { headers: { "User-Agent": "SakuraLauncher" } }, 8000);
        if (Array.isArray(vers) && vers.length > 0) {
          const ver = vers[0];
          const primaryFile = ver.files?.find((f: any) => f.primary) || ver.files?.[0];
          if (primaryFile && primaryFile.url) {
            const dest = path.join(modsDir, primaryFile.filename);
            if (!fs.existsSync(dest)) {
              await download(primaryFile.url, dest);
              installed.push(primaryFile.filename);
            }
          }
        }
      } catch (e: any) {
        console.warn(`[Preset] Failed to install ${slug}:`, e?.message || e);
      }
    }

    return { ok: installed.length > 0, installed };
  }
}

export function registerInstancesIPC(getInstanceMgr: () => InstancesManager) {
  ipcMain.handle("instances:list", () => getInstanceMgr().list());
  ipcMain.handle("instances:create", (_e, opts: any) => getInstanceMgr().create(opts));
  ipcMain.handle("instances:delete", (_e, packId: string) => getInstanceMgr().delete(packId));
  ipcMain.handle("instances:get-mods", (_e, packId: string) => getInstanceMgr().getComponents(packId, "mods"));
  ipcMain.handle("instances:delete-mod", (_e, req: any) => {
    if (!req || typeof req !== "object") return false;
    return getInstanceMgr().deleteComponent(req.packId, "mods", req.filename);
  });
  ipcMain.handle("instances:rename", (_e, { packId, newName, newDesc }: any) => getInstanceMgr().rename(packId, newName, newDesc));
  ipcMain.handle("instances:duplicate", (_e, { packId, newId, newName }: any) => getInstanceMgr().duplicate(packId, newId, newName));
  ipcMain.handle("instances:get-components", (_e, { packId, type }: any) => getInstanceMgr().getComponents(packId, type));
  ipcMain.handle("instances:toggle-component", (_e, { packId, folder, filename }: any) => getInstanceMgr().toggleComponent(packId, folder, filename));
  ipcMain.handle("instances:delete-component", (_e, { packId, folder, filename }: any) => getInstanceMgr().deleteComponent(packId, folder, filename));
  ipcMain.handle("instances:export", (_e, { packId, outZipPath }: any) => getInstanceMgr().exportInstance(packId, outZipPath));
  ipcMain.handle("instances:import", (_e, { archivePath, name }: any) => getInstanceMgr().importInstance(archivePath, name));
  ipcMain.handle("instances:install-fps-preset", (_e, { packId, version, loader }: any) => getInstanceMgr().installOptimizationPreset(packId, version, loader));

  ipcMain.handle("instances:export-dialog", async (_e, { packId, defaultName }: any) => {
    const res = await dialog.showSaveDialog({
      title: "Экспорт сборки",
      defaultPath: `${defaultName || packId}.zip`,
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const success = getInstanceMgr().exportInstance(packId, res.filePath);
    return { ok: success, path: res.filePath };
  });

  ipcMain.handle("instances:import-dialog", async () => {
    const res = await dialog.showOpenDialog({
      title: "Импорт сборки Minecraft",
      filters: [{ name: "Minecraft Modpack / ZIP", extensions: ["zip", "mrpack"] }],
      properties: ["openFile"],
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    return await getInstanceMgr().importInstance(res.filePaths[0]);
  });
}
