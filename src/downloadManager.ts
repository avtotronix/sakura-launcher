/**
 * Unified Download Manager for Sakura Launcher
 * Handles queued downloads, atomic writes, hash verification, zip integrity, and speed calculation.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { WebContents, ipcMain } from "electron";
import { assertAllowed } from "./net";

export type DownloadType = "mod" | "resourcepack" | "shaderpack" | "datapack" | "modpack" | "loader" | "asset";
export type DownloadStatus = "queued" | "downloading" | "verifying" | "installing" | "completed" | "failed" | "cancelled";

export interface DownloadTask {
  id: string;
  name: string;
  type: DownloadType;
  url: string;
  dest: string;
  targetPackId?: string;
  totalBytes: number;
  transferredBytes: number;
  progress: number; // 0 - 100
  speed: number; // bytes/sec
  status: DownloadStatus;
  error?: string;
  expectedHash?: { algo: "sha1" | "sha256" | "sha512"; hash: string };
  startedAt?: number;
  completedAt?: number;
}

class DownloadManager {
  private tasks = new Map<string, DownloadTask>();
  private activeControllers = new Map<string, AbortController>();
  private maxConcurrent = 3;
  private activeCount = 0;
  private webContents: WebContents[] = [];

  public registerWebContents(wc: WebContents) {
    if (!this.webContents.includes(wc)) {
      this.webContents.push(wc);
      wc.on("destroyed", () => {
        this.webContents = this.webContents.filter((w) => w !== wc);
      });
    }
  }

  private broadcast(channel: string, data: any) {
    for (const wc of this.webContents) {
      if (!wc.isDestroyed()) {
        wc.send(channel, data);
      }
    }
  }

  public getTasks(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  public cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
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

  public clearCompleted(): void {
    for (const [id, t] of this.tasks.entries()) {
      if (t.status === "completed" || t.status === "cancelled" || t.status === "failed") {
        this.tasks.delete(id);
      }
    }
    this.broadcast("download:cleared", null);
  }

  public retry(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== "failed") return false;
    task.status = "queued";
    task.error = undefined;
    task.transferredBytes = 0;
    task.progress = 0;
    this.broadcast("download:updated", task);
    this.processQueue();
    return true;
  }

  public queue(req: {
    name: string;
    type: DownloadType;
    url: string;
    dest: string;
    targetPackId?: string;
    expectedHash?: { algo: "sha1" | "sha256" | "sha512"; hash: string };
  }): DownloadTask {
    const id = "dl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const task: DownloadTask = {
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

  private async processQueue() {
    if (this.activeCount >= this.maxConcurrent) return;
    for (const task of this.tasks.values()) {
      if (task.status === "queued") {
        this.startDownload(task);
        if (this.activeCount >= this.maxConcurrent) break;
      }
    }
  }

  private async startDownload(task: DownloadTask) {
    this.activeCount++;
    task.status = "downloading";
    task.startedAt = Date.now();
    this.broadcast("download:updated", task);

    const ctl = new AbortController();
    this.activeControllers.set(task.id, ctl);

    const partPath = task.dest + ".part";
    let speedTimer: NodeJS.Timeout | null = null;
    let lastBytes = 0;
    let lastTime = Date.now();

    try {
      assertAllowed(task.url);
      const res = await fetch(task.url, { signal: ctl.signal, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      if (!res.body) throw new Error("Empty response body");

      const cl = res.headers.get("content-length");
      task.totalBytes = cl ? parseInt(cl, 10) : 0;

      fs.mkdirSync(path.dirname(task.dest), { recursive: true });
      const outStream = fs.createWriteStream(partPath);

      const hasher = task.expectedHash ? crypto.createHash(task.expectedHash.algo) : null;
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
        if (done) break;
        if (value) {
          task.transferredBytes += value.length;
          if (task.totalBytes > 0) {
            task.progress = Math.min(99, Math.round((task.transferredBytes / task.totalBytes) * 100));
          }
          if (hasher) hasher.update(value);
          if (!outStream.write(value)) {
            await new Promise((r) => outStream.once("drain", () => r(undefined)));
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        outStream.end((err: any) => (err ? reject(err) : resolve()));
      });

      if (speedTimer) clearInterval(speedTimer);

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

      if (fs.existsSync(task.dest)) {
        fs.unlinkSync(task.dest);
      }
      fs.renameSync(partPath, task.dest);

      task.status = "completed";
      task.progress = 100;
      task.speed = 0;
      task.completedAt = Date.now();
      this.broadcast("download:updated", task);
    } catch (err: any) {
      if (speedTimer) clearInterval(speedTimer);
      if (fs.existsSync(partPath)) {
        try { fs.unlinkSync(partPath); } catch {}
      }
      if ((task.status as string) !== "cancelled") {
        task.status = "failed";
        task.error = String(err?.message || err);
        task.speed = 0;
        this.broadcast("download:updated", task);
      }
    } finally {
      this.activeControllers.delete(task.id);
      this.activeCount--;
      this.processQueue();
    }
  }

  private validateFileFormat(filePath: string, type: DownloadType): void {
    // Check minimal size
    const stat = fs.statSync(filePath);
    if (stat.size < 4) throw new Error("Downloaded file is empty or too small");

    // Check magic bytes
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);

    const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // PK..
    if (type === "resourcepack" || type === "shaderpack" || type === "mod" || type === "modpack" || type === "datapack") {
      if (!isZip) {
        throw new Error("Invalid archive format: expected ZIP/JAR signature (PK..)");
      }
      // Detailed inspection via AdmZip
      try {
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries();
        if (type === "resourcepack") {
          // Check for pack.mcmeta anywhere in top or root
          const hasMeta = entries.some((e) => e.entryName.toLowerCase() === "pack.mcmeta" || e.entryName.toLowerCase().endsWith("/pack.mcmeta"));
          if (!hasMeta) {
            console.warn("Resource pack missing pack.mcmeta, but keeping file");
          }
        } else if (type === "shaderpack") {
          const hasShaders = entries.some((e) => e.entryName.toLowerCase().startsWith("shaders/") || e.entryName.toLowerCase().includes("/shaders/"));
          if (!hasShaders) {
            console.warn("Shader pack missing shaders/ directory, but keeping file");
          }
        }
      } catch (err) {
        throw new Error("Corrupted archive: " + String(err));
      }
    }
  }
}

export const downloadManager = new DownloadManager();

export function registerDownloadIPC() {
  ipcMain.handle("downloads:list", () => downloadManager.getTasks());
  ipcMain.handle("downloads:cancel", (_e, id: string) => downloadManager.cancel(id));
  ipcMain.handle("downloads:retry", (_e, id: string) => downloadManager.retry(id));
  ipcMain.handle("downloads:clear", () => { downloadManager.clearCompleted(); return true; });
  ipcMain.handle("downloads:enqueue", (e, req: any) => {
    downloadManager.registerWebContents(e.sender);
    return downloadManager.queue(req);
  });
}
