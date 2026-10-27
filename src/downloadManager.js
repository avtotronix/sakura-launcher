"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadManager = void 0;
exports.registerDownloadIPC = registerDownloadIPC;
/**
 * Unified Download Manager for Sakura Launcher
 * Handles queued downloads, atomic writes, hash verification, zip integrity, and speed calculation.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const electron_1 = require("electron");
const net_1 = require("./net");
class DownloadManager {
    tasks = new Map();
    activeControllers = new Map();
    maxConcurrent = 3;
    activeCount = 0;
    webContents = [];
    registerWebContents(wc) {
        if (!this.webContents.includes(wc)) {
            this.webContents.push(wc);
            wc.on("destroyed", () => {
                this.webContents = this.webContents.filter((w) => w !== wc);
            });
        }
    }
    broadcast(channel, data) {
        for (const wc of this.webContents) {
            if (!wc.isDestroyed()) {
                wc.send(channel, data);
            }
        }
    }
    getTasks() {
        return Array.from(this.tasks.values()).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    }
    cancel(id) {
        const task = this.tasks.get(id);
        if (!task)
            return false;
        if (task.status === "downloading" || task.status === "queued") {
            task.status = "cancelled";
            const ctl = this.activeControllers.get(id);
            if (ctl) {
                ctl.abort();
                this.activeControllers.delete(id);
            }
            this.broadcast("download:updated", task);
            this.processQueue();
            return true;
        }
        return false;
    }
    clearCompleted() {
        for (const [id, t] of this.tasks.entries()) {
            if (t.status === "completed" || t.status === "cancelled" || t.status === "failed") {
                this.tasks.delete(id);
            }
        }
        this.broadcast("download:cleared", null);
    }
    retry(id) {
        const task = this.tasks.get(id);
        if (!task || task.status !== "failed")
            return false;
        task.status = "queued";
        task.error = undefined;
        task.transferredBytes = 0;
        task.progress = 0;
        this.broadcast("download:updated", task);
        this.processQueue();
        return true;
    }
    queue(req) {
        const id = "dl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        const task = {
            id,
            name: req.name,
            type: req.type,
            url: req.url,
            dest: req.dest,
            targetPackId: req.targetPackId,
            totalBytes: 0,
            transferredBytes: 0,
            progress: 0,
            speed: 0,
            status: "queued",
            expectedHash: req.expectedHash,
            startedAt: Date.now(),
        };
        this.tasks.set(id, task);
        this.broadcast("download:added", task);
        this.processQueue();
        return task;
    }
    async processQueue() {
        if (this.activeCount >= this.maxConcurrent)
            return;
        for (const task of this.tasks.values()) {
            if (task.status === "queued") {
                this.startDownload(task);
                if (this.activeCount >= this.maxConcurrent)
                    break;
            }
        }
    }
    async startDownload(task) {
        this.activeCount++;
        task.status = "downloading";
        task.startedAt = Date.now();
        this.broadcast("download:updated", task);
        const ctl = new AbortController();
        this.activeControllers.set(task.id, ctl);
        const partPath = task.dest + ".part";
        let speedTimer = null;
        let lastBytes = 0;
        let lastTime = Date.now();
        try {
            (0, net_1.assertAllowed)(task.url);
            const res = await fetch(task.url, { signal: ctl.signal, redirect: "follow" });
            if (!res.ok)
                throw new Error(`HTTP ${res.status} ${res.statusText}`);
            if (!res.body)
                throw new Error("Empty response body");
            const cl = res.headers.get("content-length");
            task.totalBytes = cl ? parseInt(cl, 10) : 0;
            fs_1.default.mkdirSync(path_1.default.dirname(task.dest), { recursive: true });
            const outStream = fs_1.default.createWriteStream(partPath);
            const hasher = task.expectedHash ? crypto_1.default.createHash(task.expectedHash.algo) : null;
            const reader = res.body.getReader();
            speedTimer = setInterval(() => {
                const now = Date.now();
                const dt = (now - lastTime) / 1000;
                if (dt > 0.4) {
                    const db = task.transferredBytes - lastBytes;
                    task.speed = Math.round(db / dt);
                    lastBytes = task.transferredBytes;
                    lastTime = now;
                    this.broadcast("download:updated", task);
                }
            }, 500);
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value) {
                    task.transferredBytes += value.length;
                    if (task.totalBytes > 0) {
                        task.progress = Math.min(99, Math.round((task.transferredBytes / task.totalBytes) * 100));
                    }
                    if (hasher)
                        hasher.update(value);
                    if (!outStream.write(value)) {
                        await new Promise((r) => outStream.once("drain", () => r(undefined)));
                    }
                }
            }
            await new Promise((resolve, reject) => {
                outStream.end((err) => (err ? reject(err) : resolve()));
            });
            if (speedTimer)
                clearInterval(speedTimer);
            // Verifying
            task.status = "verifying";
            task.progress = 99;
            this.broadcast("download:updated", task);
            if (hasher && task.expectedHash) {
                const computed = hasher.digest("hex").toLowerCase();
                if (computed !== task.expectedHash.hash.toLowerCase()) {
                    throw new Error(`Checksum mismatch: expected ${task.expectedHash.hash}, got ${computed}`);
                }
            }
            // Format inspection
            this.validateFileFormat(partPath, task.type);
            // Installing (moving into place atomically)
            task.status = "installing";
            this.broadcast("download:updated", task);
            if (fs_1.default.existsSync(task.dest)) {
                fs_1.default.unlinkSync(task.dest);
            }
            fs_1.default.renameSync(partPath, task.dest);
            task.status = "completed";
            task.progress = 100;
            task.speed = 0;
            task.completedAt = Date.now();
            this.broadcast("download:updated", task);
        }
        catch (err) {
            if (speedTimer)
                clearInterval(speedTimer);
            if (fs_1.default.existsSync(partPath)) {
                try {
                    fs_1.default.unlinkSync(partPath);
                }
                catch { }
            }
            if (task.status !== "cancelled") {
                task.status = "failed";
                task.error = String(err?.message || err);
                task.speed = 0;
                this.broadcast("download:updated", task);
            }
        }
        finally {
            this.activeControllers.delete(task.id);
            this.activeCount--;
            this.processQueue();
        }
    }
    validateFileFormat(filePath, type) {
        // Check minimal size
        const stat = fs_1.default.statSync(filePath);
        if (stat.size < 4)
            throw new Error("Downloaded file is empty or too small");
        // Check magic bytes
        const buf = Buffer.alloc(4);
        const fd = fs_1.default.openSync(filePath, "r");
        fs_1.default.readSync(fd, buf, 0, 4, 0);
        fs_1.default.closeSync(fd);
        const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // PK..
        if (type === "resourcepack" || type === "shaderpack" || type === "mod" || type === "modpack" || type === "datapack") {
            if (!isZip) {
                throw new Error("Invalid archive format: expected ZIP/JAR signature (PK..)");
            }
            // Detailed inspection via AdmZip
            try {
                const zip = new adm_zip_1.default(filePath);
                const entries = zip.getEntries();
                if (type === "resourcepack") {
                    // Check for pack.mcmeta anywhere in top or root
                    const hasMeta = entries.some((e) => e.entryName.toLowerCase() === "pack.mcmeta" || e.entryName.toLowerCase().endsWith("/pack.mcmeta"));
                    if (!hasMeta) {
                        console.warn("Resource pack missing pack.mcmeta, but keeping file");
                    }
                }
                else if (type === "shaderpack") {
                    const hasShaders = entries.some((e) => e.entryName.toLowerCase().startsWith("shaders/") || e.entryName.toLowerCase().includes("/shaders/"));
                    if (!hasShaders) {
                        console.warn("Shader pack missing shaders/ directory, but keeping file");
                    }
                }
            }
            catch (err) {
                throw new Error("Corrupted archive: " + String(err));
            }
        }
    }
}
exports.downloadManager = new DownloadManager();
function registerDownloadIPC() {
    electron_1.ipcMain.handle("downloads:list", () => exports.downloadManager.getTasks());
    electron_1.ipcMain.handle("downloads:cancel", (_e, id) => exports.downloadManager.cancel(id));
    electron_1.ipcMain.handle("downloads:retry", (_e, id) => exports.downloadManager.retry(id));
    electron_1.ipcMain.handle("downloads:clear", () => { exports.downloadManager.clearCompleted(); return true; });
    electron_1.ipcMain.handle("downloads:enqueue", (e, req) => {
        exports.downloadManager.registerWebContents(e.sender);
        return exports.downloadManager.queue(req);
    });
}
