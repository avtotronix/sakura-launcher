/**
 * Content Manager for Sakura Minecraft Launcher
 * Implements the Unified Data Architecture:
 * LauncherData/
 * ├── Downloads/
 * │   ├── temporary/
 * │   └── cache/
 * ├── Library/
 * │   ├── mods/
 * │   ├── resourcepacks/
 * │   ├── shaderpacks/
 * │   ├── addons/
 * │   └── modpacks/
 * ├── Instances/
 * │   └── MyModpack/
 * ├── Profiles/
 * ├── Database/
 * └── Logs/
 *
 * Rules:
 * - Library is the single shared library of all downloaded content.
 * - Instances are independent playable game assemblies.
 * - Master copies reside in Library; instances get copies/hardlinks.
 * - Deleting from an instance does not delete the master library copy.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ipcMain, shell } from "electron";
import { safeName } from "./net";

export type ContentCategory = "mods" | "resourcepacks" | "shaderpacks" | "addons" | "modpacks";

export interface LibraryItem {
  filename: string;
  name: string;
  category: ContentCategory;
  size: number;
  mtime: number;
  sha1?: string;
  installedInstances: string[];
}

export class ContentManager {
  constructor(private getBaseDataDir: () => string) {
    this.ensureStructure();
  }

  public getRoot(): string {
    return this.getBaseDataDir();
  }

  public ensureStructure(): void {
    const root = this.getRoot();
    const dirs = [
      path.join(root, "Downloads", "temporary"),
      path.join(root, "Downloads", "cache"),
      path.join(root, "Library", "mods"),
      path.join(root, "Library", "resourcepacks"),
      path.join(root, "Library", "shaderpacks"),
      path.join(root, "Library", "addons"),
      path.join(root, "Library", "modpacks"),
      path.join(root, "Instances"),
      path.join(root, "Profiles"),
      path.join(root, "Database"),
      path.join(root, "Logs"),
    ];
    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
      }
    }
  }

  public getLibraryDir(category: ContentCategory): string {
    this.ensureStructure();
    return path.join(this.getRoot(), "Library", category);
  }

  public getTemporaryDownloadDir(): string {
    this.ensureStructure();
    return path.join(this.getRoot(), "Downloads", "temporary");
  }

  public getInstancesDir(): string {
    this.ensureStructure();
    return path.join(this.getRoot(), "Instances");
  }

  public getInstanceDir(instanceId: string): string {
    return path.join(this.getInstancesDir(), path.basename(instanceId));
  }

  private mapCategoryToInstanceFolder(category: ContentCategory): string {
    switch (category) {
      case "mods": return "mods";
      case "resourcepacks": return "resourcepacks";
      case "shaderpacks": return "shaderpacks";
      case "addons": return "datapacks";
      default: return "mods";
    }
  }

  /**
   * Save a file into the Library master store, and optionally install it into an instance.
   */
  public saveToLibrary(
    category: ContentCategory,
    filename: string,
    sourceFilePath: string,
    targetInstanceId?: string
  ): { ok: boolean; libraryPath: string; instancePath?: string } {
    this.ensureStructure();
    const cleanFile = safeName(filename);
    const libDir = this.getLibraryDir(category);
    const libPath = path.join(libDir, cleanFile);

    // Copy or move into Library
    if (sourceFilePath !== libPath) {
      fs.copyFileSync(sourceFilePath, libPath);
    }

    let instancePath: string | undefined;
    if (targetInstanceId && targetInstanceId !== "_library") {
      const instFolder = this.mapCategoryToInstanceFolder(category);
      const instDir = path.join(this.getInstanceDir(targetInstanceId), instFolder);
      if (!fs.existsSync(instDir)) fs.mkdirSync(instDir, { recursive: true });
      instancePath = path.join(instDir, cleanFile);
      fs.copyFileSync(libPath, instancePath);
      this.recordInManifest(targetInstanceId, category, cleanFile);
    }

    return { ok: true, libraryPath: libPath, instancePath };
  }

  /**
   * Install an existing item from the Library into an instance.
   */
  public installFromLibrary(
    category: ContentCategory,
    filename: string,
    targetInstanceId: string
  ): boolean {
    const cleanFile = safeName(filename);
    const libPath = path.join(this.getLibraryDir(category), cleanFile);
    if (!fs.existsSync(libPath)) return false;

    const instFolder = this.mapCategoryToInstanceFolder(category);
    const instDir = path.join(this.getInstanceDir(targetInstanceId), instFolder);
    if (!fs.existsSync(instDir)) fs.mkdirSync(instDir, { recursive: true });

    const destPath = path.join(instDir, cleanFile);
    fs.copyFileSync(libPath, destPath);
    this.recordInManifest(targetInstanceId, category, cleanFile);
    return true;
  }

  /**
   * Remove a file from an instance without deleting the master copy in Library.
   */
  public removeFromInstance(
    category: ContentCategory,
    filename: string,
    targetInstanceId: string
  ): boolean {
    const cleanFile = safeName(filename);
    const instFolder = this.mapCategoryToInstanceFolder(category);
    const targetFile = path.join(this.getInstanceDir(targetInstanceId), instFolder, cleanFile);
    const disabledFile = targetFile + ".disabled";

    let removed = false;
    if (fs.existsSync(targetFile)) {
      try { fs.unlinkSync(targetFile); removed = true; } catch {}
    } else if (fs.existsSync(disabledFile)) {
      try { fs.unlinkSync(disabledFile); removed = true; } catch {}
    }
    return removed;
  }

  /**
   * Delete a master item from the Library (only if user explicitly requests library cleanup).
   */
  public deleteFromLibrary(category: ContentCategory, filename: string): boolean {
    const cleanFile = safeName(filename);
    const libPath = path.join(this.getLibraryDir(category), cleanFile);
    let removed = false;
    if (fs.existsSync(libPath)) {
      try { fs.unlinkSync(libPath); removed = true; } catch {}
    }
    const instFolder = this.mapCategoryToInstanceFolder(category);
    const rootFile = path.join(this.getRoot(), instFolder, cleanFile);
    if (fs.existsSync(rootFile)) {
      try { fs.unlinkSync(rootFile); removed = true; } catch {}
    }
    if (fs.existsSync("D:\\.sakura")) {
      const dFile = path.join("D:\\.sakura", instFolder, cleanFile);
      if (fs.existsSync(dFile)) {
        try { fs.unlinkSync(dFile); removed = true; } catch {}
      }
    }
    return removed;
  }

  /**
   * List all items in a Library category, noting which instances they are currently installed in.
   */
  public listLibrary(category: ContentCategory): LibraryItem[] {
    const libDir = this.getLibraryDir(category);
    if (!fs.existsSync(libDir)) return [];

    const instDir = this.getInstancesDir();
    const instFolder = this.mapCategoryToInstanceFolder(category);
    let allInstances: string[] = [];
    try {
      if (fs.existsSync(instDir)) {
        allInstances = fs.readdirSync(instDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
      }
    } catch {}

    const items: LibraryItem[] = [];
    try {
      const files = fs.readdirSync(libDir);
      for (const f of files) {
        if (f.endsWith(".part") || f.endsWith(".tmp")) continue;
        const fullPath = path.join(libDir, f);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) continue;

          // Check which instances contain this file
          const installedIn: string[] = [];
          for (const inst of allInstances) {
            const inInst = path.join(instDir, inst, instFolder, f);
            const inInstDis = path.join(instDir, inst, instFolder, f + ".disabled");
            if (fs.existsSync(inInst) || fs.existsSync(inInstDis)) {
              installedIn.push(inst);
            }
          }

          const cleanTitle = f.replace(/\.(jar|zip|disabled)$/i, "");
          items.push({
            filename: f,
            name: cleanTitle,
            category,
            size: stat.size,
            mtime: stat.mtimeMs,
            installedInstances: installedIn,
          });
        } catch {}
      }
    } catch {}

    return items.sort((a, b) => b.mtime - a.mtime);
  }

  /**
   * Check if a specific file name or base name is already installed in a given target.
   */
  public isInstalled(category: ContentCategory, filename: string, targetInstanceId?: string): boolean {
    const clean = safeName(filename);
    if (!targetInstanceId || targetInstanceId === "_library") {
      const p = path.join(this.getLibraryDir(category), clean);
      return fs.existsSync(p);
    }
    const instFolder = this.mapCategoryToInstanceFolder(category);
    const p1 = path.join(this.getInstanceDir(targetInstanceId), instFolder, clean);
    const p2 = path.join(this.getInstanceDir(targetInstanceId), instFolder, clean + ".disabled");
    return fs.existsSync(p1) || fs.existsSync(p2);
  }

  private recordInManifest(instanceId: string, category: ContentCategory, filename: string): void {
    try {
      const instDir = this.getInstanceDir(instanceId);
      const manFile = path.join(instDir, "manifest.json");
      let manifest: any = { components: [] };
      if (fs.existsSync(manFile)) {
        try { manifest = JSON.parse(fs.readFileSync(manFile, "utf8")); } catch {}
      }
      if (!Array.isArray(manifest.components)) manifest.components = [];
      const existing = manifest.components.find((c: any) => c.filename === filename);
      if (!existing) {
        manifest.components.push({
          filename,
          category,
          installedAt: Date.now(),
        });
        fs.writeFileSync(manFile, JSON.stringify(manifest, null, 2), "utf8");
      }
    } catch {}
  }
}

export function registerContentIPC(getContentMgr: () => ContentManager) {
  ipcMain.handle("content:get-structure", () => {
    getContentMgr().ensureStructure();
    return { root: getContentMgr().getRoot() };
  });

  ipcMain.handle("content:list-library", (_e, category: ContentCategory) => {
    return getContentMgr().listLibrary(category);
  });

  ipcMain.handle("content:install-from-library", (_e, { category, filename, instanceId }: any) => {
    return getContentMgr().installFromLibrary(category, filename, instanceId);
  });

  ipcMain.handle("content:remove-from-instance", (_e, { category, filename, instanceId }: any) => {
    return getContentMgr().removeFromInstance(category, filename, instanceId);
  });

  ipcMain.handle("content:delete-from-library", (_e, { category, filename }: any) => {
    return getContentMgr().deleteFromLibrary(category, filename);
  });

  ipcMain.handle("content:is-installed", (_e, { category, filename, targetInstanceId }: any) => {
    return getContentMgr().isInstalled(category, filename, targetInstanceId);
  });

  ipcMain.handle("content:open-folder", (_e, subPath: string) => {
    const root = getContentMgr().getRoot();
    const target = subPath ? path.join(root, subPath) : root;
    if (fs.existsSync(target)) {
      void shell.openPath(target);
      return true;
    }
    return false;
  });
}
