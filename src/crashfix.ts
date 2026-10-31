/**
 * Sakura Launcher — Crash Auto-Fix Engine
 *
 * Detects Minecraft crashes from crash-reports, logs/latest.log, and stdout/stderr,
 * identifies conflicting or broken mods, and disables them to allow auto-repair.
 */

import fs from "fs";
import path from "path";

export interface CrashAnalysis {
  found: boolean;
  culprits: string[];
  reason: string;
  details: string;
  raw: string;
  canAutoFix: boolean;
}

/** Returns the latest crash log in crash-reports/ or null */
export function latestCrashReport(gameDir: string): string | null {
  const dir = path.join(gameDir, "crash-reports");
  if (!fs.existsSync(dir)) return null;
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".txt") && f.startsWith("crash-"))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return files.length ? path.join(dir, files[0].f) : null;
  } catch {
    return null;
  }
}

/** Check if latest.log has fresh crash indicators */
export function readLatestLog(gameDir: string, sinceMs: number): string | null {
  const logFile = path.join(gameDir, "logs", "latest.log");
  if (!fs.existsSync(logFile)) return null;
  try {
    const stat = fs.statSync(logFile);
    if (stat.mtimeMs < sinceMs) return null;
    const buf = fs.readFileSync(logFile, "utf8");
    // Return last 64KB of log
    return buf.length > 65536 ? buf.slice(-65536) : buf;
  } catch {
    return null;
  }
}

/** List all jar files currently present in mods directory */
export function listActualJars(modsDir: string): string[] {
  if (!modsDir || !fs.existsSync(modsDir)) return [];
  try {
    return fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith(".jar"));
  } catch {
    return [];
  }
}

/**
 * Match a mod identifier or name from crash log to an actual .jar filename in modsDir
 */
function matchJar(identifier: string, actualJars: string[]): string | null {
  if (!identifier || !actualJars.length) return null;

  const clean = identifier.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!clean) return null;

  // 1. Direct filename match
  for (const jar of actualJars) {
    if (jar.toLowerCase() === identifier.toLowerCase()) return jar;
  }

  // 2. Exact start or substring match
  for (const jar of actualJars) {
    const jarClean = jar.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (jarClean.includes(clean) || clean.includes(jarClean.replace(/jar$/, ""))) {
      return jar;
    }
  }

  // 3. Partial stem match
  for (const jar of actualJars) {
    const stem = path.basename(jar, ".jar").toLowerCase().split(/[-_0-9]/)[0];
    if (stem.length >= 3 && clean.includes(stem)) {
      return jar;
    }
  }

  return null;
}

/**
 * Analyze crash text and match against installed mods
 */
export function analyseCrash(rawText: string, modsDir: string): CrashAnalysis {
  if (!rawText || typeof rawText !== "string") {
    return {
      found: false,
      culprits: [],
      reason: "",
      details: "",
      raw: "",
      canAutoFix: false,
    };
  }

  const actualJars = listActualJars(modsDir);
  const foundCulprits = new Set<string>();
  let reason = "";
  let details = "";

  // 1. Fabric Mixin errors
  const mixinMatch = rawText.match(/Mixin apply for mod ([a-zA-Z0-9_\-]+) failed/i)
    || rawText.match(/org\.spongepowered\.asm\.mixin\.transformer\.throwables.*in ([a-zA-Z0-9_\-]+)\.mixins\.json/i);
  if (mixinMatch) {
    const modId = mixinMatch[1];
    const matched = matchJar(modId, actualJars);
    if (matched) foundCulprits.add(matched);
    reason = `Конфликт Mixin в моде «${modId}»`;
    details = `Мод не может внести изменения в код игры из-за несовместимости с другим модом.`;
  }

  // 2. ModResolutionException (Fabric duplicate or incompatible)
  if (!reason) {
    const dupMatch = rawText.match(/duplicate mod '([^']+)'/i);
    if (dupMatch) {
      const modId = dupMatch[1];
      const matched = matchJar(modId, actualJars);
      if (matched) foundCulprits.add(matched);
      reason = `Обнаружен дубликат мода: «${modId}»`;
      details = `У вас установлено несколько версий одного и того же мода.`;
    }
  }

  // 3. Incompatible mod set (Fabric / NeoForge)
  if (!reason) {
    const incompMatch = rawText.match(/Mod '([^']+)' is incompatible with/i)
      || rawText.match(/Incompatible mods found![\s\S]*?- Mod '([^']+)'/i)
      || rawText.match(/incompatible mod set.*['"]([^'"]+)['"]/i);
    if (incompMatch) {
      const modId = incompMatch[1];
      const matched = matchJar(modId, actualJars);
      if (matched) foundCulprits.add(matched);
      reason = `Несовместимый мод: «${modId}»`;
      details = `Этот мод не может работать вместе с другими установленными модами.`;
    }
  }

  // 4. Missing dependencies: "Mod X requires Y, which is missing"
  if (!reason) {
    const reqMatch = rawText.match(/Mod '([^']+)' requires [^,\n]+which is missing/i)
      || rawText.match(/requires (?:mod )?'([^']+)',? which is missing/i);
    if (reqMatch) {
      const brokenMod = reqMatch[1];
      const matched = matchJar(brokenMod, actualJars);
      if (matched) foundCulprits.add(matched);
      reason = `Мод «${brokenMod}» требует недостающую библиотеку`;
      details = `Для работы мода не хватает обязательной зависимости. Его временное отключение восстановит запуск.`;
    }
  }

  // 5. Forge ModLoadingException / Dependency errors
  if (!reason) {
    const forgeMatch = rawText.match(/Mod File: .*[/\\]mods[/\\]([\w\-\.]+\.jar)/i)
      || rawText.match(/Failed to create mod instance\. ModID: ([a-zA-Z0-9_\-]+)/i)
      || rawText.match(/An error occurred during the [a-z_]+ event phase of the event bus from mod ([a-zA-Z0-9_\-]+)/i);
    if (forgeMatch) {
      const rawJar = forgeMatch[1];
      const matched = matchJar(rawJar, actualJars) || (actualJars.includes(rawJar) ? rawJar : null);
      if (matched) foundCulprits.add(matched);
      reason = `Ошибка инициализации Forge мода «${rawJar}»`;
      details = `Мод упал во время этапа загрузки Forge.`;
    }
  }

  // 6. Direct JAR filename in stacktrace
  if (!foundCulprits.size) {
    const jarMatches = rawText.match(/[/\\]mods[/\\]([\w\-\.+ ]+\.jar)/gi);
    if (jarMatches) {
      for (const m of jarMatches) {
        const fn = path.basename(m);
        if (actualJars.includes(fn)) {
          foundCulprits.add(fn);
          break;
        }
      }
    }
  }

  // 7. Out of Memory error
  if (!reason && (rawText.includes("java.lang.OutOfMemoryError") || rawText.includes("OutOfMemory"))) {
    return {
      found: true,
      culprits: [],
      reason: "Нехватка оперативной памяти (OutOfMemory)",
      details: "Игре не хватило выделенной памяти. Увеличьте объем ОЗУ (RAM) в Настройках лаунчера.",
      raw: rawText.slice(0, 10000),
      canAutoFix: false,
    };
  }

  const culpritsList = Array.from(foundCulprits);

  if (culpritsList.length > 0) {
    if (!reason) {
      reason = `Конфликт в моде «${culpritsList[0]}»`;
      details = `Лаунчер обнаружил ошибку в работе этого мода.`;
    }
    return {
      found: true,
      culprits: culpritsList,
      reason,
      details,
      raw: rawText.slice(0, 10000),
      canAutoFix: true,
    };
  }

  // Generic crash found
  const isCrash = rawText.includes("---- Minecraft Crash Report ----")
    || rawText.includes("A fatal error has been detected")
    || rawText.includes("Exception in thread")
    || rawText.includes("ModResolutionException");

  return {
    found: isCrash,
    culprits: actualJars.length === 1 ? [actualJars[0]] : [],
    reason: isCrash ? "Minecraft завершился с ошибкой" : "Игра закрыта",
    details: isCrash ? "Конкретный мод не указан явно, но вы можете проверить краш-лог." : "",
    raw: rawText.slice(0, 10000),
    canAutoFix: actualJars.length === 1,
  };
}

/**
 * Disables mod files by renaming them to .disabled (recognized by InstancesManager and Minecraft)
 */
export function disableMods(modsDir: string, filenames: string[]): string[] {
  if (!modsDir || !fs.existsSync(modsDir) || !filenames.length) return [];
  const disabled: string[] = [];
  for (const fn of filenames) {
    const src = path.join(modsDir, fn);
    if (!fs.existsSync(src)) continue;
    const dst = src.endsWith(".disabled") ? src : src + ".disabled";
    if (src === dst) continue;
    try {
      if (fs.existsSync(dst)) fs.unlinkSync(dst);
      fs.renameSync(src, dst);
      disabled.push(fn);
    } catch {
      try {
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
        disabled.push(fn);
      } catch {}
    }
  }
  return disabled;
}

/**
 * Re-enables previously disabled mods
 */
export function enableMods(modsDir: string, filenames: string[]): string[] {
  if (!modsDir || !fs.existsSync(modsDir) || !filenames.length) return [];
  const restored: string[] = [];
  for (const fn of filenames) {
    const src = path.join(modsDir, fn.endsWith(".disabled") ? fn : fn + ".disabled");
    const dst = path.join(modsDir, fn.replace(/\.disabled$/, ""));
    if (!fs.existsSync(src)) continue;
    try {
      if (fs.existsSync(dst)) fs.unlinkSync(dst);
      fs.renameSync(src, dst);
      restored.push(fn);
    } catch {
      try {
        fs.copyFileSync(src, dst);
        fs.unlinkSync(src);
        restored.push(fn);
      } catch {}
    }
  }
  return restored;
}

/** List disabled mods */
export function listDisabledMods(modsDir: string): string[] {
  const dir = path.join(modsDir, "disabled");
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".jar"));
  } catch {
    return [];
  }
}
