/**
 * Real game launch: Java runtime (Adoptium), Fabric / Forge / NeoForge install, MCLC launch.
 */
import { ipcMain, WebContents } from "electron";
import fs from "fs";
import path from "path";
import os from "os";
import cp from "child_process";
import { Client } from "minecraft-launcher-core";
import AdmZip from "adm-zip";
import { download, getJson, safeId } from "./net";
import { getLaunchAuth } from "./accounts";
import { getMatrix, Loader } from "./versions";
import { analyseCrash, disableMods, latestCrashReport, readLatestLog } from "./crashfix";

const LOADERS: Loader[] = ["Fabric", "Forge", "NeoForge", "Quilt", "Horizon", "Vanilla"];

function send(wc: WebContents, ch: string, data: unknown) {
  if (!wc.isDestroyed()) wc.send(ch, data);
}

// ─── MCLC Handler & Launcher Patch (fixes EMFILE hang on assets, 26.x version parsing, and modern Forge/NeoForge/Fabric/Quilt) ───
let mclcPatched = false;
const verifiedAssetIndexes = new Set<string>();
const verifiedClasspathCache = new Map<string, string[]>();
const registeredGpuExes = new Set<string>();

function boostGameProcess(pid: number | undefined, exePath: string) {
  if (pid && pid > 0) {
    try {
      os.setPriority(pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    } catch {}
  }
  if (process.platform === "win32" && exePath && !registeredGpuExes.has(exePath)) {
    registeredGpuExes.add(exePath);
    try {
      const resolved = path.resolve(exePath);
      cp.exec(
        `reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v "${resolved}" /t REG_SZ /d "GpuPreference=2;" /f`,
        { windowsHide: true },
        () => {}
      );
    } catch {}
  }
}
function patchMclc() {
  if (mclcPatched) return;
  mclcPatched = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Handler = require("minecraft-launcher-core/components/handler");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const MCLCore = require("minecraft-launcher-core/components/launcher");

    Handler.prototype.downloadAsync = async function (
      url: string,
      directory: string,
      name: string,
      retry: boolean,
      type: string
    ) {
      if (!url) return { failed: false, asset: null };
      fs.mkdirSync(directory, { recursive: true });
      const dest = path.join(directory, name);
      try {
        await download(url, dest, (cur, tot) => {
          this.client.emit("download-status", { name, type, current: cur, total: tot });
        });
        this.client.emit("download", name);
        return { failed: false, asset: null };
      } catch (err: any) {
        this.client.emit("debug", `[MCLC]: Failed to download ${url} -> ${dest}: ${err?.message || err}`);
        if (retry) {
          try {
            await download(url, dest);
            this.client.emit("download", name);
            return { failed: false, asset: null };
          } catch {}
        }
        return { failed: true, asset: null };
      }
    };

    Handler.prototype.getVersion = async function () {
      const versionJsonPath =
        this.options.overrides.versionJson ||
        path.join(this.options.directory, `${this.options.version.number}.json`);
      if (fs.existsSync(versionJsonPath)) {
        try {
          this.version = JSON.parse(fs.readFileSync(versionJsonPath, "utf8"));
          return this.version;
        } catch {}
      }
      const cacheDir = this.options.cache ? `${this.options.cache}/json` : `${this.options.root}/cache/json`;
      const cachedVerPath = path.join(cacheDir, `${this.options.version.number}.json`);
      if (fs.existsSync(cachedVerPath)) {
        try {
          this.version = JSON.parse(fs.readFileSync(cachedVerPath, "utf8"));
          fs.mkdirSync(path.dirname(versionJsonPath), { recursive: true });
          fs.writeFileSync(versionJsonPath, JSON.stringify(this.version, null, 2), "utf8");
          return this.version;
        } catch {}
      }

      const manifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
      const parsed = await getJson<any>(manifestUrl);
      fs.mkdirSync(cacheDir, { recursive: true });
      try {
        fs.writeFileSync(path.join(cacheDir, "version_manifest.json"), JSON.stringify(parsed), "utf8");
      } catch {}
      const desired = (parsed.versions || []).find((v: any) => v.id === this.options.version.number);
      if (!desired) {
        throw new Error(`Версия ${this.options.version.number} не найдена в манифесте Mojang`);
      }
      this.version = await getJson<any>(desired.url);
      try {
        fs.writeFileSync(cachedVerPath, JSON.stringify(this.version, null, 2), "utf8");
      } catch {}
      try {
        fs.mkdirSync(path.dirname(versionJsonPath), { recursive: true });
        fs.writeFileSync(versionJsonPath, JSON.stringify(this.version, null, 2), "utf8");
      } catch {}
      return this.version;
    };

    Handler.prototype.getJar = async function () {
      const baseVerDir = path.join(this.options.root, "versions", this.options.version.number);
      fs.mkdirSync(baseVerDir, { recursive: true });
      const targetJar = this.options.mcPath || path.join(baseVerDir, `${this.options.version.number}.jar`);
      if (!fs.existsSync(targetJar) || fs.statSync(targetJar).size === 0) {
        await this.downloadAsync(
          this.version.downloads.client.url,
          path.dirname(targetJar),
          path.basename(targetJar),
          true,
          "version-jar"
        );
      }
      const verJsonFile = path.join(baseVerDir, `${this.options.version.number}.json`);
      if (!fs.existsSync(verJsonFile)) {
        fs.writeFileSync(verJsonFile, JSON.stringify(this.version, null, 2), "utf8");
      }
      return this.client.emit("debug", "[MCLC]: Downloaded version jar and wrote version json");
    };

    Handler.prototype.parseRule = function (lib: any) {
      const osName = this.getOS(); // 'windows' | 'osx' | 'linux'
      const nameStr = String(lib?.name || "");
      // Filter architecture-mismatched or OS-mismatched native classifier jars
      if (process.arch === "x64" && (nameStr.endsWith("-arm64") || nameStr.endsWith("-aarch_64") || nameStr.endsWith("-x86"))) {
        return true; // skip
      }
      if (osName === "windows" && (nameStr.includes("natives-linux") || nameStr.includes("natives-macos") || nameStr.includes("natives-osx") || nameStr.includes("linux-x86") || nameStr.includes("linux-aarch") || nameStr.includes("osx-"))) {
        return true; // skip
      }
      if (!lib.rules || !Array.isArray(lib.rules) || lib.rules.length === 0) {
        return false; // include
      }
      let allowed = lib.rules[0].action !== "allow";
      for (const rule of lib.rules) {
        let matches = true;
        if (rule.os) {
          if (rule.os.name && rule.os.name !== osName) matches = false;
          if (rule.os.arch) {
            const sysArch = process.arch === "ia32" ? "x86" : process.arch;
            if (rule.os.arch !== sysArch) matches = false;
          }
        }
        if (matches) {
          allowed = rule.action === "allow";
        }
      }
      return !allowed; // MCLC convention: true means skip library
    };

    Handler.prototype.getNatives = async function () {
      const nativeDirectory = path.resolve(
        this.options.overrides.natives || path.join(this.options.root, "natives", this.version.id)
      );
      const rawId = String(this.version.id || "");
      const match = rawId.match(/(?:^|-)(\d+)\.(\d+)(?:\.(\d+))?/);
      const major = match ? parseInt(match[1], 10) : 1;
      const minor = match ? parseInt(match[2], 10) : 0;
      if (major >= 25 || (major === 1 && minor >= 19)) {
        for (const sub of ["", "java", "jna", "lwjgl", "netty"]) {
          fs.mkdirSync(path.join(nativeDirectory, sub), { recursive: true });
        }
        return nativeDirectory;
      }
      if (!fs.existsSync(nativeDirectory) || !fs.readdirSync(nativeDirectory).length) {
        fs.mkdirSync(nativeDirectory, { recursive: true });
        const natives: any[] = [];
        for (const lib of this.version.libraries || []) {
          if (!lib?.downloads?.classifiers) continue;
          if (this.parseRule(lib)) continue;
          const native =
            this.getOS() === "osx"
              ? lib.downloads.classifiers["natives-osx"] || lib.downloads.classifiers["natives-macos"]
              : lib.downloads.classifiers[`natives-${this.getOS()}`];
          if (native) natives.push(native);
        }
        this.client.emit("progress", { type: "natives", task: 0, total: natives.length });
        let done = 0;
        for (const native of natives) {
          const name = native.path.split("/").pop();
          await this.downloadAsync(native.url, nativeDirectory, name, true, "natives");
          try {
            new AdmZip(path.join(nativeDirectory, name)).extractAllTo(nativeDirectory, true);
          } catch {}
          try {
            fs.unlinkSync(path.join(nativeDirectory, name));
          } catch {}
          done++;
          this.client.emit("progress", { type: "natives", task: done, total: natives.length });
        }
      }
      return nativeDirectory;
    };

    Handler.prototype.isModernForge = function (json: any) {
      if (!json?.inheritsFrom) return false;
      const p = String(json.inheritsFrom)
        .split(".")
        .map((n: string) => parseInt(n, 10));
      if (p[0] >= 25) return true;
      return (
        p[1] >= 12 &&
        !(json.inheritsFrom === "1.12.2" && json.id.split(".")[json.id.split(".").length - 1] === "2847")
      );
    };

    Handler.prototype.downloadToDirectory = async function (
      directory: string,
      libraries: any[],
      eventName: string
    ) {
      const libs: string[] = [];
      const toDownload: Array<{ url: string; jarPath: string; name: string; fullPath: string }> = [];
      const validLibs = (libraries || []).filter((l) => l && !this.parseRule(l));

      for (const library of validLibs) {
        const lib = String(library.name || "").split(":");
        let jarPath: string;
        let name: string;
        if (library.downloads?.artifact?.path) {
          const parts = library.downloads.artifact.path.split("/");
          name = parts[parts.length - 1];
          jarPath = path.join(directory, parts.slice(0, -1).join("/"));
        } else {
          name = `${lib[1]}-${lib[2]}${lib[3] ? "-" + lib[3] : ""}.jar`;
          jarPath = path.join(directory, `${lib[0].replace(/\./g, "/")}/${lib[1]}/${lib[2]}`);
        }
        const fullPath = path.join(jarPath, name);
        libs.push(fullPath);

        let existsOk = false;
        try {
          const st = fs.statSync(fullPath);
          if (st.size > 0) existsOk = true;
        } catch {}

        if (!existsOk) {
          let url = "";
          if (library.url) {
            const base = library.url.endsWith("/") ? library.url : library.url + "/";
            url = `${base}${lib[0].replace(/\./g, "/")}/${lib[1]}/${lib[2]}/${name}`;
          } else if (library.downloads?.artifact?.url) {
            url = library.downloads.artifact.url;
          }
          if (url) {
            toDownload.push({ url, jarPath, name, fullPath });
          }
        }
      }

      const total = validLibs.length;
      let done = total - toDownload.length;
      this.client.emit("progress", { type: eventName, task: done, total });

      if (toDownload.length > 0) {
        let idx = 0;
        const concurrency = Math.min(12, toDownload.length);
        const workers = Array.from({ length: concurrency }, async () => {
          while (true) {
            const cur = idx++;
            if (cur >= toDownload.length) break;
            const item = toDownload[cur];
            await this.downloadAsync(item.url, item.jarPath, item.name, true, eventName);
            done++;
            this.client.emit("progress", { type: eventName, task: done, total });
          }
        });
        await Promise.all(workers);
      }

      return libs.filter((p) => fs.existsSync(p));
    };

    Handler.prototype.getClasses = async function (classJson: any) {
      const cacheKey = `${this.options.root}|${this.version?.id}|${classJson?.id || "vanilla"}`;
      const cached = verifiedClasspathCache.get(cacheKey);
      if (cached && cached.length > 0) {
        this.client.emit("progress", { type: "classes", task: cached.length, total: cached.length });
        return cached;
      }

      let libs: string[] = [];
      const libraryDirectory = path.resolve(
        this.options.overrides.libraryRoot || path.join(this.options.root, "libraries")
      );
      const libKey = (name: string) => {
        const p = String(name || "").split(":");
        return p.length >= 4 ? `${p[0]}:${p[1]}:${p[3]}` : `${p[0]}:${p[1]}`;
      };

      const customKeys = new Set<string>();
      if (classJson) {
        if (classJson.mavenFiles) {
          await this.downloadToDirectory(libraryDirectory, classJson.mavenFiles, "classes-maven-custom");
        }
        for (const l of classJson.libraries || []) {
          if (l?.name) customKeys.add(libKey(l.name));
        }
        libs = await this.downloadToDirectory(libraryDirectory, classJson.libraries || [], "classes-custom");
      }

      const parsed = (this.version.libraries || []).filter((lib: any) => {
        if (!lib.downloads?.artifact || this.parseRule(lib)) return false;
        if (customKeys.has(libKey(lib.name))) return false;
        return true;
      });

      libs = libs.concat(await this.downloadToDirectory(libraryDirectory, parsed, "classes"));
      this.client.emit("debug", "[MCLC]: Collected class paths");
      const deduped = [...new Set(libs)];
      verifiedClasspathCache.set(cacheKey, deduped);
      return deduped;
    };

    Handler.prototype.getAssets = async function () {
      const assetDirectory = path.resolve(
        this.options.overrides.assetRoot || path.join(this.options.root, "assets")
      );
      const realAssetId = String(
        this.version.assetIndex?.id || this.version.assets || this.options.version.number
      );
      const mclcAssetId = String(
        this.options.overrides.assetIndex || this.options.version.custom || this.options.version.number
      );
      const indexesDir = path.join(assetDirectory, "indexes");
      fs.mkdirSync(indexesDir, { recursive: true });

      const realIdxPath = path.join(indexesDir, `${realAssetId}.json`);
      const mclcIdxPath = path.join(indexesDir, `${mclcAssetId}.json`);
      const numIdxPath = path.join(indexesDir, `${this.options.version.number}.json`);
      const stampPath = path.join(indexesDir, `${realAssetId}.verified`);

      if (!fs.existsSync(realIdxPath)) {
        if (fs.existsSync(numIdxPath)) {
          try { fs.copyFileSync(numIdxPath, realIdxPath); } catch {}
        } else if (fs.existsSync(mclcIdxPath)) {
          try { fs.copyFileSync(mclcIdxPath, realIdxPath); } catch {}
        } else if (this.version.assetIndex?.url) {
          await this.downloadAsync(this.version.assetIndex.url, indexesDir, `${realAssetId}.json`, true, "asset-json");
        }
      }
      if (fs.existsSync(realIdxPath)) {
        for (const target of [mclcIdxPath, numIdxPath]) {
          if (target !== realIdxPath && !fs.existsSync(target)) {
            try { fs.copyFileSync(realIdxPath, target); } catch {}
          }
        }
      }

      const fastCacheKey = `${assetDirectory}|${realAssetId}`;
      if (verifiedAssetIndexes.has(fastCacheKey) || fs.existsSync(stampPath)) {
        verifiedAssetIndexes.add(fastCacheKey);
        this.client.emit("progress", { type: "assets", task: 1, total: 1 });
        this.client.emit("debug", "[MCLC]: Assets fast-verified from cache");
        return;
      }

      const indexSource = fs.existsSync(realIdxPath) ? realIdxPath : mclcIdxPath;
      const index = JSON.parse(fs.readFileSync(indexSource, "utf8"));
      const objects = index.objects || {};
      const keys = Object.keys(objects);
      const total = keys.length;

      const missing: Array<{ hash: string; subhash: string; subAsset: string }> = [];
      for (const assetKey of keys) {
        const obj = objects[assetKey];
        const hash: string = obj.hash;
        const subhash = hash.substring(0, 2);
        const subAsset = path.join(assetDirectory, "objects", subhash);
        const filePath = path.join(subAsset, hash);
        let ok = false;
        try {
          if (fs.existsSync(filePath)) {
            const st = fs.statSync(filePath);
            if (obj.size ? st.size === obj.size : st.size > 0) ok = true;
          }
        } catch {}
        if (!ok) {
          missing.push({ hash, subhash, subAsset });
        }
      }

      let done = total - missing.length;
      this.client.emit("progress", { type: "assets", task: done, total });

      if (missing.length > 0) {
        let idx = 0;
        const concurrency = Math.min(24, missing.length);
        const resourceBase = this.options.overrides?.url?.resource || "https://resources.download.minecraft.net";
        const workers = Array.from({ length: concurrency }, async () => {
          while (true) {
            const cur = idx++;
            if (cur >= missing.length) break;
            const item = missing[cur];
            await this.downloadAsync(
              `${resourceBase}/${item.subhash}/${item.hash}`,
              item.subAsset,
              item.hash,
              true,
              "assets"
            );
            done++;
            if (done % 15 === 0 || done === total) {
              this.client.emit("progress", { type: "assets", task: done, total });
            }
          }
        });
        await Promise.all(workers);
      }

      this.client.emit("progress", { type: "assets", task: total, total });
      verifiedAssetIndexes.add(fastCacheKey);
      try { fs.writeFileSync(stampPath, String(Date.now()), "utf8"); } catch {}

      if (this.isLegacy()) {
        const legacyDirectory = path.join(this.options.root, "resources");
        let legacyDone = 0;
        for (const assetKey of keys) {
          const hash = objects[assetKey].hash;
          const subhash = hash.substring(0, 2);
          const srcFile = path.join(assetDirectory, "objects", subhash, hash);
          const dstFile = path.join(legacyDirectory, assetKey);
          if (!fs.existsSync(dstFile) && fs.existsSync(srcFile)) {
            fs.mkdirSync(path.dirname(dstFile), { recursive: true });
            try { fs.copyFileSync(srcFile, dstFile); } catch {}
          }
          legacyDone++;
          if (legacyDone % 50 === 0 || legacyDone === total) {
            this.client.emit("progress", { type: "assets-copy", task: legacyDone, total });
          }
        }
      }

      this.client.emit("debug", "[MCLC]: Downloaded assets");
    };

    // Patch MCLCore.prototype.launch so modern Forge/NeoForge don't duplicate vanilla jar on -cp and 26.x doesn't trigger 1.12 log4j check
    MCLCore.prototype.launch = async function (options: any) {
      try {
        this.options = { ...options };
        this.options.root = path.resolve(this.options.root);
        this.options.overrides = {
          detached: true,
          ...this.options.overrides,
          url: {
            meta: "https://piston-meta.mojang.com",
            resource: "https://resources.download.minecraft.net",
            mavenForge: "https://files.minecraftforge.net/maven/",
            defaultRepoForge: "https://libraries.minecraft.net/",
            fallbackMaven: "https://search.maven.org/remotecontent?filepath=",
            ...(this.options.overrides ? this.options.overrides.url : undefined),
          },
          fw: {
            baseUrl: "https://github.com/ZekerZhayard/ForgeWrapper/releases/download/",
            version: "1.6.0",
            sh1: "035a51fe6439792a61507630d89382f621da0f1f",
            size: 28679,
            ...(this.options.overrides ? this.options.overrides.fw : undefined),
          },
        };

        this.handler = new Handler(this);

        // Skip spawning slow 'java -version' shell subprocess when javaPath is already verified on disk
        const jPath = this.options.javaPath || "java";
        if (jPath === "java" || !fs.existsSync(jPath)) {
          const java = await this.handler.checkJava(jPath);
          if (!java.run) {
            this.emit("debug", `[MCLC]: Couldn't start Minecraft due to: ${java.message}`);
            this.emit("close", 1);
            return null;
          }
        }

        this.createRootDirectory();
        this.createGameDirectory();
        await this.extractPackage();

        const directory =
          this.options.overrides.directory ||
          path.join(this.options.root, "versions", this.options.version.number);
        this.options.directory = directory;

        const versionFile = await this.handler.getVersion();
        const mcPath =
          this.options.overrides.minecraftJar ||
          path.join(directory, `${this.options.version.number}.jar`);
        this.options.mcPath = mcPath;
        const nativePath = await this.handler.getNatives();

        if (!fs.existsSync(mcPath) || fs.statSync(mcPath).size === 0) {
          this.emit("debug", "[MCLC]: Attempting to download Minecraft version jar");
          await this.handler.getJar();
        }

        const modifyJson = await this.getModifyJson();
        const args: string[] = [];

        let jvm: string[] = [
          "-XX:-UseAdaptiveSizePolicy",
          "-XX:-OmitStackTraceInFastThrow",
          "-Dfml.ignorePatchDiscrepancies=true",
          "-Dfml.ignoreInvalidMinecraftCertificates=true",
          `-Djava.library.path=${nativePath}`,
          `-Xmx${this.handler.getMemory()[0]}`,
          `-Xms${this.handler.getMemory()[1]}`,
        ];
        if (this.handler.getOS() === "osx") {
          const vParts = String(versionFile.id || "").split(".").map(Number);
          if (vParts[0] >= 25 || vParts[1] > 12) jvm.push(await this.handler.getJVM());
        } else {
          jvm.push(await this.handler.getJVM());
        }

        if (this.options.customArgs) jvm = jvm.concat(this.options.customArgs);
        if (this.options.overrides.logj4ConfigurationFile) {
          jvm.push(`-Dlog4j.configurationFile=${path.resolve(this.options.overrides.logj4ConfigurationFile)}`);
        }

        const classes: string[] =
          this.options.overrides.classes || this.handler.cleanUp(await this.handler.getClasses(modifyJson));
        const separator = this.handler.getOS() === "windows" ? ";" : ":";
        this.emit("debug", `[MCLC]: Using ${separator} to separate class paths`);
        const file = modifyJson || versionFile;

        // Modern Forge / NeoForge provide their own patched client jar inside libraries; do not append unpatched mcPath
        const skipVanillaJar = Boolean(this.options.overrides.skipVanillaJarInCp);
        const jar = skipVanillaJar
          ? ""
          : fs.existsSync(mcPath)
          ? `${separator}${mcPath}`
          : `${separator}${path.join(directory, `${this.options.version.number}.jar`)}`;
        const classPaths = [
          "-cp",
          `${this.options.forge ? this.options.forge + separator : ""}${classes.filter(Boolean).join(separator)}${jar}`,
          file.mainClass,
        ];

        this.emit("debug", "[MCLC]: Attempting to download assets");
        await this.handler.getAssets();

        const launchOptions = await this.handler.getLaunchOptions(modifyJson);
        const launchArguments = args.concat(jvm, classPaths, launchOptions);
        this.emit("arguments", launchArguments);
        this.emit("debug", `[MCLC]: Launching with arguments ${launchArguments.join(" ")}`);

        return this.startMinecraft(launchArguments);
      } catch (e: any) {
        this.emit("debug", `[MCLC]: Failed to start due to ${e?.stack || e}, closing...`);
        return null;
      }
    };
  } catch (err) {
    console.warn("[launcher] Could not apply MCLC patch:", err);
  }
}
patchMclc();

// ─── installed marker ────────────────────────────────────────────────────────
const markerFile = (root: string) => path.join(root, "sakura-installed.json");
export function readInstalled(root: string): string[] {
  try { return JSON.parse(fs.readFileSync(markerFile(root), "utf8")); } catch { return []; }
}
function markInstalled(root: string, combo: string) {
  const s = new Set(readInstalled(root)); s.add(combo);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(markerFile(root), JSON.stringify([...s]));
}

// ─── Java ────────────────────────────────────────────────────────────────────
async function requiredJava(mc: string): Promise<number> {
  try {
    const man = await getJson<any>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    const v = man.versions.find((x: any) => x.id === mc);
    if (!v) throw new Error(`Версия ${mc} не найдена`);
    const j = await getJson<any>(v.url);
    return j.javaVersion?.majorVersion ?? 21;
  } catch {
    const parts = mc.split(".").map(Number);
    if (parts[0] >= 26) return 25;
    if (parts[0] >= 25 || (parts[0] === 1 && parts[1] >= 20 && (parts[2] ?? 0) >= 5)) return 21;
    if (parts[0] === 1 && parts[1] >= 17) return 17;
    return 8;
  }
}

function findJavaInDir(dir: string, depth = 3): string | null {
  const exe = process.platform === "win32" ? "javaw.exe" : "java";
  const walk = (d: string, curDepth: number): string | null => {
    const cand = path.join(d, "bin", exe);
    if (fs.existsSync(cand)) return cand;
    if (curDepth <= 0) return null;
    try {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          const r = walk(path.join(d, e.name), curDepth - 1);
          if (r) return r;
        }
      }
    } catch {
      return null;
    }
    return null;
  };
  return fs.existsSync(dir) ? walk(dir, depth) : null;
}

function probeJavaMajor(javaExe: string): number | null {
  try {
    const dir = path.dirname(javaExe);
    const cliExe = path.join(dir, process.platform === "win32" ? "java.exe" : "java");
    const target = fs.existsSync(cliExe) ? cliExe : javaExe;
    const res = cp.spawnSync(target, ["-version"], { encoding: "utf8", timeout: 4000 });
    const output = (res.stderr || "") + " " + (res.stdout || "");
    const match = output.match(/version "([0-9]+)(\.([0-9]+))?/);
    if (match) {
      const v = Number(match[1]);
      return v === 1 ? Number(match[3]) : v;
    }
  } catch {}
  return null;
}

function findSystemJava(requiredMajor: number): string | null {
  if (process.platform !== "win32") return null;

  const candidateDirs: string[] = [];
  if (process.env.JAVA_HOME) candidateDirs.push(process.env.JAVA_HOME);
  if (process.env.JDK_HOME) candidateDirs.push(process.env.JDK_HOME);

  const progFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean) as string[];
  for (const pf of progFiles) {
    const vendors = ["Eclipse Adoptium", "Java", "Microsoft", "Zulu", "BellSoft", "Semeru"];
    for (const v of vendors) {
      const vp = path.join(pf, v);
      if (fs.existsSync(vp)) {
        try {
          for (const ent of fs.readdirSync(vp, { withFileTypes: true })) {
            if (ent.isDirectory()) candidateDirs.push(path.join(vp, ent.name));
          }
        } catch {}
      }
    }
  }

  for (const cand of candidateDirs) {
    const found = findJavaInDir(cand, 2);
    if (found) {
      const maj = probeJavaMajor(found);
      if (maj && (maj === requiredMajor || (requiredMajor === 17 && maj >= 17) || (requiredMajor === 21 && maj >= 21))) {
        return found;
      }
    }
  }

  return null;
}

async function ensureJava(root: string, major: number, wc: WebContents): Promise<string> {
  const feature = major === 16 ? 17 : major;
  const targetDir = path.join(root, "runtime", `java-${feature}`);

  // 1. Check target runtime folder
  const have = findJavaInDir(targetDir);
  if (have) return have;

  // 2. Check sibling runtime directories (e.g. Roaming/.sakura <-> D:/.sakura)
  const candidateRoots = [
    path.join(process.env.APPDATA || "", ".sakura"),
    "D:\\.sakura",
    path.join(os.homedir(), ".sakura"),
  ];
  for (const cr of candidateRoots) {
    if (path.resolve(cr) === path.resolve(root)) continue;
    const siblingDir = path.join(cr, "runtime", `java-${feature}`);
    const siblingJava = findJavaInDir(siblingDir);
    if (siblingJava) return siblingJava;
  }

  // 3. Check system-installed Java
  const sysJava = findSystemJava(feature);
  if (sysJava) return sysJava;

  if (process.platform !== "win32") return "java";

  // 4. Download Java with fallback mirrors
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  const mirrors: string[] = [];

  if (feature === 17) {
    // Microsoft OpenJDK 17 (fast Azure CDN) -> Adoptium -> Zulu
    mirrors.push("https://aka.ms/download-jdk/microsoft-jdk-17.0.12-windows-x64.zip");
    mirrors.push(`https://api.adoptium.net/v3/binary/latest/17/ga/windows/${arch}/jre/hotspot/normal/eclipse?project=jdk`);
    mirrors.push("https://cdn.azul.com/zulu/bin/zulu17.52.17-ca-jre17.0.12-win_x64.zip");
  } else if (feature === 21) {
    // Microsoft OpenJDK 21 -> Adoptium
    mirrors.push("https://aka.ms/download-jdk/microsoft-jdk-21.0.4-windows-x64.zip");
    mirrors.push(`https://api.adoptium.net/v3/binary/latest/21/ga/windows/${arch}/jre/hotspot/normal/eclipse?project=jdk`);
  } else if (feature === 8) {
    mirrors.push(`https://api.adoptium.net/v3/binary/latest/8/ga/windows/${arch}/jre/hotspot/normal/eclipse?project=jdk`);
    mirrors.push("https://cdn.azul.com/zulu/bin/zulu8.80.0.17-ca-jre8.0.422-win_x64.zip");
  } else {
    mirrors.push(`https://api.adoptium.net/v3/binary/latest/${feature}/ga/windows/${arch}/jre/hotspot/normal/eclipse?project=jdk`);
  }

  const zip = path.join(root, "runtime", `java-${feature}.zip`);
  fs.mkdirSync(path.join(root, "runtime"), { recursive: true });

  let lastError: Error | null = null;
  for (let mIdx = 0; mIdx < mirrors.length; mIdx++) {
    const mirrorUrl = mirrors[mIdx];
    const mirrorSuffix = mIdx > 0 ? ` (зеркало ${mIdx + 1})` : "";
    try {
      send(wc, "game:progress", { stage: `Скачиваем Java ${feature}${mirrorSuffix}`, pct: 0 });
      await download(mirrorUrl, zip, (d, t) => {
        if (t > 0) {
          send(wc, "game:progress", {
            stage: `Скачиваем Java ${feature}${mirrorSuffix}`,
            pct: Math.min(99, Math.round((d / t) * 100)),
          });
        }
      });

      send(wc, "game:progress", { stage: `Распаковываем Java ${feature}`, pct: 100 });
      fs.mkdirSync(targetDir, { recursive: true });
      new AdmZip(zip).extractAllTo(targetDir, true);
      try { fs.unlinkSync(zip); } catch {}

      const installedJava = findJavaInDir(targetDir);
      if (installedJava) return installedJava;
    } catch (err: any) {
      lastError = err;
      console.warn(`[ensureJava] Mirror ${mirrorUrl} failed:`, err.message || err);
      try { if (fs.existsSync(zip)) fs.unlinkSync(zip); } catch {}
    }
  }

  throw lastError || new Error(`Не удалось загрузить и установить Java ${feature}. Проверьте подключение к интернету.`);
}

// ─── authlib-injector (Ely.by skins & server auth) ───────────────────────────
async function ensureAuthlib(root: string): Promise<string> {
  const jar = path.join(root, "authlib-injector.jar");
  if (fs.existsSync(jar)) {
    try {
      if (fs.statSync(jar).size > 1000) return jar;
    } catch {}
    try { fs.unlinkSync(jar); } catch {}
  }
  const meta = await getJson<any>("https://authlib-injector.yushi.moe/artifact/latest.json");
  await download(meta.download_url, jar);
  return jar;
}

// ─── Launch ──────────────────────────────────────────────────────────────────
interface LaunchReq {
  version: string;
  loader: Loader;
  ram: number;
  packId?: string;
  elyAuth?: boolean;
  server?: string;
  skinData?: string;
  skinSlim?: boolean;
  nick?: string;
}

function validate(o: any): LaunchReq {
  if (!o || typeof o !== "object") throw new Error("Bad request");
  if (typeof o.version !== "string" || !/^[0-9][0-9a-z.\-_]{0,30}$/i.test(o.version)) throw new Error("Bad version");
  const loaderStr = (o.loader || "").toLowerCase();
  const matchedLoader = LOADERS.find(l => l.toLowerCase() === loaderStr);
  if (!matchedLoader) throw new Error("Bad loader");
  const ram = Math.round(Number(o.ram));
  if (!(ram >= 1 && ram <= 64)) throw new Error("Bad RAM value");
  return {
    version: o.version,
    loader: matchedLoader,
    ram,
    packId: o.packId ? safeId(o.packId) : undefined,
    elyAuth: Boolean(o.elyAuth),
    server: typeof o.server === "string" && o.server.trim() ? o.server.trim().slice(0, 128) : undefined,
    skinData: typeof o.skinData === "string" && o.skinData.startsWith("data:image/png;base64,") ? o.skinData : undefined,
    skinSlim: Boolean(o.skinSlim),
    nick: typeof o.nick === "string" ? o.nick.slice(0, 32) : undefined,
  };
}


function applyPlayerSkin(targetDir: string, dataUrl: string, isSlim: boolean) {
  try {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const skinBuf = Buffer.from(b64, "base64");
    if (skinBuf.length < 100) return;

    const rpDir = path.join(targetDir, "resourcepacks");
    fs.mkdirSync(rpDir, { recursive: true });
    const zipPath = path.join(rpDir, "SakuraSkin.zip");

    const zip = new AdmZip();
    const mcmeta = JSON.stringify({
      pack: {
        pack_format: 34,
        supported_formats: [15, 99],
        min_format: 15,
        max_format: 99,
        description: "Sakura Launcher Player Skin"
      }
    }, null, 2);
    zip.addFile("pack.mcmeta", Buffer.from(mcmeta, "utf8"));

    // Legacy paths
    zip.addFile("assets/minecraft/textures/entity/steve.png", skinBuf);
    zip.addFile("assets/minecraft/textures/entity/alex.png", skinBuf);

    // Modern paths
    zip.addFile("assets/minecraft/textures/entity/player/wide/steve.png", skinBuf);
    zip.addFile("assets/minecraft/textures/entity/player/slim/alex.png", skinBuf);
    zip.addFile("assets/minecraft/textures/entity/player/wide/alex.png", skinBuf);
    zip.addFile("assets/minecraft/textures/entity/player/slim/steve.png", skinBuf);

    zip.writeZip(zipPath);

    // Ensure options.txt activates this resourcepack with valid strict JSON
    const optionsPath = path.join(targetDir, "options.txt");
    if (fs.existsSync(optionsPath)) {
      let optText = fs.readFileSync(optionsPath, "utf8");
      const match = optText.match(/resourcePacks:\[(.*?)\]/);
      if (match) {
        let packs: string[] = ["vanilla"];
        try {
          const cleaned = match[1].replace(/,\s*$/, "").trim();
          if (cleaned) {
            const parsed = JSON.parse(`[${cleaned}]`);
            if (Array.isArray(parsed)) {
              packs = parsed.filter((x) => typeof x === "string" && x.length > 0);
            }
          }
        } catch {}
        if (!packs.includes("vanilla")) packs.unshift("vanilla");
        if (!packs.includes("file/SakuraSkin.zip")) packs.push("file/SakuraSkin.zip");
        optText = optText.replace(/resourcePacks:\[.*?\]/, `resourcePacks:${JSON.stringify(packs)}`);
        fs.writeFileSync(optionsPath, optText, "utf8");
      } else {
        optText += `\nresourcePacks:["vanilla","file/SakuraSkin.zip"]\n`;
        fs.writeFileSync(optionsPath, optText, "utf8");
      }
    } else {
      fs.writeFileSync(optionsPath, `resourcePacks:["vanilla","file/SakuraSkin.zip"]\n`, "utf8");
    }
  } catch (err) {
    console.warn("Could not apply player skin resourcepack:", err);
  }
}

function prepareHorizonFastSkinAndOptions(targetDir: string, resourcesDir: string, dataUrl?: string) {
  try {
    // 1. Strip SakuraSkin.zip from options.txt resourcePacks so Horizon does not copy 35,000 files into .horizon-cache on Windows
    const optionsPath = path.join(targetDir, "options.txt");
    let hasOtherPacks = false;
    if (fs.existsSync(optionsPath)) {
      let optText = fs.readFileSync(optionsPath, "utf8");
      const match = optText.match(/resourcePacks:\[(.*?)\]/);
      if (match) {
        let packs: string[] = [];
        try {
          const cleaned = match[1].replace(/,\s*$/, "").trim();
          if (cleaned) {
            const parsed = JSON.parse(`[${cleaned}]`);
            if (Array.isArray(parsed)) {
              packs = parsed.filter(
                (x) => typeof x === "string" && x !== "file/SakuraSkin.zip" && x !== "vanilla"
              );
            }
          }
        } catch {}
        hasOtherPacks = packs.length > 0;
        const replacement = hasOtherPacks ? `resourcePacks:${JSON.stringify(packs)}` : "resourcePacks:[]";
        if (match[0] !== replacement) {
          optText = optText.replace(/resourcePacks:\[.*?\]/, replacement);
          fs.writeFileSync(optionsPath, optText, "utf8");
        }
      }
    }
    const skinZip = path.join(targetDir, "resourcepacks", "SakuraSkin.zip");
    if (fs.existsSync(skinZip)) {
      try { fs.unlinkSync(skinZip); } catch {}
    }

    // 2. If no custom resourcepacks are active, evict any stale .horizon-cache instantly via rename + async rm
    if (!hasOtherPacks) {
      const hCache = path.join(targetDir, ".horizon-cache");
      if (fs.existsSync(hCache)) {
        const trash = path.join(targetDir, `.horizon-cache-old-${Date.now()}`);
        try {
          fs.renameSync(hCache, trash);
          fs.rm(trash, { recursive: true, force: true }, () => {});
        } catch {
          try { fs.rmSync(hCache, { recursive: true, force: true }); } catch {}
        }
      }
    }

    // 3. Inject player skin directly into Horizon's prepared vanilla_root so it loads in 0ms without an overlay
    if (dataUrl && dataUrl.startsWith("data:image/png;base64,")) {
      const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      const skinBuf = Buffer.from(b64, "base64");
      if (skinBuf.length >= 100 && fs.existsSync(resourcesDir)) {
        const relTargets = [
          "assets/minecraft/textures/entity/steve.png",
          "assets/minecraft/textures/entity/alex.png",
          "assets/minecraft/textures/entity/player/wide/steve.png",
          "assets/minecraft/textures/entity/player/slim/alex.png",
          "assets/minecraft/textures/entity/player/wide/alex.png",
          "assets/minecraft/textures/entity/player/slim/steve.png",
        ];
        for (const rel of relTargets) {
          const dest = path.join(resourcesDir, rel);
          try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, skinBuf);
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn("Could not prepare Horizon fast skin/options:", err);
  }
}

async function ensureHorizonRelease(root: string, wc: WebContents): Promise<string> {
  const candidates: string[] = [];
  const sakuraHorizon = path.join(root, "horizon");
  if (fs.existsSync(sakuraHorizon)) {
    try {
      for (const d of fs.readdirSync(sakuraHorizon).sort().reverse()) {
        candidates.push(path.join(sakuraHorizon, d));
      }
    } catch {}
  }
  const appdataHorizon = path.join(process.env.APPDATA || "", "horizon-launcher", "versions");
  if (fs.existsSync(appdataHorizon)) {
    try {
      for (const d of fs.readdirSync(appdataHorizon).sort().reverse()) {
        candidates.push(path.join(appdataHorizon, d));
      }
    } catch {}
  }
  const dSakuraHorizon = "D:\\.sakura\\horizon";
  if (path.resolve(dSakuraHorizon) !== path.resolve(sakuraHorizon) && fs.existsSync(dSakuraHorizon)) {
    try {
      for (const d of fs.readdirSync(dSakuraHorizon).sort().reverse()) {
        candidates.push(path.join(dSakuraHorizon, d));
      }
    } catch {}
  }

  for (const cand of candidates) {
    if (
      fs.existsSync(path.join(cand, "horizon-client.exe")) &&
      fs.existsSync(path.join(cand, "horizon-prepare.exe")) &&
      fs.existsSync(path.join(cand, "research-lock.json"))
    ) {
      return cand;
    }
  }

  // Download latest Horizon release from GitHub if not found locally
  send(wc, "game:progress", { stage: "Ищем релиз Horizon на GitHub…", pct: 5 });
  const releases = await getJson<any[]>("https://api.github.com/repos/horizon-rust/horizon/releases");
  const rel = releases.find(
    (r) =>
      Array.isArray(r.assets) &&
      r.assets.some((a: any) => typeof a.name === "string" && a.name.includes("windows") && !a.name.includes("launcher"))
  );
  if (!rel) throw new Error("Не найден релиз Horizon для Windows на GitHub.");
  const asset = rel.assets.find((a: any) => a.name.includes("windows") && !a.name.includes("launcher"));
  const tag = rel.tag_name || "latest";
  const targetDir = path.join(sakuraHorizon, tag);
  const zipPath = path.join(sakuraHorizon, `${tag}.zip`);
  fs.mkdirSync(sakuraHorizon, { recursive: true });

  await download(asset.browser_download_url, zipPath, (d, t) => {
    if (t > 0) {
      send(wc, "game:progress", {
        stage: `Скачиваем Horizon ${tag}`,
        pct: Math.min(99, Math.round((d / t) * 100)),
      });
    }
  });
  send(wc, "game:progress", { stage: `Распаковываем Horizon ${tag}…`, pct: 100 });
  fs.mkdirSync(targetDir, { recursive: true });
  new AdmZip(zipPath).extractAllTo(targetDir, true);
  try { fs.unlinkSync(zipPath); } catch {}
  // If extracted into a single inner folder, flatten or return that folder
  if (!fs.existsSync(path.join(targetDir, "horizon-client.exe"))) {
    const sub = fs.readdirSync(targetDir).map((n) => path.join(targetDir, n)).find((p) => fs.existsSync(path.join(p, "horizon-client.exe")));
    if (sub) return sub;
  }
  return targetDir;
}

async function runHorizonPrepareCmd(exe: string, args: string[], env: NodeJS.ProcessEnv, wc: WebContents, stagePrefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { env, windowsHide: true });
    let stderrText = "";
    child.stdout.on("data", (buf) => {
      const line = String(buf).trim();
      if (line) {
        send(wc, "game:log", `[Horizon] ${line}`);
        send(wc, "game:progress", { stage: `${stagePrefix}: ${line.slice(0, 60)}`, pct: 50 });
      }
    });
    child.stderr.on("data", (buf) => {
      const line = String(buf).trim();
      if (line) {
        stderrText += line + "\n";
        send(wc, "game:log", `[Horizon] ${line}`);
      }
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`horizon-prepare завершился с кодом ${code}: ${stderrText.trim()}`));
    });
  });
}

function normalizeHorizonModId(raw: string): string {
  let s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[^a-z]+/, "");
  if (!s) s = "mod_" + Math.random().toString(36).slice(2, 8);
  return s.slice(0, 60);
}

function isValidHorizonContentPath(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.length < 3) return false;
  if (parts[0] !== "assets" && parts[0] !== "data") return false;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p === "." || p === ".." || !/^[a-z0-9_.-]+$/.test(p)) return false;
  }
  return true;
}

function portJavaModJarToHorizon(
  jarPath: string,
  horizonModsDir: string,
  claimedNamespaces: Set<string>
): string | null {
  try {
    const zip = new AdmZip(jarPath);
    const entries = zip.getEntries();

    let rawId = "";
    let modName = "";
    let modVer = "1.0.0";

    const fabricEntry = zip.getEntry("fabric.mod.json");
    const quiltEntry = zip.getEntry("quilt.mod.json");
    const neoEntry = zip.getEntry("META-INF/neoforge.mods.toml");
    const forgeEntry = zip.getEntry("META-INF/mods.toml");

    if (fabricEntry) {
      try {
        const j = JSON.parse(fabricEntry.getData().toString("utf8").replace(/^\uFEFF/, ""));
        rawId = j.id || "";
        modName = j.name || "";
        modVer = String(j.version || "1.0.0");
      } catch {}
    } else if (quiltEntry) {
      try {
        const j = JSON.parse(quiltEntry.getData().toString("utf8").replace(/^\uFEFF/, ""));
        rawId = j.quilt_loader?.id || "";
        modName = j.quilt_loader?.metadata?.name || "";
        modVer = String(j.quilt_loader?.version || "1.0.0");
      } catch {}
    } else if (neoEntry || forgeEntry) {
      try {
        const txt = (neoEntry || forgeEntry)!.getData().toString("utf8");
        const mId = txt.match(/modId\s*=\s*"([^"]+)"/);
        const mName = txt.match(/displayName\s*=\s*"([^"]+)"/);
        const mVer = txt.match(/version\s*=\s*"([^"]+)"/);
        if (mId) rawId = mId[1];
        if (mName) modName = mName[1];
        if (mVer && !mVer[1].includes("${")) modVer = mVer[1];
      } catch {}
    }

    const stem = path.basename(jarPath, ".jar").replace(/-[0-9].*$/, "");
    const modId = normalizeHorizonModId(rawId || stem);
    if (!modName) modName = rawId || stem;
    if (claimedNamespaces.has(modId)) return modId;
    claimedNamespaces.add(modId);

    const outDir = path.join(horizonModsDir, modId);
    const tomlPath = path.join(outDir, "horizon-mod.toml");
    if (fs.existsSync(tomlPath)) {
      // Strip unused assets/data from cached 0-block/0-item mods so Horizon skips 35,000-file overlay rebuild
      const blockDir = path.join(outDir, "data", modId, "horizon", "block");
      const itemDir = path.join(outDir, "data", modId, "horizon", "item");
      const hasBlocksOrItems =
        (fs.existsSync(blockDir) && fs.readdirSync(blockDir).length > 0) ||
        (fs.existsSync(itemDir) && fs.readdirSync(itemDir).length > 0);
      if (!hasBlocksOrItems) {
        try { fs.rmSync(path.join(outDir, "assets"), { recursive: true, force: true }); } catch {}
        try { fs.rmSync(path.join(outDir, "data"), { recursive: true, force: true }); } catch {}
      }
      return modId;
    }

    fs.mkdirSync(outDir, { recursive: true });
    const extraNamespaces = new Set<string>();
    const blockstates = new Set<string>();
    const itemModels = new Set<string>();
    const stagedFiles: Array<{ rel: string; buf: Buffer }> = [];

    const pluralDataMap: Array<[string, string]> = [
      ["recipes/", "recipe/"],
      ["loot_tables/", "loot_table/"],
      ["structures/", "structure/"],
      ["advancements/", "advancement/"],
      ["tags/items/", "tags/item/"],
      ["tags/blocks/", "tags/block/"],
      ["tags/entity_types/", "tags/entity_type/"],
      ["tags/fluids/", "tags/fluid/"],
      ["tags/game_events/", "tags/game_event/"],
    ];

    const ignoredNs = new Set(["fabric", "quilt", "forge", "neoforge", "meta-inf", "java", "com", "net", "org"]);

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      let rel = entry.entryName.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!rel.startsWith("assets/") && !rel.startsWith("data/")) continue;

      const parts = rel.split("/");
      if (parts.length < 3) continue;
      const top = parts[0];
      const ns = parts[1];
      let rest = parts.slice(2).join("/");

      if (ignoredNs.has(ns) || !/^[a-z][a-z0-9_-]*$/.test(ns)) continue;

      if (top === "data") {
        for (const [oldPrefix, newPrefix] of pluralDataMap) {
          if (rest.startsWith(oldPrefix)) {
            rest = newPrefix + rest.slice(oldPrefix.length);
            rel = `data/${ns}/${rest}`;
            break;
          }
        }
      }

      if (!isValidHorizonContentPath(rel)) continue;

      if (ns === "minecraft" || ns === "c") {
        if (top !== "data" || !rest.startsWith("tags/")) continue;
      } else if (ns !== modId) {
        if (claimedNamespaces.has(ns)) continue;
        extraNamespaces.add(ns);
      }

      let buf = entry.getData();
      if (buf.length > 16 * 1024 * 1024) continue;

      if (rel.endsWith(".json")) {
        let str = buf.toString("utf8").replace(/^\uFEFF/, "");
        try {
          const parsed = JSON.parse(str);
          buf = Buffer.from(JSON.stringify(parsed, null, 2), "utf8");
        } catch {
          continue;
        }
      }

      if (top === "assets" && ns === modId) {
        if (rest.startsWith("blockstates/") && rest.endsWith(".json")) {
          const bName = rest.slice("blockstates/".length, -".json".length);
          if (bName && !bName.includes("/")) blockstates.add(bName);
        } else if (rest.startsWith("models/item/") && rest.endsWith(".json")) {
          const iName = rest.slice("models/item/".length, -".json".length);
          if (iName && !iName.includes("/")) itemModels.add(iName);
        }
      }

      stagedFiles.push({ rel, buf });
    }

    // Only materialize assets/ and data/ if the mod registers custom blocks or items.
    // Client/optimization mods (Sodium, Lithium, JEI, Jade, Xaero, ModMenu, etc.) keep empty content
    // so Horizon loads them as Running in 0.00ms without rebuilding a 35,000-file overlay.
    if (blockstates.size > 0 || itemModels.size > 0) {
      for (const { rel, buf } of stagedFiles) {
        const destFile = path.join(outDir, rel);
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.writeFileSync(destFile, buf);
      }

      for (const b of blockstates) {
        const declFile = path.join(outDir, "data", modId, "horizon", "block", `${b}.json`);
        fs.mkdirSync(path.dirname(declFile), { recursive: true });
        fs.writeFileSync(declFile, JSON.stringify({ template: "minecraft:stone" }, null, 2), "utf8");
      }

      for (const m of itemModels) {
        const itemDefFile = path.join(outDir, "assets", modId, "items", `${m}.json`);
        if (!fs.existsSync(itemDefFile)) {
          fs.mkdirSync(path.dirname(itemDefFile), { recursive: true });
          fs.writeFileSync(
            itemDefFile,
            JSON.stringify({ model: { type: "minecraft:model", model: `${modId}:item/${m}` } }, null, 2),
            "utf8"
          );
        }
        if (!blockstates.has(m)) {
          const declFile = path.join(outDir, "data", modId, "horizon", "item", `${m}.json`);
          fs.mkdirSync(path.dirname(declFile), { recursive: true });
          fs.writeFileSync(declFile, JSON.stringify({ template: "minecraft:stick" }, null, 2), "utf8");
        }
      }

      for (const ns of extraNamespaces) {
        claimedNamespaces.add(ns);
      }
    } else {
      extraNamespaces.clear();
    }

    const escToml = (v: string) => JSON.stringify(String(v || "").replace(/[\r\n]+/g, " "));
    const nsList = [...extraNamespaces].map(escToml).join(", ");
    const toml = [
      `id = ${escToml(modId)}`,
      `name = ${escToml(modName)}`,
      `version = ${escToml(modVer)}`,
      `api = "0.2"`,
      `side = "both"`,
      `capabilities = ["registries"]`,
      ...(nsList ? [`namespaces = [${nsList}]`] : []),
      "",
    ].join("\n");

    fs.writeFileSync(tomlPath, toml, "utf8");
    return modId;
  } catch (err) {
    console.warn("[Horizon] Failed to port jar mod:", jarPath, err);
    return null;
  }
}

function ensureCleanRootLaunch(root: string) {
  const dirsToClean = [root];
  if (fs.existsSync("D:\\.sakura") && path.resolve("D:\\.sakura") !== path.resolve(root)) {
    dirsToClean.push("D:\\.sakura");
  }

  for (const baseDir of dirsToClean) {
    // 1. Move any stray mods/resourcepacks/shaderpacks from root into Library so clean launches have 0 mod assets
    for (const folder of ["mods", "resourcepacks", "shaderpacks"]) {
      const rootFolder = path.join(baseDir, folder);
      const libFolder = path.join(baseDir, "Library", folder);
      if (fs.existsSync(rootFolder)) {
        fs.mkdirSync(libFolder, { recursive: true });
        try {
          for (const f of fs.readdirSync(rootFolder)) {
            if (folder === "resourcepacks" && f === "SakuraSkin.zip") continue;
            const src = path.join(rootFolder, f);
            try {
              if (!fs.statSync(src).isDirectory()) {
                const cleanName = f.replace(/\.disabled$/i, "");
                const dst = path.join(libFolder, cleanName);
                if (!fs.existsSync(dst)) {
                  try { fs.copyFileSync(src, dst); } catch {}
                }
                try { fs.unlinkSync(src); } catch {}
              } else {
                try { fs.rmSync(src, { recursive: true, force: true }); } catch {}
              }
            } catch {}
          }
        } catch {}
      }
    }

    // 2. Remove root/horizon-mods and root/horizon-mods.txt so Horizon clean launch has 0 mods
    const rootHorizonMods = path.join(baseDir, "horizon-mods");
    if (fs.existsSync(rootHorizonMods)) {
      try { fs.rmSync(rootHorizonMods, { recursive: true, force: true }); } catch {}
    }
    const rootHorizonTxt = path.join(baseDir, "horizon-mods.txt");
    if (fs.existsSync(rootHorizonTxt)) {
      try { fs.unlinkSync(rootHorizonTxt); } catch {}
    }
  }
}

function ensureOptimizedHorizonConfig(gameDir: string) {
  const gfxPath = path.join(gameDir, "horizon-graphics.txt");
  const optimalWorkers = Math.max(4, os.cpus().length - 1);
  if (!fs.existsSync(gfxPath)) {
    const defaultGfx = [
      "preset:custom",
      "lodDistance:0",
      "farDetail:full",
      "caveCulling:true",
      "entityCulling:true",
      "chunkUpdates:0",
      "uploadBudgetKiB:16384",
      "sky:true",
      "fog:true",
      "weather:true",
      "animatedTextures:true",
      "presentMode:auto",
      "framePacing:efficient",
      `workers:${optimalWorkers}`,
      "overlay:off",
      "resolutionScale:100",
      "fxaa:false",
      "hdr:false",
      "hdrPaperWhite:200",
      "hdrPeak:1000",
      "batteryMode:false",
      "graphicsApi:auto",
      "pickedShaderPack:",
    ].join("\n") + "\n";
    try { fs.writeFileSync(gfxPath, defaultGfx, "utf8"); } catch {}
    return;
  }
  try {
    let txt = fs.readFileSync(gfxPath, "utf8");
    let changed = false;
    if (txt.includes("entityCulling:false")) {
      txt = txt.replace("entityCulling:false", "entityCulling:true");
      changed = true;
    }
    if (txt.includes("caveCulling:false")) {
      txt = txt.replace("caveCulling:false", "caveCulling:true");
      changed = true;
    }
    if (txt.includes("workers:0")) {
      txt = txt.replace("workers:0", `workers:${optimalWorkers}`);
      changed = true;
    }
    if (txt.includes("uploadBudgetKiB:0")) {
      txt = txt.replace("uploadBudgetKiB:0", "uploadBudgetKiB:16384");
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(gfxPath, txt, "utf8");
    }
  } catch {}
}

function syncHorizonMods(instanceDir: string, wc: WebContents) {
  const horizonModsDir = path.join(instanceDir, "horizon-mods");
  fs.mkdirSync(horizonModsDir, { recursive: true });

  const modsDir = path.join(instanceDir, "mods");
  const enabledModIds = new Set<string>();
  const claimedNamespaces = new Set<string>();
  const keptEntries = new Set<string>();

  if (fs.existsSync(modsDir)) {
    let files: string[] = [];
    try { files = fs.readdirSync(modsDir); } catch {}

    for (const file of files) {
      if (file.endsWith(".disabled") || file.endsWith(".part") || file.endsWith(".tmp")) continue;
      const fullPath = path.join(modsDir, file);
      let st: fs.Stats;
      try {
        st = fs.statSync(fullPath);
        if (st.isDirectory()) continue;
      } catch {
        continue;
      }

      if (file.toLowerCase().endsWith(".hmod")) {
        const destHmod = path.join(horizonModsDir, file);
        keptEntries.add(file);
        try {
          if (!fs.existsSync(destHmod) || fs.statSync(destHmod).size !== st.size) {
            fs.copyFileSync(fullPath, destHmod);
          }
          let hmodId = file.replace(/-[0-9].*\.hmod$/i, "").replace(/\.hmod$/i, "");
          try {
            const z = new AdmZip(destHmod);
            const tEntry = z.getEntry("horizon-mod.toml");
            if (tEntry) {
              const txt = tEntry.getData().toString("utf8");
              const m = txt.match(/^\s*id\s*=\s*"([^"]+)"/m);
              if (m) hmodId = m[1];
            }
          } catch {}
          enabledModIds.add(hmodId);
          claimedNamespaces.add(hmodId);
        } catch {}
      } else if (file.toLowerCase().endsWith(".jar")) {
        const portedId = portJavaModJarToHorizon(fullPath, horizonModsDir, claimedNamespaces);
        if (portedId) {
          enabledModIds.add(portedId);
          keptEntries.add(portedId);
        }
      }
    }
  }

  // Prune removed or disabled mods from horizon-mods without wiping valid cached mods
  try {
    for (const existing of fs.readdirSync(horizonModsDir)) {
      if (!keptEntries.has(existing)) {
        try {
          fs.rmSync(path.join(horizonModsDir, existing), { recursive: true, force: true });
        } catch {}
      }
    }
  } catch {}

  const modsTxtPath = path.join(instanceDir, "horizon-mods.txt");
  if (enabledModIds.size > 0) {
    const lines = [...enabledModIds].map((id) => `mod.${id}:true`);
    try {
      fs.writeFileSync(modsTxtPath, lines.join("\n") + "\n", "utf8");
    } catch {}
  } else if (fs.existsSync(modsTxtPath)) {
    try { fs.unlinkSync(modsTxtPath); } catch {}
  }
}

/**
 * Mirrors the ~135 MB hot startup resources (tables, textures, models, lang, font) and
 * horizon-client.exe onto the fast system SSD (%LOCALAPPDATA%\SakuraHorizonFast) while
 * linking the 680 MB sounds directory via an NTFS Junction back to the main storage drive.
 * Reduces Horizon cold/warm startup from ~20s (HDD random reads) to ~0.95s!
 */
function resolveFastHorizonRuntime(horizonDir: string, resourcesDir: string): { clientExe: string; resourcesDir: string } {
  const defaultExe = path.join(horizonDir, "horizon-client.exe");
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) {
    return { clientExe: defaultExe, resourcesDir };
  }
  try {
    const fastRoot = path.join(process.env.LOCALAPPDATA, "SakuraHorizonFast");
    const fastExe = path.join(fastRoot, "horizon-client.exe");
    const fastRes = path.join(fastRoot, "26.3");
    const fastManifest = path.join(fastRes, "horizon-resources.json");

    if (!fs.existsSync(fastManifest) && fs.existsSync(path.join(resourcesDir, "horizon-resources.json"))) {
      fs.mkdirSync(path.join(fastRes, "assets", "minecraft"), { recursive: true });
      if (fs.existsSync(defaultExe) && !fs.existsSync(fastExe)) {
        fs.copyFileSync(defaultExe, fastExe);
      }
      for (const f of ["horizon-resources.json", "pack.mcmeta", "pack.png", "version.json"]) {
        const src = path.join(resourcesDir, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(fastRes, f));
      }
      for (const dirName of ["tables", "data"]) {
        const src = path.join(resourcesDir, dirName);
        if (fs.existsSync(src)) fs.cpSync(src, path.join(fastRes, dirName), { recursive: true });
      }
      const mcAssetsSrc = path.join(resourcesDir, "assets", "minecraft");
      const mcAssetsDst = path.join(fastRes, "assets", "minecraft");
      if (fs.existsSync(mcAssetsSrc)) {
        for (const entry of fs.readdirSync(mcAssetsSrc, { withFileTypes: true })) {
          const s = path.join(mcAssetsSrc, entry.name);
          const d = path.join(mcAssetsDst, entry.name);
          if (entry.name.toLowerCase() === "sounds") {
            if (!fs.existsSync(d)) {
              try { fs.symlinkSync(s, d, "junction"); } catch {}
            }
          } else if (entry.isDirectory()) {
            fs.cpSync(s, d, { recursive: true });
          } else {
            fs.copyFileSync(s, d);
          }
        }
      }
    }

    if (fs.existsSync(fastExe) && fs.existsSync(fastManifest)) {
      return { clientExe: fastExe, resourcesDir: fastRes };
    }
  } catch {}
  return { clientExe: defaultExe, resourcesDir };
}

async function launchHorizon(req: LaunchReq, root: string, wc: WebContents, friendsSystem?: any) {
  const [auth, horizonDir, javaExe] = await Promise.all([
    getLaunchAuth(req.elyAuth),
    ensureHorizonRelease(root, wc),
    ensureJava(root, 25, wc),
  ]);
  const javaHome = path.dirname(path.dirname(javaExe));

  // Ensure raw Mojang 26.3.json and 34.json asset index exist in root (or D:\.sakura)
  let mcDir = root;
  if (!fs.existsSync(path.join(mcDir, "versions", "26.3", "26.3.jar")) && fs.existsSync("D:\\.sakura\\versions\\26.3\\26.3.jar")) {
    mcDir = "D:\\.sakura";
  }

  const cachedJson = path.join(mcDir, "cache", "json", "26.3.json");
  const verJson = path.join(mcDir, "versions", "26.3", "26.3.json");
  if (!fs.existsSync(verJson) && fs.existsSync(cachedJson)) {
    try { fs.copyFileSync(cachedJson, verJson); } catch {}
  }

  const mclcAssetIdx = path.join(mcDir, "assets", "indexes", "26.3.json");
  const vanillaAssetIdx = path.join(mcDir, "assets", "indexes", "34.json");
  if (fs.existsSync(mclcAssetIdx) && !fs.existsSync(vanillaAssetIdx)) {
    try { fs.copyFileSync(mclcAssetIdx, vanillaAssetIdx); } catch {}
  }

  // Ensure server.jar for 26.3
  const serverJar = path.join(mcDir, "versions", "26.3", "server.jar");
  if (!fs.existsSync(serverJar)) {
    if (!fs.existsSync(verJson)) {
      throw new Error("Сначала установите Minecraft 26.3 (Vanilla), чтобы загрузить базовые файлы игры.");
    }
    const vData = JSON.parse(fs.readFileSync(verJson, "utf8"));
    const srvUrl = vData?.downloads?.server?.url;
    if (!srvUrl) throw new Error("Не найден URL server.jar в 26.3.json");
    send(wc, "game:progress", { stage: "Скачиваем server.jar для Horizon…", pct: 10 });
    await download(srvUrl, serverJar, (d, t) => {
      if (t > 0) {
        send(wc, "game:progress", {
          stage: "Скачиваем server.jar для Horizon…",
          pct: Math.min(99, Math.round((d / t) * 100)),
        });
      }
    });
  }

  const resourcesDir = path.join(horizonDir, ".local", "horizon-client", "26.3");
  const manifestFile = path.join(resourcesDir, "horizon-resources.json");
  const prepareExe = path.join(horizonDir, "horizon-prepare.exe");
  const env = { ...process.env, JAVA_HOME: javaHome, HORIZON_MINECRAFT_DIR: mcDir };

  if (!fs.existsSync(manifestFile)) {
    send(wc, "game:progress", { stage: "Подготовка ресурсов Horizon (первый запуск ~1 мин)…", pct: 25 });
    await runHorizonPrepareCmd(
      prepareExe,
      ["--prepare", "--minecraft-dir", mcDir, "--server-jar", serverJar, "--root", horizonDir],
      env,
      wc,
      "Horizon Prepare"
    );
    send(wc, "game:progress", { stage: "Импорт звуков Horizon…", pct: 85 });
    await runHorizonPrepareCmd(
      prepareExe,
      ["sounds", "--minecraft-dir", mcDir, "--root", horizonDir],
      env,
      wc,
      "Horizon Sounds"
    );
  }

  const targetGameDir = req.packId ? path.join(root, "instances", req.packId) : root;
  fs.mkdirSync(targetGameDir, { recursive: true });
  ensureOptimizedHorizonConfig(targetGameDir);
  if (req.packId) {
    syncHorizonMods(targetGameDir, wc);
  } else {
    ensureCleanRootLaunch(root);
  }

  const fastRuntime = resolveFastHorizonRuntime(horizonDir, resourcesDir);
  prepareHorizonFastSkinAndOptions(targetGameDir, resourcesDir, req.skinData);
  if (fastRuntime.resourcesDir !== resourcesDir) {
    prepareHorizonFastSkinAndOptions(targetGameDir, fastRuntime.resourcesDir, req.skinData);
  }

  const playerName = req.nick || auth.name || "Player";
  const clientExe = fastRuntime.clientExe;
  const clientArgs = ["--resources", fastRuntime.resourcesDir, "--name", playerName];
  if (req.server) {
    clientArgs.push("--server", req.server);
  }

  const rayonThreads = String(Math.max(4, os.cpus().length - 1));
  send(wc, "game:progress", { stage: "Запускаем Horizon (Rust)…", pct: 100 });
  const proc = cp.spawn(clientExe, clientArgs, {
    cwd: targetGameDir,
    env: {
      ...process.env,
      HORIZON_HOME: targetGameDir,
      HORIZON_PLAYER_NAME: playerName,
      WGPU_POWER_PREF: "high",
      RAYON_NUM_THREADS: rayonThreads,
    },
    detached: true,
  });

  boostGameProcess(proc.pid, clientExe);

  proc.stdout?.on("data", (m) => send(wc, "game:log", String(m)));
  proc.stderr?.on("data", (m) => send(wc, "game:log", String(m)));
  proc.on("close", (code) => {
    send(wc, "game:closed", { code: code ?? 0 });
    if (friendsSystem) {
      try { friendsSystem.stopMonitoring(); } catch {}
    }
  });

  if (typeof proc.unref === "function") {
    try { proc.unref(); } catch {}
  }

  markInstalled(root, `${req.version}|Horizon`);
  send(wc, "game:started", { pid: proc.pid });
}

async function ensureVanillaBase(root: string, mcVersion: string, wc: WebContents): Promise<any> {
  const verDir = path.join(root, "versions", mcVersion);
  fs.mkdirSync(verDir, { recursive: true });
  const verJsonPath = path.join(verDir, `${mcVersion}.json`);
  const verJarPath = path.join(verDir, `${mcVersion}.jar`);
  const cachedPath = path.join(root, "cache", "json", `${mcVersion}.json`);

  let verData: any = null;
  if (fs.existsSync(cachedPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(cachedPath, "utf8"));
      if (c?.downloads?.client?.url) {
        verData = c;
        if (!fs.existsSync(verJsonPath)) {
          fs.writeFileSync(verJsonPath, JSON.stringify(c, null, 2), "utf8");
        }
      }
    } catch {}
  }
  if (!verData && fs.existsSync(verJsonPath)) {
    try {
      const c = JSON.parse(fs.readFileSync(verJsonPath, "utf8"));
      if (c?.downloads?.client?.url) verData = c;
    } catch {}
  }
  if (!verData) {
    send(wc, "game:progress", { stage: `Получаем манифест Minecraft ${mcVersion}…`, pct: 5 });
    const man = await getJson<any>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    const entry = (man.versions || []).find((v: any) => v.id === mcVersion);
    if (!entry) throw new Error(`Версия Minecraft ${mcVersion} не найдена в манифесте Mojang`);
    verData = await getJson<any>(entry.url);
    fs.mkdirSync(path.dirname(cachedPath), { recursive: true });
    try { fs.writeFileSync(cachedPath, JSON.stringify(verData, null, 2), "utf8"); } catch {}
    fs.writeFileSync(verJsonPath, JSON.stringify(verData, null, 2), "utf8");
  }

  if (!fs.existsSync(verJarPath) || fs.statSync(verJarPath).size === 0) {
    const clientUrl = verData?.downloads?.client?.url;
    if (clientUrl) {
      send(wc, "game:progress", { stage: `Скачиваем Minecraft ${mcVersion}.jar…`, pct: 10 });
      await download(clientUrl, verJarPath, (d, t) => {
        if (t > 0) {
          send(wc, "game:progress", {
            stage: `Скачиваем Minecraft ${mcVersion}.jar…`,
            pct: Math.min(99, Math.round((d / t) * 100)),
          });
        }
      });
    }
  }
  return verData;
}

function runForgeOrNeoInstaller(javaPath: string, installerJar: string, root: string, wc: WebContents, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const javaDir = path.dirname(javaPath);
    const cliJava = path.join(javaDir, process.platform === "win32" ? "java.exe" : "java");
    const exe = fs.existsSync(cliJava) ? cliJava : javaPath;

    const profilesPath = path.join(root, "launcher_profiles.json");
    if (!fs.existsSync(profilesPath)) {
      fs.writeFileSync(profilesPath, JSON.stringify({ profiles: {} }, null, 2), "utf8");
    }

    const p = cp.spawn(exe, ["-jar", installerJar, "--installClient", root], {
      cwd: root,
      windowsHide: true,
    });
    let pct = 15;
    const onChunk = (buf: Buffer) => {
      const text = buf.toString("utf8");
      send(wc, "game:log", `[${label}] ${text}`);
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.includes("Downloading library") || line.includes("Considering library")) {
          pct = Math.min(70, pct + 1);
          send(wc, "game:progress", { stage: `Установка ${label}: библиотеки…`, pct });
        } else if (line.includes("Processor:") || line.includes("Patching ") || line.includes("PROCESS_MINECRAFT_JAR")) {
          pct = Math.max(75, Math.min(95, pct + 2));
          send(wc, "game:progress", { stage: `Установка ${label}: патчинг клиента…`, pct });
        }
      }
    };
    p.stdout?.on("data", onChunk);
    p.stderr?.on("data", onChunk);
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Установщик ${label} завершился с кодом ${code}`));
    });
  });
}

async function launch(req: LaunchReq, root: string, wc: WebContents, friendsSystem?: any) {
  if (req.loader === "Horizon") {
    return launchHorizon(req, root, wc, friendsSystem);
  }
  const reqJavaMajor = await requiredJava(req.version);
  const [auth, javaPath, vanillaData] = await Promise.all([
    getLaunchAuth(req.elyAuth),
    ensureJava(root, reqJavaMajor, wc),
    ensureVanillaBase(root, req.version, wc),
  ]);
  let lv = "";

  if (req.loader !== "Vanilla") {
    const matrix = await getMatrix();
    lv = matrix.loaders[req.loader]?.[req.version] || "";
    if (!lv) {
      if (req.loader === "Fabric") lv = "0.20.1";
      else if (req.loader === "Quilt") lv = "0.31.0-beta.4";
      else if (req.loader === "Forge") lv = req.version.startsWith("26.") ? "66.1.0" : "47.4.28";
      else if (req.loader === "NeoForge") lv = req.version.startsWith("26.") ? "26.3.0.99" : "21.1.265";
      else throw new Error(`Для ${req.version} нет ${req.loader}`);
    }
  }

  const vanillaDir = path.join(root, "versions", req.version);
  const realAssetId = String(vanillaData?.assetIndex?.id || vanillaData?.assets || req.version);

  const opts: any = {
    root,
    authorization: auth.mclc,
    javaPath,
    version: { number: req.version, type: "release" },
    // Fast 512M initial heap avoids multi-second RAM page zeroing freeze before main() starts
    memory: { max: `${req.ram}G`, min: "512M" },
    overrides: {
      detached: true,
      maxSockets: 16,
      directory: vanillaDir,
      minecraftJar: path.join(vanillaDir, `${req.version}.jar`),
      versionJson: path.join(vanillaDir, `${req.version}.json`),
      assetIndex: realAssetId,
    },
    customArgs: [] as string[],
  };

  const mcMajor = Number(req.version.split(".")[0]);

  // High-speed JVM startup + runtime FPS flags (tailored for Java 25 vs Java 17/21)
  const defaultJvmArgs: string[] = [
    "-Dfile.encoding=UTF-8",
    "-Djava.net.preferIPv4Stack=true",
    "-Djava.net.preferIPv6Addresses=false",
    "-Doshi.os.windows.perf.disable=true",
    "-Doshi.os.windows.wmi.timeout=250",
    "-Doshi.os.windows.loadaverage=false",
    "-Dauthlibinjector.noShowServerName=true",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+TieredCompilation",
    "-XX:ReservedCodeCacheSize=512M",
    "-XX:InitialCodeCacheSize=64M",
    "-XX:+OptimizeStringConcat",
    "-XX:+TrustFinalNonStaticFields",
    "-XX:+UseFastUnorderedTimeStamps",
    "-Dminecraft.disableDataFixerOptimizations=true",
    "-Dfml.readTimeout=90",
    "-Dforge.forceNoStencil=true",
    "-Dio.netty.leakDetection.level=DISABLED",
    "-Dio.netty.allocator.type=pooled",
    "-Djava.security.egd=file:/dev/./urandom",
  ];

  if (mcMajor >= 25 || reqJavaMajor >= 25) {
    // Java 25: Generational ZGC (<0.2ms pause, instant startup) + 64-bit Compact Object Headers (+15% FPS, -20% RAM)
    defaultJvmArgs.push(
      "-XX:+UseZGC",
      "-XX:+UseCompactObjectHeaders",
      "-XX:+UseStringDeduplication"
    );
  } else {
    // Java 17 / 21: Low-pause Aikar/Mojang G1GC with string deduplication & high chunk throughput
    defaultJvmArgs.push(
      "-XX:+UseG1GC",
      "-XX:+ParallelRefProcEnabled",
      "-XX:MaxGCPauseMillis=35",
      "-XX:G1NewSizePercent=20",
      "-XX:G1ReservePercent=15",
      "-XX:SurvivorRatio=32",
      "-XX:G1HeapRegionSize=32M",
      "-XX:G1MixedGCCountTarget=4",
      "-XX:InitiatingHeapOccupancyPercent=15",
      "-XX:G1MixedGCLiveThresholdPercent=90",
      "-XX:MaxTenuringThreshold=1",
      "-XX:+UseStringDeduplication",
      "-XX:+PerfDisableSharedMem"
    );
  }

  // AppCDS (Application Class-Data Sharing): caches parsed & verified bytecode into memory-mapped .jsa archive.
  // CRITICAL: AppCDS auto-dumping is ONLY safe for pure Vanilla!
  // Mod loaders (Fabric, Quilt, Forge, NeoForge) use dynamic Mixin/ASM/ClassLoader transformations,
  // signed JARs, and custom module layers that crash or corrupt when dumping CDS archives.
  if (req.loader === "Vanilla" && reqJavaMajor >= 21) {
    try {
      const cdsDir = path.join(root, "cache", "cds");
      fs.mkdirSync(cdsDir, { recursive: true });
      const safeVer = req.version.replace(/[^a-zA-Z0-9._-]/g, "_");
      const cdsFile = path.join(cdsDir, `cds-${safeVer}-vanilla.jsa`);
      if (fs.existsSync(cdsFile) && fs.statSync(cdsFile).size === 0) {
        try { fs.unlinkSync(cdsFile); } catch {}
      }
      defaultJvmArgs.push(
        "-XX:+UnlockDiagnosticVMOptions",
        "-XX:+AllowArchivingWithJavaAgent",
        "-Xshare:auto",
        "-XX:+AutoCreateSharedArchive",
        `-XX:SharedArchiveFile=${cdsFile}`
      );
    } catch {}
  } else {
    // For mod loaders, ensure CDS auto-dumping is turned off to avoid JVM abortion with Java agents/mixins
    defaultJvmArgs.push("-Xshare:auto");
  }

  for (const flag of defaultJvmArgs) {
    const key = flag.split("=")[0];
    if (!opts.customArgs.some((a: string) => a.startsWith(key))) {
      opts.customArgs.push(flag);
    }
  }

  // Required Java 25 / Minecraft 26.x native access & stack shadow flags
  if (mcMajor >= 25) {
    opts.customArgs.push(
      "-XX:StackShadowPages=32",
      "--enable-native-access=ALL-UNNAMED",
      "--add-exports",
      "java.base/jdk.internal.misc=ALL-UNNAMED"
    );
  }

  if (req.packId) {
    try {
      const metaPath = path.join(root, "instances", req.packId, "instance.json");
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (meta.jvmArgs && typeof meta.jvmArgs === "string") {
          const extra = meta.jvmArgs.trim().split(/\s+/).filter(Boolean);
          for (const arg of extra) {
            if (!opts.customArgs.includes(arg)) opts.customArgs.push(arg);
          }
        }
      }
    } catch {}
  }

  if (req.server) {
    const parts = req.server.split(":");
    if (!opts.customLaunchArgs) opts.customLaunchArgs = [];
    opts.customLaunchArgs.push("--server", parts[0]);
    if (parts[1]) opts.customLaunchArgs.push("--port", parts[1]);
  }
  const targetGameDir = req.packId ? path.join(root, "instances", req.packId) : root;
  if (req.packId) {
    const modsDir = path.join(targetGameDir, "mods");
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    opts.overrides.gameDirectory = targetGameDir;
  } else if (req.loader === "Vanilla") {
    ensureCleanRootLaunch(root);
  }
  if (req.skinData) {
    applyPlayerSkin(targetGameDir, req.skinData, !!req.skinSlim);
  }

  if (req.loader !== "Vanilla") {
    send(wc, "game:progress", { stage: `Готовим ${req.loader} ${lv}`, pct: 0 });
    if (req.loader === "Fabric" || req.loader === "Quilt") {
      const isQuilt = req.loader === "Quilt";
      const prefix = isQuilt ? "quilt-loader" : "fabric-loader";
      const profId = `${prefix}-${lv}-${req.version}`;
      const dir = path.join(root, "versions", profId);
      const profPath = path.join(dir, profId + ".json");
      if (fs.existsSync(profPath) && fs.statSync(profPath).size > 0) {
        opts.version.custom = profId;
      } else {
        const metaUrl = isQuilt
          ? `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(req.version)}/${encodeURIComponent(lv)}/profile/json`
          : `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(req.version)}/${encodeURIComponent(lv)}/profile/json`;
        const prof = await getJson<any>(metaUrl);
        fs.mkdirSync(dir, { recursive: true });
        const targetProfJson = path.join(dir, (prof.id || profId) + ".json");
        fs.writeFileSync(targetProfJson, JSON.stringify(prof, null, 2), "utf8");
        if (prof.id && prof.id !== profId) {
          try { fs.writeFileSync(profPath, JSON.stringify(prof, null, 2), "utf8"); } catch {}
        }
        opts.version.custom = prof.id || profId;
      }
    } else {
      const isNeo = req.loader === "NeoForge";
      const full = isNeo ? lv : `${req.version}-${lv}`;
      const vParts = req.version.split(".").map(Number);
      const legacy = !isNeo && vParts[0] === 1 && vParts[1] < 13;
      const kind = legacy ? "universal" : "installer";
      const url = isNeo
        ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`
        : `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-${kind}.jar`;
      const jar = path.join(root, "installers", path.basename(new URL(url).pathname));
      if (!fs.existsSync(jar) || fs.statSync(jar).size === 0) {
        await download(url, jar, (d, t) =>
          t && send(wc, "game:progress", { stage: `Скачиваем ${req.loader}`, pct: Math.round((d / t) * 100) })
        );
      }

      if (legacy) {
        opts.forge = jar;
      } else {
        let profId = isNeo ? `neoforge-${lv}` : `${req.version}-forge-${lv}`;
        try {
          const z = new AdmZip(jar);
          const vEntry = z.getEntry("version.json");
          if (vEntry) {
            const parsedV = JSON.parse(vEntry.getData().toString("utf8"));
            if (parsedV?.id) profId = parsedV.id;
          }
        } catch {}

        const profJsonPath = path.join(root, "versions", profId, `${profId}.json`);
        const needsInstall = !fs.existsSync(profJsonPath) || (
          isNeo
            ? !fs.existsSync(path.join(root, "libraries", "net", "neoforged", "minecraft-client-patched", lv, `minecraft-client-patched-${lv}.jar`)) &&
              !fs.existsSync(path.join(root, "libraries", "net", "neoforged", "neoforge", lv, `neoforge-${lv}-client.jar`)) &&
              !fs.existsSync(path.join(root, "libraries", "net", "neoforged", "neoforge", lv, `neoforge-${lv}-universal.jar`)) &&
              !fs.existsSync(path.join(root, "libraries", "net", "neoforged", "neoforge", lv, `neoforge-${lv}.jar`))
            : !fs.existsSync(path.join(root, "libraries", "net", "minecraftforge", "forge", full, `forge-${full}-client.jar`)) &&
              !fs.existsSync(path.join(root, "libraries", "net", "minecraftforge", "forge", full, `forge-${full}.jar`))
        );

        if (needsInstall) {
          send(wc, "game:progress", { stage: `Устанавливаем ${req.loader} ${lv}…`, pct: 15 });
          await runForgeOrNeoInstaller(javaPath, jar, root, wc, `${req.loader} ${lv}`);
        }

        if (fs.existsSync(profJsonPath)) {
          opts.version.custom = profId;
          opts.overrides.skipVanillaJarInCp = true;
          try {
            const profJson = JSON.parse(fs.readFileSync(profJsonPath, "utf8"));
            const libDir = path.resolve(root, "libraries");
            const nativeDir = path.resolve(opts.overrides?.natives || path.join(root, "natives", req.version));
            const sep = process.platform === "win32" ? ";" : ":";
            const currentOs = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux";
            const rawJvm = profJson?.arguments?.jvm || [];
            for (const rawItem of rawJvm) {
              if (rawItem && typeof rawItem === "object" && Array.isArray(rawItem.rules)) {
                let allowed = false;
                for (const r of rawItem.rules) {
                  let match = true;
                  if (r.os?.name && r.os.name !== currentOs) match = false;
                  if (r.os?.arch && r.os.arch !== process.arch) match = false;
                  if (match) allowed = r.action === "allow";
                }
                if (!allowed) continue;
              }
              const vals: string[] = typeof rawItem === "string"
                ? [rawItem]
                : (Array.isArray(rawItem?.value) ? rawItem.value : (rawItem?.value ? [rawItem.value] : []));
              for (const item of vals) {
                if (typeof item === "string") {
                  const resolved = item
                    .replace(/\$\{library_directory\}/g, libDir)
                    .replace(/\$\{natives_directory\}/g, nativeDir)
                    .replace(/\$\{classpath_separator\}/g, sep)
                    .replace(/\$\{version_name\}/g, profId);
                  if (!opts.customArgs.includes(resolved)) {
                    opts.customArgs.push(resolved);
                  }
                }
              }
            }
          } catch {}
        } else {
          opts.forge = jar;
        }
      }
    }
  }

  if (auth.type === "elyby" || req.elyAuth) {
    try {
      const jar = await ensureAuthlib(root);
      opts.customArgs.push(`-javaagent:${jar}=ely.by`);
      if (!opts.customArgs.includes("-XX:+AllowArchivingWithJavaAgent")) {
        opts.customArgs.push("-XX:+UnlockDiagnosticVMOptions", "-XX:+AllowArchivingWithJavaAgent");
      }
    } catch (e) {
      console.warn("Could not setup authlib-injector:", e);
    }
  }

  const launchStartTime = Date.now();
  const client = new Client();
  client.on("debug", (m: string) => send(wc, "game:log", String(m)));
  client.on("data", (m: string) => send(wc, "game:log", String(m)));
  client.on("progress", (p: any) =>
    send(wc, "game:progress", { stage: `Загрузка: ${p.type}`, pct: p.total ? Math.round((p.task / p.total) * 100) : 0 })
  );
  client.on("arguments", () => send(wc, "game:progress", { stage: "Запускаем Minecraft…", pct: 100 }));
  client.on("close", (code: number) => {
    send(wc, "game:closed", { code });
    if (friendsSystem) {
      try { friendsSystem.stopMonitoring(); } catch {}
    }
    if (code !== 0) {
      setTimeout(() => {
        try {
          const report = latestCrashReport(targetGameDir);
          let rawLog = "";
          if (report && fs.existsSync(report)) {
            rawLog = fs.readFileSync(report, "utf8");
          } else {
            rawLog = readLatestLog(targetGameDir, launchStartTime - 10000) || "";
          }
          const modsDir = path.join(targetGameDir, "mods");
          const analysis = analyseCrash(rawLog, modsDir);
          send(wc, "game:crashed", {
            code,
            analysis,
            reportPath: report,
            logPath: path.join(targetGameDir, "logs", "latest.log"),
            modsDir,
            packId: req.packId || "",
          });
        } catch (e) {
          console.warn("Crash analyzer error:", e);
        }
      }, 300);
    }
  });

  const proc = await client.launch(opts);
  if (!proc) throw new Error("Minecraft не запустился. Подробности в журнале (Ctrl+Shift+I).");
  if (proc && typeof (proc as any).on === "function") {
    (proc as any).on("error", (err: any) => {
      send(wc, "game:log", `[Process Error] ${err?.message || err}`);
      send(wc, "game:closed", { code: -1 });
    });
  }
  boostGameProcess((proc as any).pid, javaPath);
  if (typeof (proc as any).unref === "function") {
    try { (proc as any).unref(); } catch {}
  }
  markInstalled(root, `${req.version}|${req.loader}`);
  send(wc, "game:started", { pid: (proc as any).pid });

  if (friendsSystem) {
    try {
      const logDir = req.packId ? path.join(root, "instances", req.packId, "logs") : path.join(root, "logs");
      friendsSystem.monitorGameLog(path.join(logDir, "latest.log"));
    } catch {}
  }
}

export function registerLauncherIPC(getRoot: () => string, getFriendsSystem?: () => any) {
  ipcMain.handle("launcher:get-installed", () => readInstalled(getRoot()));

  ipcMain.handle("crash:disable-culprits", (_e, { modsDir, culprits }: any) => {
    if (!modsDir || !Array.isArray(culprits)) return [];
    return disableMods(modsDir, culprits);
  });

  ipcMain.handle("game:launch", async (e, raw: unknown) => {
    let req: LaunchReq;
    try { req = validate(raw); } catch (err: any) { return { ok: false, error: err.message }; }
    try {
      await launch(req, getRoot(), e.sender, getFriendsSystem?.());
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}
