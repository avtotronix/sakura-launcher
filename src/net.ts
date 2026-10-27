/**
 * Network helpers for the main process.
 * Every outgoing request goes through an HTTPS host allowlist.
 */
import fs from "fs";
import path from "path";

const ALLOWED_HOSTS = [
  "piston-meta.mojang.com",
  "launchermeta.mojang.com",
  "meta.fabricmc.net",
  "maven.fabricmc.net",
  "meta.quiltmc.org",
  "maven.quiltmc.org",
  "files.minecraftforge.net",
  "maven.minecraftforge.net",
  "maven.neoforged.net",
  "api.adoptium.net",
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "authlib-injector.yushi.moe",
  "authserver.ely.by",
  "account.ely.by",
  "api.modrinth.com",
  "cdn.modrinth.com",
  "api.curseforge.com",
  "media.forgecdn.net",
  "edge.forgecdn.net",
  "mediafilez.forgecdn.net",
  "oauth2.googleapis.com",
  "openidconnect.googleapis.com",
  "api.mcsrvstat.us",
];

export function assertAllowed(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error(`Blocked non-HTTPS URL: ${url}`);
  const ok = ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  if (!ok) throw new Error(`Blocked host: ${u.hostname}`);
  return u;
}

export async function getJson<T = any>(url: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  assertAllowed(url);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Download to file (atomic: .part → rename). Redirect targets are re-checked. */
export async function download(
  url: string,
  dest: string,
  onProgress?: (done: number, total: number) => void
): Promise<string> {
  assertAllowed(url);
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${url}`);
  assertAllowed(r.url); // final URL after redirects
  const total = Number(r.headers.get("content-length") || 0);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = dest + ".part";
  const out = fs.createWriteStream(part);
  let done = 0;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      done += value.length;
      if (!out.write(value)) await new Promise<void>((res) => out.once("drain", () => res()));
      onProgress?.(done, total);
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
    fs.renameSync(part, dest);
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(part); } catch { /* ignore */ }
    throw e;
  }
  return dest;
}

/** Strict file-name sanitizer (no path separators, no traversal). */
export function safeName(name: string): string {
  const n = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "_").slice(0, 160);
  if (!n) throw new Error("Bad file name");
  return n;
}

/** Ids we use as folder names (packs, accounts). */
export function safeId(id: unknown): string {
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(id)) throw new Error("Bad id");
  return id;
}
