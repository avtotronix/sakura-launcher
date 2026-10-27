/**
 * Friends & Game Presence System for Sakura Launcher
 * Provides friend requests, status tracking, LAN game detection from Minecraft logs.
 */
import fs from "fs";
import path from "path";
import { ipcMain, WebContents } from "electron";

export type PresenceStatus =
  | "online"
  | "offline"
  | "singleplayer"
  | "server"
  | "lan_host"
  | "dnd"
  | "hidden";

export interface FriendProfile {
  id: string;
  name: string;
  avatar?: string;
  uuid?: string;
  status: PresenceStatus;
  statusText?: string;
  serverAddress?: string;
  serverName?: string;
  gameVersion?: string;
  modpackName?: string;
  lanPort?: number;
  lastSeen: number;
}

export interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  timestamp: number;
}

export class FriendsSystem {
  private dataFile: string;
  private myProfile: FriendProfile;
  private friends: FriendProfile[] = [];
  private pendingRequests: FriendRequest[] = [];
  private blockedIds: string[] = [];
  private logWatcher: fs.FSWatcher | null = null;
  private webContents: WebContents[] = [];

  constructor(getDataDir: () => string) {
    this.dataFile = path.join(getDataDir(), "friends.json");
    this.myProfile = {
      id: "usr_" + Math.random().toString(36).slice(2, 10),
      name: "Игрок",
      status: "online",
      lastSeen: Date.now(),
    };
    this.load();
  }

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

  private load() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const raw = JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
        if (raw.myProfile) this.myProfile = { ...this.myProfile, ...raw.myProfile };
        if (Array.isArray(raw.friends)) {
          this.friends = raw.friends.filter((f: any) => f.id !== "fr_alex" && f.id !== "fr_steve" && f.name !== "Alex_Miner" && f.name !== "SteveCraft");
        }
        if (Array.isArray(raw.pendingRequests)) this.pendingRequests = raw.pendingRequests;
        if (Array.isArray(raw.blockedIds)) this.blockedIds = raw.blockedIds;
      } else {
        this.friends = [];
        this.save();
      }
    } catch {}
  }

  public save() {
    try {
      fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
      fs.writeFileSync(
        this.dataFile,
        JSON.stringify(
          {
            myProfile: this.myProfile,
            friends: this.friends,
            pendingRequests: this.pendingRequests,
            blockedIds: this.blockedIds,
          },
          null,
          2
        ),
        "utf8"
      );
    } catch {}
  }

  public getState() {
    return {
      myProfile: this.myProfile,
      friends: this.friends,
      pendingRequests: this.pendingRequests,
      blockedIds: this.blockedIds,
    };
  }

  public updateMyProfile(update: Partial<FriendProfile>) {
    this.myProfile = { ...this.myProfile, ...update };
    this.save();
    this.broadcast("friends:updated", this.getState());
  }

  public sendRequest(targetNameOrId: string): { ok: boolean; message: string } {
    const q = targetNameOrId.trim();
    if (!q) return { ok: false, message: "Введите имя или ID игрока" };
    if (q.toLowerCase() === this.myProfile.name.toLowerCase() || q === this.myProfile.id) {
      return { ok: false, message: "Нельзя добавить самого себя в друзья" };
    }
    if (this.friends.some((f) => f.id === q || f.name.toLowerCase() === q.toLowerCase())) {
      return { ok: false, message: "Этот игрок уже в вашем списке друзей" };
    }

    // In local / p2p mode, create a friend record or outgoing request
    const newFriend: FriendProfile = {
      id: "usr_" + Math.random().toString(36).slice(2, 8),
      name: q,
      status: "offline",
      statusText: "Не в сети",
      lastSeen: Date.now(),
    };
    this.friends.push(newFriend);
    this.save();
    this.broadcast("friends:updated", this.getState());
    return { ok: true, message: `Запрос отправлен игроку ${q}` };
  }

  public acceptRequest(reqId: string) {
    const idx = this.pendingRequests.findIndex((r) => r.id === reqId);
    if (idx !== -1) {
      const req = this.pendingRequests.splice(idx, 1)[0];
      this.friends.push({
        id: req.fromId,
        name: req.fromName,
        status: "online",
        statusText: "В сети",
        lastSeen: Date.now(),
      });
      this.save();
      this.broadcast("friends:updated", this.getState());
    }
  }

  public declineRequest(reqId: string) {
    this.pendingRequests = this.pendingRequests.filter((r) => r.id !== reqId);
    this.save();
    this.broadcast("friends:updated", this.getState());
  }

  public removeFriend(friendId: string) {
    this.friends = this.friends.filter((f) => f.id !== friendId);
    this.save();
    this.broadcast("friends:updated", this.getState());
  }

  public blockUser(friendId: string) {
    if (!this.blockedIds.includes(friendId)) {
      this.blockedIds.push(friendId);
    }
    this.removeFriend(friendId);
  }

  /**
   * Monitor Minecraft latest.log to detect when:
   * 1. Player opens world to LAN: "[main/INFO]: Started local server on <port>"
   * 2. Player connects to server: "Connecting to <ip>, <port>"
   * 3. Player enters singleplayer: "Starting integrated server"
   */
  public monitorGameLog(logFilePath: string, gameVersion: string, packName?: string) {
    if (this.logWatcher) {
      this.logWatcher.close();
      this.logWatcher = null;
    }

    if (!fs.existsSync(logFilePath)) return;

    let lastSize = 0;
    try {
      lastSize = fs.statSync(logFilePath).size;
    } catch {}

    const checkLog = () => {
      try {
        const stat = fs.statSync(logFilePath);
        if (stat.size <= lastSize) return;

        const stream = fs.createReadStream(logFilePath, {
          start: lastSize,
          end: stat.size,
          encoding: "utf8",
        });

        lastSize = stat.size;
        stream.on("data", (chunk: string | Buffer) => {
          const lines = chunk.toString().split("\n");
          for (const line of lines) {
            // LAN game detection
            const lanMatch = line.match(/Started local server on (\d+)/i) || line.match(/local game hosted on port (\d+)/i);
            if (lanMatch) {
              const port = parseInt(lanMatch[1], 10);
              this.updateMyProfile({
                status: "lan_host",
                statusText: "Открыл мир для сети (LAN)",
                lanPort: port,
                gameVersion,
                modpackName: packName || "Vanilla",
              });
              continue;
            }

            // Server connection detection
            const srvMatch = line.match(/Connecting to ([a-zA-Z0-9.-]+),?\s*(\d*)/i);
            if (srvMatch) {
              const serverAddress = srvMatch[1];
              this.updateMyProfile({
                status: "server",
                statusText: `Играет на сервере ${serverAddress}`,
                serverAddress,
                serverName: serverAddress,
                gameVersion,
                modpackName: packName || "Vanilla",
              });
              continue;
            }

            // Singleplayer integrated server detection
            if (line.includes("Starting integrated minecraft server") || line.includes("Loaded 0 advancements") || line.includes("Loaded 1 advancements")) {
              if (this.myProfile.status !== "lan_host") {
                this.updateMyProfile({
                  status: "singleplayer",
                  statusText: "Играет в одиночном мире",
                  gameVersion,
                  modpackName: packName || "Vanilla",
                });
              }
            }
          }
        });
      } catch {}
    };

    try {
      this.logWatcher = fs.watch(logFilePath, () => checkLog());
    } catch {}
  }

  public stopMonitoring() {
    if (this.logWatcher) {
      this.logWatcher.close();
      this.logWatcher = null;
    }
    this.updateMyProfile({
      status: "online",
      statusText: "В лаунчере",
      serverAddress: undefined,
      serverName: undefined,
      lanPort: undefined,
    });
  }
}

export function registerFriendsIPC(getFriendsSystem: () => FriendsSystem) {
  ipcMain.handle("friends:get-state", (e) => {
    getFriendsSystem().registerWebContents(e.sender);
    return getFriendsSystem().getState();
  });
  ipcMain.handle("friends:update-profile", (_e, update: any) => {
    getFriendsSystem().updateMyProfile(update);
    return true;
  });
  ipcMain.handle("friends:send-request", (_e, target: string) => {
    return getFriendsSystem().sendRequest(target);
  });
  ipcMain.handle("friends:accept-request", (_e, reqId: string) => {
    getFriendsSystem().acceptRequest(reqId);
    return true;
  });
  ipcMain.handle("friends:decline-request", (_e, reqId: string) => {
    getFriendsSystem().declineRequest(reqId);
    return true;
  });
  ipcMain.handle("friends:remove-friend", (_e, friendId: string) => {
    getFriendsSystem().removeFriend(friendId);
    return true;
  });
}
