/**
 * Minecraft versions + which loaders actually exist for each version.
 * Sources: Mojang manifest, Fabric meta, Forge promotions, NeoForge maven.
 */
import fs from "fs";
import path from "path";
import { getJson } from "./net";

export type Loader = "Fabric" | "Forge" | "NeoForge" | "Vanilla";
export interface Matrix {
  releases: string[]; // newest first
  versionTypes: Record<string, string>;
  latest: string;
  loaders: Record<Loader, Record<string, string>>; // mc -> loader version
  fetchedAt: number;
}

let cache: Matrix | null = null;
let inflight: Promise<Matrix> | null = null;

/** "21.1.77" -> "1.21.1", "21.0.3" -> "1.21", "26.1.0.5" -> "26.1" */
export function neoToMc(v: string): string | null {
  const p = v.split("-")[0].split(".").map(Number);
  if (p.length < 2 || p.some(isNaN)) return null;
  if (p[0] >= 25) return p[2] && p.length > 3 ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`;
  return p[1] === 0 ? `1.${p[0]}` : `1.${p[0]}.${p[1]}`;
}

export async function build(): Promise<Matrix> {
  const [man, fab, fabLoaders, forge, neo] = await Promise.allSettled([
    getJson<any>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"),
    getJson<any[]>("https://meta.fabricmc.net/v2/versions/game"),
    getJson<any[]>("https://meta.fabricmc.net/v2/versions/loader"),
    getJson<any>("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"),
    getJson<any>("https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge"),
  ]);
  if (man.status !== "fulfilled") throw new Error("Нет доступа к серверам Mojang. Проверьте подключение к интернету.");

  const releases: string[] = man.value.versions.map((v: any) => v.id);
  const versionTypes: Record<string, string> = {};
  man.value.versions.forEach((v: any) => { versionTypes[v.id] = v.type; });
  const rel = new Set(releases);
  const loaders: Matrix["loaders"] = { Fabric: {}, Forge: {}, NeoForge: {}, Vanilla: {} };

  if (fab.status === "fulfilled" && fabLoaders.status === "fulfilled") {
    const stableLoader = fabLoaders.value.find((l) => l.stable)?.version || fabLoaders.value[0]?.version;
    for (const g of fab.value) if (rel.has(g.version) && stableLoader) loaders.Fabric[g.version] = stableLoader;
  }
  if (forge.status === "fulfilled") {
    const promos: Record<string, string> = forge.value.promos || {};
    for (const [k, v] of Object.entries(promos)) {
      const [mc, kind] = k.split("-");
      if (!rel.has(mc)) continue;
      if (kind === "recommended" || !loaders.Forge[mc]) loaders.Forge[mc] = v;
    }
  }
  if (neo.status === "fulfilled") {
    const all: string[] = neo.value.versions || [];
    for (const v of all) {
      const mc = neoToMc(v);
      if (!mc || !rel.has(mc)) continue;
      const cur = loaders.NeoForge[mc];
      const beta = v.includes("beta");
      // keep the newest stable; use beta only when there is no stable
      if (!cur || (!beta) || cur.includes("beta")) loaders.NeoForge[mc] = v;
    }
  }
  return { releases, versionTypes, latest: man.value.latest.release, loaders, fetchedAt: Date.now() };
}

export async function getMatrix(force = false): Promise<Matrix> {
  if (cache && !force && Date.now() - cache.fetchedAt < 30 * 60_000) return cache;
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
