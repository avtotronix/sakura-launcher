/**
 * Real game launch: Java runtime (Adoptium), Fabric / Forge / NeoForge install, MCLC launch.
 */
import { ipcMain, WebContents } from "electron";
import fs from "fs";
import path from "path";
import { Client } from "minecraft-launcher-core";
import AdmZip from "adm-zip";
import { download, getJson, safeId } from "./net";
import { getLaunchAuth } from "./accounts";
import { getMatrix, Loader } from "./versions";

const LOADERS: Loader[] = ["Fabric", "Forge", "NeoForge", "Vanilla"];

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
  const man = await getJson<any>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const v = man.versions.find((x: any) => x.id === mc);
  if (!v) throw new Error(`Версия ${mc} не найдена`);
  const j = await getJson<any>(v.url);
  return j.javaVersion?.majorVersion ?? 8;
}

function findJava(dir: string): string | null {
  const exe = process.platform === "win32" ? "javaw.exe" : "java";
  const walk = (d: string, depth: number): string | null => {
    const cand = path.join(d, "bin", exe);
    if (fs.existsSync(cand)) return cand;
    if (depth <= 0) return null;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { const r = walk(path.join(d, e.name), depth - 1); if (r) return r; }
    }
    return null;
  };
  return fs.existsSync(dir) ? walk(dir, 2) : null;
}

async function ensureJava(root: string, major: number, wc: WebContents): Promise<string> {
  const feature = major === 16 ? 17 : major;
  const dir = path.join(root, "runtime", `java-${feature}`);
  const have = findJava(dir);
  if (have) return have;
  if (process.platform !== "win32") return "java"; // TODO: tar.gz runtimes for macOS/Linux
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  const url = `https://api.adoptium.net/v3/binary/latest/${feature}/ga/windows/${arch}/jre/hotspot/normal/eclipse?project=jdk`;
  const zip = path.join(root, "runtime", `java-${feature}.zip`);
  send(wc, "game:progress", { stage: `Скачиваем Java ${feature}`, pct: 0 });
  await download(url, zip, (d, t) => t && send(wc, "game:progress", { stage: `Скачиваем Java ${feature}`, pct: Math.round((d / t) * 100) }));
  send(wc, "game:progress", { stage: `Распаковываем Java ${feature}`, pct: 100 });
  new AdmZip(zip).extractAllTo(dir, true);
  fs.unlinkSync(zip);
  const j = findJava(dir);
  if (!j) throw new Error("Не удалось установить Java");
  return j;
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
  };
}

async function launch(req: LaunchReq, root: string, wc: WebContents) {
  const auth = await getLaunchAuth(req.elyAuth);
  let lv = "";
  if (req.loader !== "Vanilla") {
    const matrix = await getMatrix();
    lv = matrix.loaders[req.loader][req.version];
    if (!lv) throw new Error(`Для ${req.version} нет ${req.loader}`);
  }

  const javaPath = await ensureJava(root, await requiredJava(req.version), wc);
  const opts: any = {
    root,
    authorization: auth.mclc,
    javaPath,
    version: { number: req.version, type: "release" },
    memory: { max: `${req.ram}G`, min: "1G" },
    overrides: { detached: true, maxSockets: 8 },
    customArgs: [] as string[],
  };
  if (req.packId) {
    const packDir = path.join(root, "instances", req.packId);
    const modsDir = path.join(packDir, "mods");
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    opts.overrides.gameDirectory = packDir;
  }

  if (req.loader !== "Vanilla") {
    send(wc, "game:progress", { stage: `Готовим ${req.loader} ${lv}`, pct: 0 });
    if (req.loader === "Fabric") {
      const profId = `fabric-loader-${lv}-${req.version}`;
      const dir = path.join(root, "versions", profId);
      const profPath = path.join(dir, profId + ".json");
      if (fs.existsSync(profPath)) {
        opts.version.custom = profId;
      } else {
        const prof = await getJson<any>(
          `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(req.version)}/${encodeURIComponent(lv)}/profile/json`
        );
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

  if (auth.type === "elyby" && req.elyAuth) {
    const jar = await ensureAuthlib(root);
    opts.customArgs.push(`-javaagent:${jar}=ely.by`);
  }

  const client = new Client();
  client.on("debug", (m: string) => send(wc, "game:log", String(m)));
  client.on("data", (m: string) => send(wc, "game:log", String(m)));
  client.on("progress", (p: any) =>
    send(wc, "game:progress", { stage: `Загрузка: ${p.type}`, pct: p.total ? Math.round((p.task / p.total) * 100) : 0 })
  );
  client.on("arguments", () => send(wc, "game:progress", { stage: "Запускаем Minecraft…", pct: 100 }));
  client.on("close", (code: number) => { send(wc, "game:closed", { code }); });

  const proc = await client.launch(opts);
  if (!proc) throw new Error("Minecraft не запустился. Подробности в журнале (Ctrl+Shift+I).");
  markInstalled(root, `${req.version}|${req.loader}`);
  send(wc, "game:started", { pid: (proc as any).pid });
}

export function registerLauncherIPC(getRoot: () => string) {
  ipcMain.handle("launcher:get-installed", () => readInstalled(getRoot()));

  ipcMain.handle("game:launch", async (e, raw: unknown) => {
    let req: LaunchReq;
    try { req = validate(raw); } catch (err: any) { return { ok: false, error: err.message }; }
    try {
      await launch(req, getRoot(), e.sender);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}
