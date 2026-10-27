"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstancesManager = void 0;
exports.registerInstancesIPC = registerInstancesIPC;
/**
 * Instances Manager for Sakura Launcher
 * Provides isolated directories, manifest tracking, components management,
 * import/export, and duplication.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const electron_1 = require("electron");
class InstancesManager {
    baseDir;
    constructor(getBaseDir) {
        this.baseDir = path_1.default.join(getBaseDir(), "instances");
        this.ensureBase();
    }
    ensureBase() {
        if (!fs_1.default.existsSync(this.baseDir)) {
            fs_1.default.mkdirSync(this.baseDir, { recursive: true });
        }
    }
    getInstancePath(packId) {
        const cleanId = path_1.default.basename(packId);
        return path_1.default.join(this.baseDir, cleanId);
    }
    list() {
        this.ensureBase();
        const entries = fs_1.default.readdirSync(this.baseDir, { withFileTypes: true });
        const list = [];
        for (const ent of entries) {
            if (!ent.isDirectory())
                continue;
            const instDir = path_1.default.join(this.baseDir, ent.name);
            const metaFile = path_1.default.join(instDir, "instance.json");
            let meta = {};
            if (fs_1.default.existsSync(metaFile)) {
                try {
                    meta = JSON.parse(fs_1.default.readFileSync(metaFile, "utf8"));
                }
                catch { }
            }
            const countFiles = (folder) => {
                const fp = path_1.default.join(instDir, folder);
                if (!fs_1.default.existsSync(fp))
                    return 0;
                try {
                    return fs_1.default.readdirSync(fp).filter((f) => !f.endsWith(".part") && !f.endsWith(".tmp")).length;
                }
                catch {
                    return 0;
                }
            };
            const stat = fs_1.default.statSync(instDir);
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
    create(opts) {
        this.ensureBase();
        const safeId = path_1.default.basename(opts.id);
        const instDir = path_1.default.join(this.baseDir, safeId);
        if (fs_1.default.existsSync(instDir))
            return false;
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
            fs_1.default.mkdirSync(path_1.default.join(instDir, d), { recursive: true });
        }
        const meta = {
            id: safeId,
            name: opts.name || safeId,
            desc: opts.desc || "",
            v: opts.v || "1.21.4",
            l: opts.l || "Fabric",
            loaderVersion: opts.loaderVersion || "",
            jvmArgs: opts.jvmArgs || "",
            createdAt: Date.now(),
        };
        fs_1.default.writeFileSync(path_1.default.join(instDir, "instance.json"), JSON.stringify(meta, null, 2), "utf8");
        fs_1.default.writeFileSync(path_1.default.join(instDir, "manifest.json"), JSON.stringify({ components: [] }, null, 2), "utf8");
        return true;
    }
    delete(packId) {
        const instDir = this.getInstancePath(packId);
        if (!fs_1.default.existsSync(instDir))
            return false;
        try {
            fs_1.default.rmSync(instDir, { recursive: true, force: true });
            return true;
        }
        catch (e) {
            console.error("Failed to remove instance folder:", e);
            return false;
        }
    }
    rename(packId, newName, newDesc) {
        const instDir = this.getInstancePath(packId);
        const metaFile = path_1.default.join(instDir, "instance.json");
        if (!fs_1.default.existsSync(metaFile))
            return false;
        try {
            const meta = JSON.parse(fs_1.default.readFileSync(metaFile, "utf8"));
            meta.name = newName;
            if (newDesc !== undefined)
                meta.desc = newDesc;
            fs_1.default.writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf8");
            return true;
        }
        catch {
            return false;
        }
    }
    duplicate(packId, newId, newName) {
        const srcDir = this.getInstancePath(packId);
        const destDir = this.getInstancePath(newId);
        if (!fs_1.default.existsSync(srcDir) || fs_1.default.existsSync(destDir))
            return false;
        try {
            fs_1.default.cpSync(srcDir, destDir, { recursive: true });
            const metaFile = path_1.default.join(destDir, "instance.json");
            if (fs_1.default.existsSync(metaFile)) {
                const meta = JSON.parse(fs_1.default.readFileSync(metaFile, "utf8"));
                meta.id = path_1.default.basename(newId);
                meta.name = newName;
                meta.createdAt = Date.now();
                fs_1.default.writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf8");
            }
            return true;
        }
        catch (e) {
            console.error("Duplicate failed:", e);
            return false;
        }
    }
    getComponents(packId, type) {
        const instDir = this.getInstancePath(packId);
        if (!fs_1.default.existsSync(instDir))
            return [];
        const folders = type ? [type] : ["mods", "resourcepacks", "shaderpacks"];
        const results = [];
        for (const fld of folders) {
            const targetDir = path_1.default.join(instDir, fld);
            if (!fs_1.default.existsSync(targetDir))
                continue;
            try {
                const files = fs_1.default.readdirSync(targetDir);
                for (const file of files) {
                    if (file.endsWith(".part") || file.endsWith(".tmp"))
                        continue;
                    const fullPath = path_1.default.join(targetDir, file);
                    const stat = fs_1.default.statSync(fullPath);
                    if (stat.isDirectory())
                        continue;
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
            }
            catch { }
        }
        return results;
    }
    toggleComponent(packId, folder, filename) {
        const instDir = this.getInstancePath(packId);
        const targetDir = path_1.default.join(instDir, folder);
        const curPath = path_1.default.join(targetDir, filename);
        if (!fs_1.default.existsSync(curPath))
            return false;
        const newName = filename.endsWith(".disabled")
            ? filename.replace(/\.disabled$/, "")
            : filename + ".disabled";
        const newPath = path_1.default.join(targetDir, newName);
        try {
            fs_1.default.renameSync(curPath, newPath);
            return true;
        }
        catch {
            return false;
        }
    }
    deleteComponent(packId, folder, filename) {
        const instDir = this.getInstancePath(packId);
        const targetPath = path_1.default.join(instDir, folder, filename);
        if (!fs_1.default.existsSync(targetPath))
            return false;
        try {
            fs_1.default.unlinkSync(targetPath);
            return true;
        }
        catch {
            return false;
        }
    }
    exportInstance(packId, outZipPath) {
        const instDir = this.getInstancePath(packId);
        if (!fs_1.default.existsSync(instDir))
            return false;
        try {
            const zip = new adm_zip_1.default();
            const exportDirs = ["mods", "resourcepacks", "shaderpacks", "config", "defaultconfigs"];
            for (const d of exportDirs) {
                const fullD = path_1.default.join(instDir, d);
                if (fs_1.default.existsSync(fullD)) {
                    zip.addLocalFolder(fullD, d);
                }
            }
            const metaFile = path_1.default.join(instDir, "instance.json");
            if (fs_1.default.existsSync(metaFile)) {
                zip.addLocalFile(metaFile, "", "instance.json");
            }
            zip.writeZip(outZipPath);
            return true;
        }
        catch (e) {
            console.error("Export instance failed:", e);
            return false;
        }
    }
}
exports.InstancesManager = InstancesManager;
function registerInstancesIPC(getInstanceMgr) {
    electron_1.ipcMain.handle("instances:list", () => getInstanceMgr().list());
    electron_1.ipcMain.handle("instances:create", (_e, opts) => getInstanceMgr().create(opts));
    electron_1.ipcMain.handle("instances:delete", (_e, packId) => getInstanceMgr().delete(packId));
    electron_1.ipcMain.handle("instances:get-mods", (_e, packId) => getInstanceMgr().getComponents(packId, "mods"));
    electron_1.ipcMain.handle("instances:delete-mod", (_e, req) => {
        if (!req || typeof req !== "object")
            return false;
        return getInstanceMgr().deleteComponent(req.packId, "mods", req.filename);
    });
    electron_1.ipcMain.handle("instances:rename", (_e, { packId, newName, newDesc }) => getInstanceMgr().rename(packId, newName, newDesc));
    electron_1.ipcMain.handle("instances:duplicate", (_e, { packId, newId, newName }) => getInstanceMgr().duplicate(packId, newId, newName));
    electron_1.ipcMain.handle("instances:get-components", (_e, { packId, type }) => getInstanceMgr().getComponents(packId, type));
    electron_1.ipcMain.handle("instances:toggle-component", (_e, { packId, folder, filename }) => getInstanceMgr().toggleComponent(packId, folder, filename));
    electron_1.ipcMain.handle("instances:delete-component", (_e, { packId, folder, filename }) => getInstanceMgr().deleteComponent(packId, folder, filename));
    electron_1.ipcMain.handle("instances:export", (_e, { packId, outZipPath }) => getInstanceMgr().exportInstance(packId, outZipPath));
}
