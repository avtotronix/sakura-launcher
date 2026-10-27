"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModpackInstaller = void 0;
exports.registerModpackInstallerIPC = registerModpackInstallerIPC;
/**
 * Modpack Installer for Sakura Launcher
 * Supports Modrinth (.mrpack) and standard modpack formats.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const electron_1 = require("electron");
const downloadManager_1 = require("./downloadManager");
const net_1 = require("./net");
class ModpackInstaller {
    instancesMgr;
    constructor(instancesMgr) {
        this.instancesMgr = instancesMgr;
    }
    async installFromMrpackUrl(url, packName, wc, onProgress) {
        const notify = (stage, pct) => {
            onProgress?.(stage, pct);
            if (!wc.isDestroyed()) {
                wc.send("modpack:install-progress", { stage, pct });
            }
        };
        const tmpMrpack = path_1.default.join(this.instancesMgr.getInstancePath("../"), "temp_pack_" + Date.now() + ".mrpack");
        try {
            notify("Скачивание сборки...", 10);
            await (0, net_1.download)(url, tmpMrpack);
            notify("Чтение манифеста сборки...", 25);
            const zip = new adm_zip_1.default(tmpMrpack);
            const indexEntry = zip.getEntry("modrinth.index.json");
            if (!indexEntry) {
                throw new Error("Неверный формат сборки: отсутствует modrinth.index.json");
            }
            const indexData = JSON.parse(indexEntry.getData().toString("utf8"));
            const gameVer = indexData.dependencies?.minecraft || "1.21.1";
            let loader = "Fabric";
            let loaderVer = "";
            if (indexData.dependencies?.neoforge) {
                loader = "NeoForge";
                loaderVer = indexData.dependencies.neoforge;
            }
            else if (indexData.dependencies?.forge) {
                loader = "Forge";
                loaderVer = indexData.dependencies.forge;
            }
            else if (indexData.dependencies?.["fabric-loader"]) {
                loader = "Fabric";
                loaderVer = indexData.dependencies["fabric-loader"];
            }
            const cleanName = packName || indexData.name || "Modpack";
            const instanceId = cleanName.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 32) + "_" + Math.floor(Math.random() * 1000);
            notify("Подготовка изолированного каталога...", 35);
            this.instancesMgr.create({
                id: instanceId,
                name: cleanName,
                desc: indexData.summary || "Установлено из каталога Modrinth",
                v: gameVer,
                l: loader,
                loaderVersion: loaderVer,
            });
            const instDir = this.instancesMgr.getInstancePath(instanceId);
            // Extract overrides
            notify("Установка конфигураций и ресурсов...", 45);
            const entries = zip.getEntries();
            for (const ent of entries) {
                if (ent.entryName.startsWith("overrides/") && !ent.isDirectory) {
                    const relPath = ent.entryName.replace(/^overrides\//, "");
                    const targetPath = path_1.default.join(instDir, relPath);
                    fs_1.default.mkdirSync(path_1.default.dirname(targetPath), { recursive: true });
                    fs_1.default.writeFileSync(targetPath, ent.getData());
                }
            }
            // Download mod files
            const files = indexData.files || [];
            const totalFiles = files.length;
            notify(`Загрузка модов (0 из ${totalFiles})...`, 50);
            let completedFiles = 0;
            for (const file of files) {
                if (!file.downloads || !file.downloads.length)
                    continue;
                const fileUrl = file.downloads[0];
                const destPath = path_1.default.join(instDir, file.path);
                fs_1.default.mkdirSync(path_1.default.dirname(destPath), { recursive: true });
                const sha1 = file.hashes?.sha1;
                downloadManager_1.downloadManager.queue({
                    name: path_1.default.basename(file.path),
                    type: "mod",
                    url: fileUrl,
                    dest: destPath,
                    targetPackId: instanceId,
                    expectedHash: sha1 ? { algo: "sha1", hash: sha1 } : undefined,
                });
                completedFiles++;
                const pct = Math.round(50 + (completedFiles / totalFiles) * 45);
                notify(`Загрузка компонентов (${completedFiles} из ${totalFiles})...`, pct);
            }
            notify("Сборка успешно установлена!", 100);
            try {
                fs_1.default.unlinkSync(tmpMrpack);
            }
            catch { }
            return { ok: true, instanceId };
        }
        catch (err) {
            try {
                fs_1.default.unlinkSync(tmpMrpack);
            }
            catch { }
            return { ok: false, error: String(err?.message || err) };
        }
    }
}
exports.ModpackInstaller = ModpackInstaller;
function registerModpackInstallerIPC(installer) {
    electron_1.ipcMain.handle("modpack:install-mrpack", async (e, { url, packName }) => {
        return await installer.installFromMrpackUrl(url, packName, e.sender);
    });
}
