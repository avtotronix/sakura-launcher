"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FriendsSystem = void 0;
exports.registerFriendsIPC = registerFriendsIPC;
/**
 * Friends & Game Presence System for Sakura Launcher
 * Provides friend requests, status tracking, LAN game detection from Minecraft logs.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
class FriendsSystem {
    dataFile;
    myProfile;
    friends = [];
    pendingRequests = [];
    blockedIds = [];
    logWatcher = null;
    webContents = [];
    constructor(getDataDir) {
        this.dataFile = path_1.default.join(getDataDir(), "friends.json");
        this.myProfile = {
            id: "usr_" + Math.random().toString(36).slice(2, 10),
            name: "Игрок",
            status: "online",
            lastSeen: Date.now(),
        };
        this.load();
    }
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
    load() {
        try {
            if (fs_1.default.existsSync(this.dataFile)) {
                const raw = JSON.parse(fs_1.default.readFileSync(this.dataFile, "utf8"));
                if (raw.myProfile)
                    this.myProfile = { ...this.myProfile, ...raw.myProfile };
                if (Array.isArray(raw.friends))
                    this.friends = raw.friends;
                if (Array.isArray(raw.pendingRequests))
                    this.pendingRequests = raw.pendingRequests;
                if (Array.isArray(raw.blockedIds))
                    this.blockedIds = raw.blockedIds;
            }
            else {
                // Seed some initial friendly default contacts
                this.friends = [
                    {
                        id: "fr_alex",
                        name: "Alex_Miner",
                        status: "server",
                        statusText: "Играет на FunTime",
                        serverName: "FunTime",
                        serverAddress: "mc.funtime.su",
                        gameVersion: "1.21.4",
                        lastSeen: Date.now() - 1000 * 60 * 5,
                    },
                    {
                        id: "fr_steve",
                        name: "SteveCraft",
                        status: "singleplayer",
                        statusText: "Играет в одиночном мире",
                        gameVersion: "1.20.1",
                        modpackName: "Vanilla+",
                        lastSeen: Date.now() - 1000 * 60 * 12,
                    },
                ];
                this.save();
            }
        }
        catch { }
    }
    save() {
        try {
            fs_1.default.mkdirSync(path_1.default.dirname(this.dataFile), { recursive: true });
            fs_1.default.writeFileSync(this.dataFile, JSON.stringify({
                myProfile: this.myProfile,
                friends: this.friends,
                pendingRequests: this.pendingRequests,
                blockedIds: this.blockedIds,
            }, null, 2), "utf8");
        }
        catch { }
    }
    getState() {
        return {
            myProfile: this.myProfile,
            friends: this.friends,
            pendingRequests: this.pendingRequests,
            blockedIds: this.blockedIds,
        };
    }
    updateMyProfile(update) {
        this.myProfile = { ...this.myProfile, ...update };
        this.save();
        this.broadcast("friends:updated", this.getState());
    }
    sendRequest(targetNameOrId) {
        const q = targetNameOrId.trim();
        if (!q)
            return { ok: false, message: "Введите имя или ID игрока" };
        if (q.toLowerCase() === this.myProfile.name.toLowerCase() || q === this.myProfile.id) {
            return { ok: false, message: "Нельзя добавить самого себя в друзья" };
        }
        if (this.friends.some((f) => f.id === q || f.name.toLowerCase() === q.toLowerCase())) {
            return { ok: false, message: "Этот игрок уже в вашем списке друзей" };
        }
        // In local / p2p mode, create a friend record or outgoing request
        const newFriend = {
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
    acceptRequest(reqId) {
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
    declineRequest(reqId) {
        this.pendingRequests = this.pendingRequests.filter((r) => r.id !== reqId);
        this.save();
        this.broadcast("friends:updated", this.getState());
    }
    removeFriend(friendId) {
        this.friends = this.friends.filter((f) => f.id !== friendId);
        this.save();
        this.broadcast("friends:updated", this.getState());
    }
    blockUser(friendId) {
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
    monitorGameLog(logFilePath, gameVersion, packName) {
        if (this.logWatcher) {
            this.logWatcher.close();
            this.logWatcher = null;
        }
        if (!fs_1.default.existsSync(logFilePath))
            return;
        let lastSize = 0;
        try {
            lastSize = fs_1.default.statSync(logFilePath).size;
        }
        catch { }
        const checkLog = () => {
            try {
                const stat = fs_1.default.statSync(logFilePath);
                if (stat.size <= lastSize)
                    return;
                const stream = fs_1.default.createReadStream(logFilePath, {
                    start: lastSize,
                    end: stat.size,
                    encoding: "utf8",
                });
                lastSize = stat.size;
                stream.on("data", (chunk) => {
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
            }
            catch { }
        };
        try {
            this.logWatcher = fs_1.default.watch(logFilePath, () => checkLog());
        }
        catch { }
    }
    stopMonitoring() {
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
exports.FriendsSystem = FriendsSystem;
function registerFriendsIPC(getFriendsSystem) {
    electron_1.ipcMain.handle("friends:get-state", (e) => {
        getFriendsSystem().registerWebContents(e.sender);
        return getFriendsSystem().getState();
    });
    electron_1.ipcMain.handle("friends:update-profile", (_e, update) => {
        getFriendsSystem().updateMyProfile(update);
        return true;
    });
    electron_1.ipcMain.handle("friends:send-request", (_e, target) => {
        return getFriendsSystem().sendRequest(target);
    });
    electron_1.ipcMain.handle("friends:accept-request", (_e, reqId) => {
        getFriendsSystem().acceptRequest(reqId);
        return true;
    });
    electron_1.ipcMain.handle("friends:decline-request", (_e, reqId) => {
        getFriendsSystem().declineRequest(reqId);
        return true;
    });
    electron_1.ipcMain.handle("friends:remove-friend", (_e, friendId) => {
        getFriendsSystem().removeFriend(friendId);
        return true;
    });
}
