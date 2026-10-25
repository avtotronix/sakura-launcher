/**
 * Sakura Launcher — Electron adapter
 *
 * Runs BEFORE the main inline script. Patches global APIs so the existing
 * index.html code works transparently in Electron:
 *
 *  1. localStorage.getItem / setItem  →  synchronous cache backed by
 *     window.sakura.readState / writeState (async, via main process FS)
 *  2. saveBlob()                      →  uses sakura.showSaveFile() dialog
 *  3. Folder-open buttons             →  uses sakura.openGameFolder()
 *  4. shell.openExternal links        →  uses sakura.openExternal()
 *  5. Exposes app version in title    →  reads sakura.getVersion()
 *
 * NO eval, no new global side-channels, no prototype pollution.
 */

(async () => {
  "use strict";

  const api = window.sakura; // typed, exposed by preload via contextBridge

  // ── 1. State persistence via main process ───────────────────────────────────
  // The original code uses localStorage with key 'sakura.state'.
  // We load state once, cache it in memory, and flush async on every setItem.

  const LS_KEY = "sakura.state";
  const TAKEN_KEY = "sakura.taken";

  // Seed from disk
  let diskState = {};
  let diskTaken = [];
  try {
    diskState = (await api.readState()) || {};
  } catch {
    diskState = {};
  }
  window.__sakuraDiskState = diskState;
  if (typeof ST !== 'undefined' && diskState[LS_KEY]) {
    try { Object.assign(ST, JSON.parse(diskState[LS_KEY])); } catch(e) {}
  }

  // In-memory mirror of the two localStorage keys
  const mem = {
    [LS_KEY]: typeof diskState[LS_KEY] === "string"
      ? diskState[LS_KEY]
      : (diskState["__sakuraState"] ? JSON.stringify(diskState["__sakuraState"]) : null),
    [TAKEN_KEY]: typeof diskState[TAKEN_KEY] === "string"
      ? diskState[TAKEN_KEY]
      : null,
  };

  // Flush timer — batch rapid writes
  let flushTimer = null;
  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      try {
        await api.writeState({ [LS_KEY]: mem[LS_KEY], [TAKEN_KEY]: mem[TAKEN_KEY] });
      } catch {
        // Silently ignore flush errors; data is still in memory
      }
    }, 500);
  }

  // Patch localStorage (only for our keys; fall through to real localStorage otherwise)
  const realLS = window.localStorage;
  const patchedLS = new Proxy(realLS, {
    get(target, prop) {
      if (prop === "getItem") {
        return (key) => {
          if (key === LS_KEY || key === TAKEN_KEY) return mem[key] ?? null;
          return target.getItem(key);
        };
      }
      if (prop === "setItem") {
        return (key, value) => {
          if (key === LS_KEY || key === TAKEN_KEY) {
            mem[key] = String(value);
            scheduleFlush();
            return;
          }
          target.setItem(key, value);
        };
      }
      if (prop === "removeItem") {
        return (key) => {
          if (key === LS_KEY || key === TAKEN_KEY) {
            mem[key] = null;
            scheduleFlush();
            return;
          }
          target.removeItem(key);
        };
      }
      const val = target[prop];
      return typeof val === "function" ? val.bind(target) : val;
    },
  });

  // Replace window.localStorage with patched version
  Object.defineProperty(window, "localStorage", {
    get: () => patchedLS,
    configurable: true,
  });

  // ── 2. saveBlob — use OS save dialog ────────────────────────────────────────
  // The original saveBlob() tries window.claude.use('downloads') first,
  // then falls back to creating an <a> tag.
  // We intercept it to use the native file dialog instead.

  window.__electronSaveBlob = async function (blob, name) {
    try {
      // Determine file extension for filter
      const ext = name.split(".").pop() || "";
      const filePath = await api.showSaveFile({
        defaultPath: name,
        filters: ext
          ? [{ name: name, extensions: [ext] }]
          : [{ name: "All Files", extensions: ["*"] }],
      });
      if (!filePath) return; // User cancelled

      // Read blob as ArrayBuffer and send to main via IPC-safe channel
      const buf = await blob.arrayBuffer();
      // We can't write files directly from renderer (sandbox), so we
      // use a data-URL approach: create object URL and let main fetch it.
      // Better: encode as base64 and send via IPC.
      const base64 = btoa(
        new Uint8Array(buf).reduce((acc, b) => acc + String.fromCharCode(b), "")
      );
      // Write file via main process (sandboxed renderer can't write FS directly)
      await api.writeBase64(filePath, base64);
    } catch (err) {
      // Fallback: object URL download (works if not fully sandboxed)
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  };

  // ── 3. Folder open — route through sakura.openGameFolder ────────────────────
  // The original code shows a toast on [data-o] click; we extend it to
  // actually open the folder. We intercept after DOMContentLoaded.
  document.addEventListener("DOMContentLoaded", () => {
    // Folder open buttons in #dirs section
    document.getElementById("fd")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-o]");
      if (!btn) return;
      const folder = btn.dataset.o;
      if (folder && folder !== "%APPDATA%\\.sakura") {
        api.openGameFolder(folder).catch(() => {});
      } else if (folder) {
        api.openGameFolder("").catch(() => {});
      }
    });

    // Intercept <a target="_blank"> to route through our whitelist
    document.addEventListener("click", (e) => {
      const link = e.target.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href && (href.startsWith("https://") || href.startsWith("http://"))) {
        e.preventDefault();
        api.openExternal(href).catch(() => {});
      }
    });
  });

  // ── 4. App version in title bar ──────────────────────────────────────────────
  api.getVersion().then((v) => {
    document.title = `Sakura Launcher v${v}`;
  }).catch(() => {});

  // ── 5. Patch original saveBlob after scripts load ─────────────────────────
  // The inline script defines saveBlob(). We override it post-parse.
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof window.saveBlob === "function") {
      window.saveBlob = window.__electronSaveBlob;
    }
    // Also patch the open-folder toast in the original fd() onclick
    const fdEl = document.getElementById("fd");
    if (fdEl) {
      // Clone to remove old listener, then re-attach our extended version
      // (The original DOMContentLoaded has already run by now.)
    }
  }, { once: true });

})();
