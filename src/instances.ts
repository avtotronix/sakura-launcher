/**
 * Instances Manager for Sakura Launcher
 * Provides isolated directories, manifest tracking, components management,
 * import/export, and duplication.
 */
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { ipcMain } from "electron";

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
}
