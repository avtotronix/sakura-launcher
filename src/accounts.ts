/**
 * Accounts: Microsoft (msmc), Ely.by (Yggdrasil authserver), offline, Google (Sakura sync).
 *
 * Security:
 *  - Tokens never leave the main process. The renderer only receives {id, name, type, active}.
 *  - Secrets are encrypted at rest with Electron safeStorage (DPAPI on Windows).
 */
import { app, ipcMain, safeStorage, shell } from "electron";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { Auth } from "msmc";
import { getJson } from "./net";

/** Put your Google OAuth "Desktop app" client id here (or env SAKURA_GOOGLE_CLIENT_ID). */
const GOOGLE_CLIENT_ID = process.env.SAKURA_GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.SAKURA_GOOGLE_CLIENT_SECRET || "";

const ELY = "https://authserver.ely.by";

export type AccType = "microsoft" | "elyby" | "offline";
interface StoredAcc {
  id: string;
  type: AccType;
  name: string;
  uuid: string;
  secret?: string; // encrypted JSON (base64)
}
interface Store {
  active: string | null;
  list: StoredAcc[];
  google?: { email: string; name: string; picture?: string; secret?: string } | null;
}

const FILE = () => path.join(app.getPath("userData"), "sakura-data", "accounts.json");

function load(): Store {
  try {
    const s = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    if (s && Array.isArray(s.list)) return s;
  } catch { /* first run */ }
  return { active: null, list: [], google: null };
}
function persist(s: Store) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  const tmp = FILE() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1), "utf8");
  fs.renameSync(tmp, FILE());
}
function enc(obj: unknown): string {
  const raw = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) return "e:" + safeStorage.encryptString(raw).toString("base64");
  return "p:" + Buffer.from(raw).toString("base64");
}
function dec<T = any>(s?: string): T | null {
  if (!s) return null;
  try {
    if (s.startsWith("e:")) return JSON.parse(safeStorage.decryptString(Buffer.from(s.slice(2), "base64")));
    if (s.startsWith("p:")) return JSON.parse(Buffer.from(s.slice(2), "base64").toString("utf8"));
  } catch { /* corrupted */ }
  return null;
}

function publicList(s: Store) {
  return {
    active: s.active,
    list: s.list.map((a) => ({ id: a.id, type: a.type, name: a.name })),
    google: s.google ? { email: s.google.email, name: s.google.name, picture: s.google.picture } : null,
  };
}

function upsert(s: Store, acc: StoredAcc) {
  const i = s.list.findIndex((a) => a.type === acc.type && a.uuid === acc.uuid);
  if (i >= 0) {
    acc.id = s.list[i].id;
    s.list[i] = acc;
  } else s.list.push(acc);
  s.active = acc.id;
  persist(s);
}

const newId = () => "a" + crypto.randomBytes(6).toString("hex");
const offlineUuid = (name: string) => {
  // Same algorithm as vanilla offline mode: UUID v3 of "OfflinePlayer:<name>"
  const h = crypto.createHash("md5").update("OfflinePlayer:" + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  return h.toString("hex");
};

// ─── Ely.by (https://docs.ely.by/en/minecraft-auth.html) ─────────────────────

async function elyPost(endpoint: string, body: unknown) {
  const r = await fetch(ELY + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const msg: string = data.errorMessage || `HTTP ${r.status}`;
    const err: any = new Error(msg);
    err.twoFactor = /two factor/i.test(msg);
    throw err;
  }
  return data;
}

// ─── Launch-time authorization (used by launcher.ts) ─────────────────────────

export interface LaunchAuth {
  mclc: any;
  type: AccType;
  name: string;
}

export async function getLaunchAuth(elyAuth = false): Promise<LaunchAuth> {
  const s = load();
  let acc = s.list.find((a) => a.id === s.active);
  if (!acc && s.list.length > 0) {
    acc = s.list[0];
    s.active = acc.id;
    persist(s);
  }
  if (!acc) {
    const defaultName = "Player";
    const defaultAcc: StoredAcc = {
      id: newId(),
      type: "offline",
      name: defaultName,
      uuid: offlineUuid(defaultName),
    };
    s.list.push(defaultAcc);
    s.active = defaultAcc.id;
    persist(s);
    acc = defaultAcc;
  }

  if (acc.type === "offline") {
    return {
      type: "offline",
      name: acc.name,
      mclc: {
        access_token: "0",
        client_token: "0",
        uuid: acc.uuid,
        name: acc.name,
        user_properties: "{}",
        meta: { type: "legacy", demo: false },
      },
    };
  }

  if (acc.type === "microsoft") {
    const sec = dec<{ refresh: string }>(acc.secret);
    if (!sec?.refresh) throw new Error("Войдите в Microsoft заново");
    const xbox = await new Auth("select_account").refresh(sec.refresh);
    const mc = await xbox.getMinecraft();
    acc.secret = enc({ refresh: xbox.save() });
    if (mc.profile) acc.name = mc.profile.name;
    persist(s);
    return { type: "microsoft", name: acc.name, mclc: mc.mclc() };
  }

  // Ely.by:
  if (!elyAuth) {
    // Standard offline-compatible launch for Ely.by users:
    // Allows connecting seamlessly to FunTime, ReallyWorld and other public pirate/hybrid servers without license kicks!
    return {
      type: "elyby",
      name: acc.name,
      mclc: {
        access_token: "0",
        client_token: "0",
        uuid: offlineUuid(acc.name),
        name: acc.name,
        user_properties: "{}",
        meta: { type: "legacy", demo: false },
      },
    };
  }

  // Ely.by with authlib-injector (elyAuth === true): validate → refresh if needed
  const sec = dec<{ accessToken: string; clientToken: string }>(acc.secret);
  if (!sec) throw new Error("Войдите в Ely.by заново");
  let { accessToken, clientToken } = sec;
  try {
    await elyPost("/auth/validate", { accessToken });
  } catch {
    const d = await elyPost("/auth/refresh", { accessToken, clientToken, requestUser: true });
    accessToken = d.accessToken;
    acc.secret = enc({ accessToken, clientToken });
    if (d.selectedProfile?.name) acc.name = d.selectedProfile.name;
    persist(s);
  }
  return {
    type: "elyby",
    name: acc.name,
    mclc: {
      access_token: accessToken,
      client_token: clientToken,
      uuid: acc.uuid,
      name: acc.name,
      user_properties: "{}",
      meta: { type: "mojang", demo: false },
    },
  };
}

// ─── Google (Sakura sync) — loopback + PKCE, RFC 8252 ────────────────────────

async function googleLogin(): Promise<{ email: string; name: string; picture?: string; refresh?: string }> {
  if (!GOOGLE_CLIENT_ID) throw new Error("not-configured");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");

  const { code, redirect } = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      if (u.pathname !== "/cb") { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding-top:20vh">${ok ? "Готово! Вернитесь в Sakura Launcher." : "Ошибка входа."}</body>`);
      clearTimeout(timer);
      srv.close();
      if (ok) resolve({ code: u.searchParams.get("code")!, redirect }); else reject(new Error("Вход отменён"));
    });
    let redirect = "";
    const timer = setTimeout(() => { srv.close(); reject(new Error("Время ожидания входа истекло")); }, 5 * 60_000);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as any).port;
      redirect = `http://127.0.0.1:${port}/cb`;
      const q = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirect,
        response_type: "code",
        scope: "openid email profile",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "select_account",
      });
      void shell.openExternal("https://accounts.google.com/o/oauth2/v2/auth?" + q.toString());
    });
  });

  const tok = await getJson<any>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, code_verifier: verifier, client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirect, grant_type: "authorization_code",
    }).toString(),
  });
  const info = await getJson<any>("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: "Bearer " + tok.access_token },
  });
  return { email: info.email, name: info.name || info.email, picture: info.picture, refresh: tok.refresh_token };
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

const wrap = <A extends any[]>(fn: (...a: A) => Promise<any> | any) =>
  async (_e: Electron.IpcMainInvokeEvent, ...a: A) => {
    try { return { ok: true, ...(await fn(...a)) }; }
    catch (err: any) { return { ok: false, error: String(err?.message || err), twoFactor: !!err?.twoFactor }; }
  };

export function registerAccountsIPC() {
  ipcMain.handle("accounts:list", wrap(() => publicList(load())));

  ipcMain.handle("accounts:select", wrap((id: unknown) => {
    const s = load();
    if (!s.list.some((a) => a.id === id)) throw new Error("Нет такого аккаунта");
    s.active = id as string; persist(s); return publicList(s);
  }));

  ipcMain.handle("accounts:remove", wrap((id: unknown) => {
    const s = load();
    s.list = s.list.filter((a) => a.id !== id);
    if (s.active === id) s.active = s.list[0]?.id ?? null;
    persist(s); return publicList(s);
  }));

  ipcMain.handle("accounts:add-offline", wrap((nick: unknown) => {
    if (typeof nick !== "string" || !/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
      throw new Error("Ник: 3–16 символов, латиница, цифры и _");
    }
    const s = load();
    upsert(s, { id: newId(), type: "offline", name: nick, uuid: offlineUuid(nick) });
    return publicList(s);
  }));

  ipcMain.handle("accounts:add-microsoft", wrap(async () => {
    const auth = new Auth("select_account");
    const xbox = await auth.launch("electron", { width: 520, height: 680, title: "Вход в Microsoft" } as any);
    const mc = await xbox.getMinecraft();
    if (!mc.profile) throw new Error("На этом аккаунте Microsoft нет Minecraft Java Edition");
    const s = load();
    upsert(s, { id: newId(), type: "microsoft", name: mc.profile.name, uuid: mc.profile.id, secret: enc({ refresh: xbox.save() }) });
    return publicList(s);
  }));

  ipcMain.handle("accounts:add-elyby", wrap(async (login: unknown, password: unknown, totp: unknown) => {
    if (typeof login !== "string" || !login.trim() || login.length > 128) throw new Error("Введите ник или e-mail");
    if (typeof password !== "string" || !password || password.length > 256) throw new Error("Введите пароль");
    const pass = typeof totp === "string" && /^\d{6}$/.test(totp) ? `${password}:${totp}` : password;
    const clientToken = crypto.randomUUID();
    const d = await elyPost("/auth/authenticate", { username: login.trim(), password: pass, clientToken, requestUser: true });
    if (!d.selectedProfile) throw new Error("У аккаунта Ely.by нет игрового профиля");
    const s = load();
    upsert(s, {
      id: newId(), type: "elyby", name: d.selectedProfile.name, uuid: d.selectedProfile.id,
      secret: enc({ accessToken: d.accessToken, clientToken: d.clientToken || clientToken }),
    });
    return publicList(s);
  }));

  ipcMain.handle("accounts:google", wrap(async () => {
    const g = await googleLogin();
    const s = load();
    s.google = { email: g.email, name: g.name, picture: g.picture, secret: g.refresh ? enc({ refresh: g.refresh }) : undefined };
    persist(s); return publicList(s);
  }));

  ipcMain.handle("accounts:google-logout", wrap(() => {
    const s = load(); s.google = null; persist(s); return publicList(s);
  }));

  ipcMain.handle("accounts:register-ely", wrap(() => {
    void shell.openExternal("https://account.ely.by/register");
    return {};
  }));
}
