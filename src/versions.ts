/**
 * Minecraft versions + which loaders actually exist for each version.
 * Sources: Mojang manifest, Fabric meta, Forge promotions, NeoForge maven.
 */
import fs from "fs";
import path from "path";
import { getJson } from "./net";

export type Loader = "Fabric" | "Forge" | "NeoForge" | "Quilt" | "Vanilla";
export interface Matrix {
  releases: string[]; // newest first
  versionTypes: Record<string, string>;
  latest: string;
  loaders: Record<Loader, Record<string, string>>; // mc -> loader version
  loaderVersions?: Record<Loader, Record<string, string[]>>; // mc -> all available loader versions
  fetchedAt: number;
}

const FALLBACK_RELEASES = [
  "26.3","26.2","26.1.2","26.1.1","26.1",
  "1.21.11","1.21.10","1.21.9","1.21.8","1.21.7","1.21.6","1.21.5","1.21.4","1.21.3","1.21.2","1.21.1","1.21",
  "1.20.6","1.20.5","1.20.4","1.20.3","1.20.2","1.20.1","1.20",
  "1.19.4","1.19.3","1.19.2","1.19.1","1.19",
  "1.18.2","1.18.1","1.18",
  "1.17.1","1.17",
  "1.16.5","1.16.4","1.16.3","1.16.2","1.16.1","1.16",
  "1.15.2","1.15.1","1.15",
  "1.14.4","1.14.3","1.14.2","1.14.1","1.14",
  "1.13.2","1.13.1","1.13",
  "1.12.2","1.12.1","1.12",
  "1.11.2","1.11.1","1.11",
  "1.10.2","1.10.1","1.10",
  "1.9.4","1.9.3","1.9.2","1.9.1","1.9",
  "1.8.9","1.8.8","1.8.7","1.8.6","1.8.5","1.8.4","1.8.3","1.8.2","1.8.1","1.8",
  "1.7.10","1.7.9","1.7.8","1.7.7","1.7.6","1.7.5","1.7.4","1.7.3","1.7.2",
  "1.6.4","1.6.2","1.6.1",
  "1.5.2","1.5.1",
  "1.4.7","1.4.6","1.4.5","1.4.4","1.4.2",
  "1.3.2","1.3.1",
  "1.2.5","1.2.4","1.2.3","1.2.2","1.2.1",
  "1.1","1.0"
];

let cache: Matrix | null = null;
let inflight: Promise<Matrix> | null = null;

const CACHE_FILE = path.join(__dirname, "..", "version.json");

function readDiskCache(): Matrix | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      if (data && Array.isArray(data.releases) && data.releases.length > 0) {
        return data as Matrix;
      }
    }
  } catch {}
  return null;
}

function writeDiskCache(m: Matrix): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(m), "utf8");
  } catch {}
}

/** "21.1.77" -> "1.21.1", "21.0.3" -> "1.21", "26.3.0.99" -> "26.3" */
export function neoToMc(v: string): string | null {
  const p = v.split("-")[0].split(".").map(Number);
  if (p.length < 2 || p.some(isNaN)) return null;
  if (p[0] >= 25) return p[2] > 0 && p.length > 3 ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`;
  return p[1] === 0 ? `1.${p[0]}` : `1.${p[0]}.${p[1]}`;
}

export async function build(): Promise<Matrix> {
  const [man, fab, fabLoaders, forge, neo, quiltLoaders] = await Promise.allSettled([
    getJson<any>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"),
    getJson<any[]>("https://meta.fabricmc.net/v2/versions/game"),
    getJson<any[]>("https://meta.fabricmc.net/v2/versions/loader"),
    getJson<any>("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"),
    getJson<any>("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge"),
    getJson<any[]>("https://meta.quiltmc.org/v3/versions/loader"),
  ]);

  let releases: string[] = [];
  const versionTypes: Record<string, string> = {};
  let latest = "26.3";

  if (man.status === "fulfilled" && man.value?.versions) {
    releases = man.value.versions.map((v: any) => v.id);
    man.value.versions.forEach((v: any) => { versionTypes[v.id] = v.type; });
    latest = man.value.latest?.release || "26.3";
  } else {
    // If Mojang is temporarily unreachable, check disk cache or fallback
    const disk = readDiskCache();
    if (disk && disk.releases && disk.releases.length > 0) {
      return disk;
    }
    releases = [...FALLBACK_RELEASES];
    releases.forEach((r) => { versionTypes[r] = "release"; });
  }

  // Ensure "26.3" is included at the top of releases if not present
  if (!releases.includes("26.3")) {
    releases.unshift("26.3");
    versionTypes["26.3"] = "release";
  }

  const rel = new Set(releases);
  const loaders: Matrix["loaders"] = { Fabric: {}, Forge: {}, NeoForge: {}, Quilt: {}, Vanilla: {} };
  const loaderVersions: Matrix["loaderVersions"] = { Fabric: {}, Forge: {}, NeoForge: {}, Quilt: {}, Vanilla: {} };

  if (fab.status === "fulfilled" && fabLoaders.status === "fulfilled" && Array.isArray(fab.value)) {
    const allLoaders = (fabLoaders.value || []).map((l: any) => l.version);
    const stableLoader = fabLoaders.value.find((l) => l.stable)?.version || fabLoaders.value[0]?.version || "0.20.1";
    for (const g of fab.value) {
      if (rel.has(g.version)) {
        loaders.Fabric[g.version] = stableLoader;
        loaderVersions.Fabric[g.version] = allLoaders.slice(0, 10);
      }
    }
  }
  // Ensure Fabric has loader for 26.3 and key versions
  if (!loaders.Fabric["26.3"]) loaders.Fabric["26.3"] = "0.20.1";
  if (!loaderVersions.Fabric["26.3"]) loaderVersions.Fabric["26.3"] = ["0.20.1", "0.16.10"];

  if (quiltLoaders.status === "fulfilled" && Array.isArray(quiltLoaders.value)) {
    const qVersions = quiltLoaders.value.map((l: any) => l.version);
    const stableQuilt = qVersions[0] || "0.26.0";
    for (const r of releases) {
      const parts = r.split(".").map(Number);
      if (parts[0] >= 25 || (parts[0] === 1 && parts[1] >= 14)) {
        loaders.Quilt[r] = stableQuilt;
        loaderVersions.Quilt[r] = qVersions.slice(0, 10);
      }
    }
  }

  if (forge.status === "fulfilled" && forge.value?.promos) {
    const promos: Record<string, string> = forge.value.promos || {};
    for (const [k, v] of Object.entries(promos)) {
      const [mc, kind] = k.split("-");
      if (!rel.has(mc)) continue;
      if (kind === "recommended" || !loaders.Forge[mc]) loaders.Forge[mc] = v;
      if (!loaderVersions.Forge[mc]) loaderVersions.Forge[mc] = [];
      if (!loaderVersions.Forge[mc].includes(v)) loaderVersions.Forge[mc].push(v);
    }
  }
  if (!loaders.Forge["26.3"]) loaders.Forge["26.3"] = "66.1.0";
  if (!loaderVersions.Forge["26.3"]) loaderVersions.Forge["26.3"] = ["66.1.0"];

  if (neo.status === "fulfilled" && Array.isArray(neo.value?.versions)) {
    const all: string[] = neo.value.versions || [];
    for (const v of all) {
      const mc = neoToMc(v);
      if (!mc || !rel.has(mc)) continue;
      const cur = loaders.NeoForge[mc];
      const beta = v.includes("beta");
      if (!cur || (!beta) || cur.includes("beta")) loaders.NeoForge[mc] = v;
      if (!loaderVersions.NeoForge[mc]) loaderVersions.NeoForge[mc] = [];
      if (loaderVersions.NeoForge[mc].length < 10) loaderVersions.NeoForge[mc].push(v);
    }
  }
  if (!loaders.NeoForge["26.3"]) loaders.NeoForge["26.3"] = "26.3.0.99";
  if (!loaderVersions.NeoForge["26.3"]) loaderVersions.NeoForge["26.3"] = ["26.3.0.99"];

  const result: Matrix = { releases, versionTypes, latest, loaders, loaderVersions, fetchedAt: Date.now() };
  writeDiskCache(result);
  return result;
}

export async function getMatrix(force = false): Promise<Matrix> {
  if (cache && !force) return cache;
  const disk = readDiskCache();
  if (disk && disk.releases && disk.releases.length > 0) {
    cache = disk;
    // Asynchronously refresh in background without blocking launcher startup
    if (Date.now() - (disk.fetchedAt || 0) > 120 * 60_000) {
      setTimeout(() => { build().then((m) => { cache = m; }).catch(() => {}); }, 2000);
    }
    return disk;
  }
  if (!inflight) inflight = build().then((m) => (cache = m)).finally(() => (inflight = null));
  return inflight;
}

/** Which "<mc>|<Loader>" combos are already installed in the game dir. */
export function installedCombos(root: string): string[] {
  const out: string[] = [];
  try {
    for (const d of fs.readdirSync(path.join(root, "versions"))) {
      const json = path.join(root, "versions", d, d + ".json");
      if (!fs.existsSync(json)) continue;
      let m: RegExpMatchArray | null;
      if ((m = d.match(/^fabric-loader-[^-]+-(.+)$/))) out.push(`${m[1]}|Fabric`);
      else if ((m = d.match(/^sakura-forge-(.+)$/))) out.push(`${m[1]}|Forge`);
      else if ((m = d.match(/^sakura-neoforge-(.+)$/))) out.push(`${m[1]}|NeoForge`);
    }
  } catch { /* no versions yet */ }
  return out;
}
