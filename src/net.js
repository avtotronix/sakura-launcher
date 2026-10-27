"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertAllowed = assertAllowed;
exports.getJson = getJson;
exports.download = download;
exports.safeName = safeName;
exports.safeId = safeId;
/**
 * Network helpers for the main process.
 * Every outgoing request goes through an HTTPS host allowlist.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ALLOWED_HOSTS = [
    "piston-meta.mojang.com",
    "launchermeta.mojang.com",
    "meta.fabricmc.net",
    "maven.fabricmc.net",
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
function assertAllowed(url) {
    const u = new URL(url);
    if (u.protocol !== "https:")
        throw new Error(`Blocked non-HTTPS URL: ${url}`);
    const ok = ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
    if (!ok)
        throw new Error(`Blocked host: ${u.hostname}`);
    return u;
}
async function getJson(url, init, timeoutMs = 20000) {
    assertAllowed(url);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const r = await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
        if (!r.ok)
            throw new Error(`HTTP ${r.status} for ${url}`);
        return (await r.json());
    }
    finally {
        clearTimeout(t);
    }
}
/** Download to file (atomic: .part → rename). Redirect targets are re-checked. */
async function download(url, dest, onProgress) {
    assertAllowed(url);
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok || !r.body)
        throw new Error(`HTTP ${r.status} for ${url}`);
    assertAllowed(r.url); // final URL after redirects
    const total = Number(r.headers.get("content-length") || 0);
    fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
    const part = dest + ".part";
    const out = fs_1.default.createWriteStream(part);
    let done = 0;
    const reader = r.body.getReader();
    try {
        for (;;) {
            const { done: end, value } = await reader.read();
            if (end)
                break;
            done += value.length;
            if (!out.write(value))
                await new Promise((res) => out.once("drain", () => res()));
            onProgress?.(done, total);
        }
        await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
        fs_1.default.renameSync(part, dest);
    }
    catch (e) {
        out.destroy();
        try {
            fs_1.default.unlinkSync(part);
        }
        catch { /* ignore */ }
        throw e;
    }
    return dest;
}
/** Strict file-name sanitizer (no path separators, no traversal). */
function safeName(name) {
    const n = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "_").slice(0, 160);
    if (!n)
        throw new Error("Bad file name");
    return n;
}
/** Ids we use as folder names (packs, accounts). */
function safeId(id) {
    if (typeof id !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(id))
        throw new Error("Bad id");
    return id;
}
