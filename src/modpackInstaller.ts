/**
 * Modpack Installer for Sakura Launcher
 * Supports Modrinth (.mrpack) and standard modpack formats.
 */
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { WebContents, ipcMain } from "electron";
import { downloadManager } from "./downloadManager";
import { InstancesManager } from "./instances";
import { download } from "./net";

export class ModpackInstaller {
  constructor(private instancesMgr: InstancesManager) {}

  public async installFromMrpackUrl(
    url: string,
    packName: string,
    wc: WebContents,
    onProgress?: (stage: string, pct: number) => void
  ): Promise<{ ok: boolean; instanceId?: string; error?: string }> {
    const notify = (stage: string, pct: number) => {
      onProgress?.(stage, pct);
      if (!wc.isDestroyed()) {
        wc.send("modpack:install-progress", { stage, pct });
      }
    };

    const tmpMrpack = path.join(
      this.instancesMgr.getInstancePath("../"),
      "temp_pack_" + Date.now() + ".mrpack"
    );

    try {
      notify("Скачивание сборки...", 10);
      await download(url, tmpMrpack);

      notify("Чтение манифеста сборки...", 25);
      const zip = new AdmZip(tmpMrpack);
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
      } else if (indexData.dependencies?.forge) {
        loader = "Forge";
        loaderVer = indexData.dependencies.forge;
      } else if (indexData.dependencies?.["fabric-loader"]) {
        loader = "Fabric";
        loaderVer = indexData.dependencies["fabric-loader"];
      }

      const cleanName = packName || indexData.name || "Modpack";
      const instanceId =
        cleanName.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 32) + "_" + Math.floor(Math.random() * 1000);

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
          const targetPath = path.join(instDir, relPath);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, ent.getData());
        }
      }

      // Download mod files
      const files: any[] = indexData.files || [];
      const totalFiles = files.length;
      notify(`Загрузка модов (0 из ${totalFiles})...`, 50);

      let completedFiles = 0;
      for (const file of files) {
        if (!file.downloads || !file.downloads.length) continue;
        const fileUrl = file.downloads[0];
        const destPath = path.join(instDir, file.path);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        const sha1 = file.hashes?.sha1;
        downloadManager.queue({
          name: path.basename(file.path),
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
      try { fs.unlinkSync(tmpMrpack); } catch {}
      return { ok: true, instanceId };
    } catch (err: any) {
      try { fs.unlinkSync(tmpMrpack); } catch {}
      return { ok: false, error: String(err?.message || err) };
    }
  }
}

export function registerModpackInstallerIPC(installer: ModpackInstaller) {
  ipcMain.handle("modpack:install-mrpack", async (e, { url, packName }: any) => {
    return await installer.installFromMrpackUrl(url, packName, e.sender);
  });
}
