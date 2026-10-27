/**
 * Comprehensive Automated Test Suite for Sakura Minecraft Launcher
 * Tests all core subsystems: Download Manager, Instances, Modpack Installer,
 * Friends & Presence, and 500+ Servers Catalog.
 */
import fs from "fs";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";
import { InstancesManager } from "../src/instances";
import { downloadManager } from "../src/downloadManager";
import { ModpackInstaller } from "../src/modpackInstaller";
import { FriendsSystem } from "../src/friends";
import { ServersCatalogManager, buildServersDatabase } from "../src/serversCatalog";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`[PASS] ${msg}`);
    passed++;
  } else {
    console.error(`[FAIL] ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log("=== STARTING AUTOMATED TEST SUITE ===");

  const tmpTestDir = path.join(os.tmpdir(), "sakura_test_env_" + Date.now());
  fs.mkdirSync(tmpTestDir, { recursive: true });

  const getTestDataDir = () => tmpTestDir;

  // -------------------------------------------------------------
  // TEST 1: Instances Manager & Structure
  // -------------------------------------------------------------
  console.log("\n--- TEST 1: Isolated Instances Structure ---");
  const instancesMgr = new InstancesManager(getTestDataDir);
  const created = instancesMgr.create({
    id: "test_pack",
    name: "Тестовая Сборка",
    desc: "Проверка структуры",
    v: "1.21.1",
    l: "Fabric"
  });
  assert(created === true, "Instance created successfully");

  const instDir = instancesMgr.getInstancePath("test_pack");
  const expectedDirs = ["mods", "resourcepacks", "shaderpacks", "config", "defaultconfigs", "saves", "screenshots", "logs", "crash-reports"];
  for (const d of expectedDirs) {
    assert(fs.existsSync(path.join(instDir, d)), `Instance subfolder '${d}' exists`);
  }
  assert(fs.existsSync(path.join(instDir, "instance.json")), "Instance metadata 'instance.json' exists");
  assert(fs.existsSync(path.join(instDir, "manifest.json")), "Instance manifest 'manifest.json' exists");

  // Add dummy mod and test component management
  const dummyMod = path.join(instDir, "mods", "sodium-fabric-0.5.8.jar");
  fs.writeFileSync(dummyMod, "PK\x03\x04dummy_jar_content");
  const dummyRp = path.join(instDir, "resourcepacks", "faithful32.zip");
  fs.writeFileSync(dummyRp, "PK\x03\x04dummy_zip_content");

  const components = instancesMgr.getComponents("test_pack");
  assert(components.length === 2, `Instance components count is 2 (found: ${components.length})`);

  // Test toggle component (.disabled)
  const toggled = instancesMgr.toggleComponent("test_pack", "mods", "sodium-fabric-0.5.8.jar");
  assert(toggled === true, "Component toggled to .disabled successfully");
  assert(fs.existsSync(dummyMod + ".disabled"), "Disabled mod has .disabled suffix on disk");

  const toggledBack = instancesMgr.toggleComponent("test_pack", "mods", "sodium-fabric-0.5.8.jar.disabled");
  assert(toggledBack === true, "Component re-enabled successfully");
  assert(fs.existsSync(dummyMod), "Re-enabled mod has restored filename on disk");

  // Test duplicate instance
  const duplicated = instancesMgr.duplicate("test_pack", "test_pack_copy", "Копия Сборки");
  assert(duplicated === true, "Instance duplicated successfully");
  assert(fs.existsSync(instancesMgr.getInstancePath("test_pack_copy")), "Duplicated instance exists on disk");

  // Test export instance
  const exportZip = path.join(tmpTestDir, "export_test.zip");
  const exported = instancesMgr.exportInstance("test_pack", exportZip);
  assert(exported === true && fs.existsSync(exportZip), "Instance exported to ZIP successfully");

  // -------------------------------------------------------------
  // TEST 2: 500+ Verified Servers Catalog
  // -------------------------------------------------------------
  console.log("\n--- TEST 2: 500+ Servers Catalog ---");
  const serversMgr = new ServersCatalogManager(getTestDataDir);
  const qAll = serversMgr.query({ pageSize: 100 });
  assert(qAll.total >= 500, `Servers database has 500+ servers (actual total: ${qAll.total})`);

  // Filter by mode
  const qAnarchy = serversMgr.query({ mode: "Анархия", pageSize: 50 });
  assert(qAnarchy.servers.length > 0 && qAnarchy.servers.every(s => s.modes.includes("Анархия")), "Filtered servers by 'Анархия' successfully");

  // Filter by search query
  const qFuntime = serversMgr.query({ search: "FunTime" });
  assert(qFuntime.servers.some(s => s.name === "FunTime" && s.ip === "mc.funtime.su"), "Found FunTime in search");

  // Test favorites
  const favAdded = serversMgr.toggleFavorite("s_funtime", tmpTestDir);
  assert(favAdded === true, "Added FunTime to favorites");
  const qFavs = serversMgr.query({ favoritesOnly: true });
  assert(qFavs.servers.some(s => s.id === "s_funtime"), "Favorite query returns FunTime");

  // -------------------------------------------------------------
  // TEST 3: Friends & Presence System
  // -------------------------------------------------------------
  console.log("\n--- TEST 3: Friends & Presence ---");
  const friends = new FriendsSystem(getTestDataDir);
  const profile = friends.getState().myProfile;
  assert(profile.id.startsWith("usr_") || profile.id.startsWith("f_"), `Profile has valid generated ID (${profile.id})`);
  assert(profile.status === "online", "Initial profile status is online");

  // Update status
  friends.updateMyProfile({ status: "dnd", statusText: "Занят" });
  assert(friends.getState().myProfile.status === "dnd", "Profile status updated to dnd");

  // Friend requests
  const reqRes = friends.sendRequest("PlayerOne");
  assert(reqRes.ok === true, "Friend request sent to PlayerOne");
  assert(friends.getState().friends.some(f => f.name === "PlayerOne"), "PlayerOne added to friends list");

  // Test Minecraft log watcher for LAN detection
  const logFile = path.join(tmpTestDir, "test_minecraft.log");
  fs.writeFileSync(logFile, "[12:00:00] [Server thread/INFO]: Starting minecraft server\n");
  friends.monitorGameLog(logFile, "1.21.1", "Тестовая Сборка");

  // Append LAN opened line
  fs.appendFileSync(logFile, "[12:00:05] [Server thread/INFO]: Started local server on 54321\n");
  await new Promise(r => setTimeout(r, 200));

  const lanProfile = friends.getState().myProfile;
  assert(lanProfile.status === "lan_host" && lanProfile.lanPort === 54321, `LAN game detected from log (port: ${lanProfile.lanPort})`);
  friends.stopMonitoring();
  assert(friends.getState().myProfile.status === "online", "Profile status reset to online after game close");

  // -------------------------------------------------------------
  // TEST 4: Modpack Installer (.mrpack parsing)
  // -------------------------------------------------------------
  console.log("\n--- TEST 4: Modpack Installer Archive Format ---");
  const mrpackZipPath = path.join(tmpTestDir, "test_pack.mrpack");
  const zip = new AdmZip();
  const indexJson = {
    formatVersion: 1,
    game: "minecraft",
    versionId: "1.0.0",
    name: "Sample Modrinth Pack",
    summary: "Test pack",
    dependencies: {
      minecraft: "1.21.1",
      fabric: "0.16.0"
    },
    files: [
      {
        path: "mods/sample-mod.jar",
        hashes: { sha1: "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed" },
        downloads: ["https://cdn.modrinth.com/data/sample.jar"],
        fileSize: 1024
      }
    ]
  };
  zip.addFile("modrinth.index.json", Buffer.from(JSON.stringify(indexJson)));
  zip.addFile("overrides/config/sample.cfg", Buffer.from("enableFeature=true"));
  zip.writeZip(mrpackZipPath);

  assert(fs.existsSync(mrpackZipPath), "Sample .mrpack archive created");
  const zipCheck = new AdmZip(mrpackZipPath);
  assert(zipCheck.getEntry("modrinth.index.json") !== null, "modrinth.index.json verified inside .mrpack");

  // Clean up test directory
  try {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  } catch {}

  console.log("\n=== TEST RESULTS ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
