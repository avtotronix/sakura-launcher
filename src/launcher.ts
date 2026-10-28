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

const LOADERS: Loader[] = ["Fabric", "Forge", "NeoForge", "Quilt", "Vanilla"];

function send(wc: WebContents, ch: string, data: unknown) {
  if (!wc.isDestroyed()) wc.send(ch, data);
}

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
  if (fs.existsSync(jar)) return jar;
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

    // Ensure options.txt activates this resourcepack
    const optionsPath = path.join(targetDir, "options.txt");
    const packEntry = "\"file/SakuraSkin.zip\"";
    if (fs.existsSync(optionsPath)) {
      let optText = fs.readFileSync(optionsPath, "utf8");
      const match = optText.match(/resourcePacks:\[(.*?)\]/);
      if (match) {
        if (!optText.includes("SakuraSkin.zip")) {
          optText = optText.replace(/resourcePacks:\[/, `resourcePacks:[${packEntry},`);
          fs.writeFileSync(optionsPath, optText, "utf8");
        }
      } else {
        optText += `\nresourcePacks:[${packEntry}]\n`;
        fs.writeFileSync(optionsPath, optText, "utf8");
      }
    } else {
      fs.writeFileSync(optionsPath, `resourcePacks:[${packEntry}]\n`, "utf8");
    }
  } catch (err) {
    console.warn("Could not apply player skin resourcepack:", err);
  }
}

async function launch(req: LaunchReq, root: string, wc: WebContents, friendsSystem?: any) {
  const auth = await getLaunchAuth(req.elyAuth);
  let lv = "";

  if (req.packId) {
    try {
      const metaPath = path.join(root, "instances", req.packId, "instance.json");
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        if (meta.loaderVersion) lv = String(meta.loaderVersion);
      }
    } catch {}
  }

  if (req.loader !== "Vanilla" && !lv) {
    const matrix = await getMatrix();
    lv = matrix.loaders[req.loader]?.[req.version] || "";
    if (!lv) {
      if (req.loader === "Fabric") lv = "0.20.1";
      else if (req.loader === "Quilt") lv = "0.26.0";
      else if (req.loader === "Forge") lv = req.version.startsWith("26.") ? "66.1.0" : "47.4.28";
      else if (req.loader === "NeoForge") lv = req.version.startsWith("26.") ? "26.3.0.99" : "21.1.265";
      else throw new Error(`Для ${req.version} нет ${req.loader}`);
    }
  }

  const javaPath = await ensureJava(root, await requiredJava(req.version), wc);
  const opts: any = {
    root,
    authorization: auth.mclc,
    javaPath,
    version: { number: req.version, type: "release" },
    memory: { max: `${req.ram}G`, min: "1G" },
    overrides: { detached: false, maxSockets: 8 },
    customArgs: [] as string[],
  };

  // Add optimal JVM arguments
  const defaultJvmArgs = [
    "-Dfile.encoding=UTF-8",
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=200",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:+AlwaysPreTouch",
  ];
  for (const flag of defaultJvmArgs) {
    const key = flag.split("=")[0];
    if (!opts.customArgs.some((a: string) => a.startsWith(key))) {
      opts.customArgs.push(flag);
    }
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
    opts.customArgs.push("--server", parts[0]);
    if (parts[1]) opts.customArgs.push("--port", parts[1]);
  }
  const targetGameDir = req.packId ? path.join(root, "instances", req.packId) : root;
  if (req.packId) {
    const modsDir = path.join(targetGameDir, "mods");
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    opts.overrides.gameDirectory = targetGameDir;
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
      if (fs.existsSync(profPath)) {
        opts.version.custom = profId;
      } else {
        const metaUrl = isQuilt
          ? `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(req.version)}/${encodeURIComponent(lv)}/profile/json`
          : `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(req.version)}/${encodeURIComponent(lv)}/profile/json`;
        const prof = await getJson<any>(metaUrl);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, prof.id + ".json"), JSON.stringify(prof));
        opts.version.custom = prof.id;
      }
    } else {
      const isNeo = req.loader === "NeoForge";
      const full = isNeo ? lv : `${req.version}-${lv}`;
      const legacy = !isNeo && Number(req.version.split(".")[1]) < 13;
      const kind = legacy ? "universal" : "installer";
      const url = isNeo
        ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`
        : `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-${kind}.jar`;
      const jar = path.join(root, "installers", path.basename(new URL(url).pathname));
      if (!fs.existsSync(jar)) {
        await download(url, jar, (d, t) => t && send(wc, "game:progress", { stage: `Скачиваем ${req.loader}`, pct: Math.round((d / t) * 100) }));
      }
      opts.forge = jar;
    }
  }

  if (auth.type === "elyby" || req.elyAuth) {
    try {
      const jar = await ensureAuthlib(root);
      opts.customArgs.push(`-javaagent:${jar}=ely.by`);
    } catch (e) {
      console.warn("Could not setup authlib-injector:", e);
    }
  }

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
  });

  const proc = await client.launch(opts);
  if (!proc) throw new Error("Minecraft не запустился. Подробности в журнале (Ctrl+Shift+I).");
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
