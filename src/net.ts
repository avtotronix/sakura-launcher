/**
 * Network helpers for the main process.
 * Every outgoing request goes through an HTTPS host allowlist.
 */
import fs from "fs";
import path from "path";

const ALLOWED_HOSTS = [
  "piston-meta.mojang.com",
  "launchermeta.mojang.com",
  "libraries.minecraft.net",
  "resources.download.minecraft.net",
  "meta.fabricmc.net",
  "maven.fabricmc.net",
  "meta.quiltmc.org",
  "maven.quiltmc.org",
  "files.minecraftforge.net",
  "maven.minecraftforge.net",
  "maven.neoforged.net",
  "api.adoptium.net",
  "adoptium.net",
  "aka.ms",
  "download.visualstudio.microsoft.com",
  "msdl.microsoft.com",
  "cdn.azul.com",
  "azul.com",
  "corretto.aws",
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "authlib-injector.yushi.moe",
  "authserver.ely.by",
  "account.ely.by",
  "skinsystem.ely.by",
  "api.modrinth.com",
  "cdn.modrinth.com",
  "api.curseforge.com",
  "media.forgecdn.net",
  "edge.forgecdn.net",
  "mediafilez.forgecdn.net",
  "cursecdn.com",
  "overwolf.com",
  "curseforge.overwolf.com",
  "oauth2.googleapis.com",
  "openidconnect.googleapis.com",
  "api.mcsrvstat.us",
];

export function assertAllowed(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error(`Blocked non-HTTPS URL: ${url}`);
  const hostname = u.hostname.toLowerCase();
  const ok =
    ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h)) ||
    hostname.endsWith(".blob.core.windows.net") ||
    hostname.endsWith(".amazonaws.com");
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

/** Download to file (atomic: .part → rename) with per-chunk timeout and automatic retries. */
export async function download(
  url: string,
  dest: string,
  onProgress?: (done: number, total: number) => void,
  maxRetries = 3
): Promise<string> {
  assertAllowed(url);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const part = dest + ".part";
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(part)) {
        try { fs.unlinkSync(part); } catch {}
      }

      const ctl = new AbortController();
      let connectTimer = setTimeout(() => ctl.abort(new Error("Connection timed out")), 20000);

      const r = await fetch(url, { redirect: "follow", signal: ctl.signal });
      clearTimeout(connectTimer);

      if (!r.ok || !r.body) {
        throw new Error(`HTTP ${r.status} ${r.statusText || ""} for ${url}`);
      }
      assertAllowed(r.url);

      const total = Number(r.headers.get("content-length") || 0);
      const out = fs.createWriteStream(part);
      let done = 0;
      const reader = r.body.getReader();

      const CHUNK_TIMEOUT_MS = 20000; // 20s chunk inactivity timeout

      try {
        for (;;) {
          let chunkTimer: NodeJS.Timeout | null = null;
          const readPromise = reader.read();
          const timeoutPromise = new Promise<never>((_, reject) => {
            chunkTimer = setTimeout(() => {
              ctl.abort();
              reject(new Error(`Download stalled: no data received for ${CHUNK_TIMEOUT_MS / 1000}s`));
            }, CHUNK_TIMEOUT_MS);
          });

          const { done: end, value } = await Promise.race([readPromise, timeoutPromise]);
          if (chunkTimer) clearTimeout(chunkTimer);

          if (end) break;
          done += value.length;
          if (!out.write(value)) {
            await new Promise<void>((res) => out.once("drain", () => res()));
          }
          onProgress?.(done, total);
        }

        await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
        if (fs.existsSync(dest)) {
          try { fs.unlinkSync(dest); } catch {}
        }
        fs.renameSync(part, dest);
        return dest;
      } catch (streamErr: any) {
        out.destroy();
        try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch {}
        throw streamErr;
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[net:download] Attempt ${attempt}/${maxRetries} failed for ${url}:`, err.message || err);
      if (attempt < maxRetries) {
        // Exponential backoff wait
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }
  }

  throw lastError || new Error(`Failed to download ${url}`);
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
