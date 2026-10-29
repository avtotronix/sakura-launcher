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

const LOADERS: Loader[] = ["Fabric", "Forge", "NeoForge", "Quilt", "Horizon", "Vanilla"];

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
      return modId;
    }

    fs.mkdirSync(outDir, { recursive: true });
    const extraNamespaces = new Set<string>();
    const blockstates = new Set<string>();
    const itemModels = new Set<string>();
    let filesWritten = 0;

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

      const destFile = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.writeFileSync(destFile, buf);
      filesWritten++;
    }

    for (const b of blockstates) {
      const declFile = path.join(outDir, "data", modId, "horizon", "block", `${b}.json`);
      fs.mkdirSync(path.dirname(declFile), { recursive: true });
      fs.writeFileSync(declFile, JSON.stringify({ template: "minecraft:stone" }, null, 2), "utf8");
      filesWritten++;
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
        filesWritten++;
      }
      if (!blockstates.has(m)) {
        const declFile = path.join(outDir, "data", modId, "horizon", "item", `${m}.json`);
        fs.mkdirSync(path.dirname(declFile), { recursive: true });
        fs.writeFileSync(declFile, JSON.stringify({ template: "minecraft:stick" }, null, 2), "utf8");
        filesWritten++;
      }
    }

    if (filesWritten === 0) {
      const fallbackLang = path.join(outDir, "assets", modId, "lang", "en_us.json");
      fs.mkdirSync(path.dirname(fallbackLang), { recursive: true });
      fs.writeFileSync(fallbackLang, "{}\n", "utf8");
    }

    for (const ns of extraNamespaces) {
      claimedNamespaces.add(ns);
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

function syncHorizonMods(instanceDir: string, wc: WebContents) {
  const horizonModsDir = path.join(instanceDir, "horizon-mods");
  // Recreate horizon-mods cleanly from the instance's active mods
  if (fs.existsSync(horizonModsDir)) {
    try { fs.rmSync(horizonModsDir, { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(horizonModsDir, { recursive: true });

  const modsDir = path.join(instanceDir, "mods");
  const enabledModIds = new Set<string>();
  const claimedNamespaces = new Set<string>();

  if (fs.existsSync(modsDir)) {
    let files: string[] = [];
    try { files = fs.readdirSync(modsDir); } catch {}

    for (const file of files) {
      if (file.endsWith(".disabled") || file.endsWith(".part") || file.endsWith(".tmp")) continue;
      const fullPath = path.join(modsDir, file);
      try {
        if (fs.statSync(fullPath).isDirectory()) continue;
      } catch {
        continue;
      }

      if (file.toLowerCase().endsWith(".hmod")) {
        const destHmod = path.join(horizonModsDir, file);
        try {
          fs.copyFileSync(fullPath, destHmod);
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
        send(wc, "game:progress", { stage: `Адаптация мода ${file} для Horizon…`, pct: 92 });
        const portedId = portJavaModJarToHorizon(fullPath, horizonModsDir, claimedNamespaces);
        if (portedId) {
          enabledModIds.add(portedId);
        }
      }
    }
  }

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

async function launchHorizon(req: LaunchReq, root: string, wc: WebContents, friendsSystem?: any) {
  const auth = await getLaunchAuth(req.elyAuth);
  const horizonDir = await ensureHorizonRelease(root, wc);
  const javaExe = await ensureJava(root, 25, wc);
  const javaHome = path.dirname(path.dirname(javaExe));

  // Ensure raw Mojang 26.3.json and 34.json asset index exist in root (or D:\.sakura)
  let mcDir = root;
  if (!fs.existsSync(path.join(mcDir, "versions", "26.3", "26.3.jar")) && fs.existsSync("D:\\.sakura\\versions\\26.3\\26.3.jar")) {
    mcDir = "D:\\.sakura";
  }

  const cachedJson = path.join(mcDir, "cache", "json", "26.3.json");
  const verJson = path.join(mcDir, "versions", "26.3", "26.3.json");
  if (fs.existsSync(cachedJson)) {
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
  if (req.skinData) {
    applyPlayerSkin(targetGameDir, req.skinData, !!req.skinSlim);
  }
  if (req.packId) {
    syncHorizonMods(targetGameDir, wc);
  } else {
    ensureCleanRootLaunch(root);
  }

  const playerName = req.nick || auth.name || "Player";
  const clientExe = path.join(horizonDir, "horizon-client.exe");
  const clientArgs = ["--resources", resourcesDir, "--name", playerName];
  if (req.server) {
    clientArgs.push("--server", req.server);
  }

  send(wc, "game:progress", { stage: "Запускаем Horizon (Rust)…", pct: 100 });
  const proc = cp.spawn(clientExe, clientArgs, {
    cwd: targetGameDir,
    env: {
      ...process.env,
      HORIZON_HOME: targetGameDir,
      HORIZON_PLAYER_NAME: playerName,
    },
    detached: true,
  });

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

async function launch(req: LaunchReq, root: string, wc: WebContents, friendsSystem?: any) {
  if (req.loader === "Horizon") {
    return launchHorizon(req, root, wc, friendsSystem);
  }
  const auth = await getLaunchAuth(req.elyAuth);
  let lv = "";

  if (req.loader !== "Vanilla") {
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
    overrides: { detached: true, maxSockets: 8 },
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
  } else {
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
