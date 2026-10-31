let closeTimer = null;
/* ---- Play & Versions Logic ---- */
const vs = $('#ver');
let busy = false;
let installedVersions = new Set();

window.fetchVersions = async function() {
  if (!vs) return;
  try {
    if (window.sakura && window.sakura.getInstalledVersions) {
      try {
        const list = await window.sakura.getInstalledVersions();
        if (Array.isArray(list)) list.forEach(v => installedVersions.add(v));
      } catch(e) {}
    }
    if (Array.isArray(ST.installed)) {
      ST.installed.forEach(v => installedVersions.add(v));
    }

    let matrix = null;
    if (window.sakura && window.sakura.versionsMatrix) {
      try {
        matrix = await window.sakura.versionsMatrix();
      } catch(err) {
        console.warn("versionsMatrix failed, using fallback:", err);
      }
    }
    
    let items = [];
    if (matrix && Array.isArray(matrix.releases) && matrix.releases.length > 0) {
      const releaseList = matrix.releases.filter(v => {
        const type = (matrix.versionTypes && matrix.versionTypes[v]) || 'release';
        return type === 'release';
      });
      if (releaseList.length > 0 && typeof window.updateAllVersionDropdowns === 'function') {
        window.updateAllVersionDropdowns(releaseList);
      }

      matrix.releases.forEach(v => {
        const type = (matrix.versionTypes && matrix.versionTypes[v]) || 'release';
        const isSnap = type === 'snapshot';
        const isOld = type === 'old_beta' || type === 'old_alpha';
        
        if (isSnap && !ST.showSnap) return;
        if (isOld && !ST.showAlpha) return;
        if (type !== 'release' && !isSnap && !isOld && !ST.showSnap && !ST.showAlpha) return;
        
        items.push({ text: `${v} (Vanilla)`, val: `${v}|Vanilla` });
        if (matrix.loaders?.Horizon && matrix.loaders.Horizon[v]) items.push({ text: `${v} (Horizon · Rust)`, val: `${v}|Horizon` });
        if (matrix.loaders?.Fabric && matrix.loaders.Fabric[v]) items.push({ text: `${v} (Fabric)`, val: `${v}|Fabric` });
        if (matrix.loaders?.Forge && matrix.loaders.Forge[v]) items.push({ text: `${v} (Forge)`, val: `${v}|Forge` });
        if (matrix.loaders?.NeoForge && matrix.loaders.NeoForge[v]) items.push({ text: `${v} (NeoForge)`, val: `${v}|NeoForge` });
        if (matrix.loaders?.Quilt && matrix.loaders.Quilt[v]) items.push({ text: `${v} (Quilt)`, val: `${v}|Quilt` });
      });
    }
    
    if (items.length === 0) {
      VL.forEach(v => {
        items.push({ text: `${v} (Vanilla)`, val: `${v}|Vanilla` });
        if (v === '26.3') items.push({ text: `${v} (Horizon · Rust)`, val: `${v}|Horizon` });
        items.push({ text: `${v} (Fabric)`, val: `${v}|Fabric` });
        items.push({ text: `${v} (Forge)`, val: `${v}|Forge` });
        items.push({ text: `${v} (NeoForge)`, val: `${v}|NeoForge` });
        items.push({ text: `${v} (Quilt)`, val: `${v}|Quilt` });
      });
    }
    
    const curVal = (ST.lastVersion && items.some(it => it.val === ST.lastVersion)) ? ST.lastVersion : (vs.value || items[0].val);
    vs.innerHTML = items.map(it => `<option value="${it.val}">${it.text}</option>`).join('');
    if (items.some(it => it.val === curVal)) vs.value = curVal;
    if (typeof window.syncModsFilterWithPlayVersion === 'function') window.syncModsFilterWithPlayVersion();
    window.upd();
  } catch(e) {
    console.error("Failed to fetch versions:", e);
  }
};

window.upd = function() {
  const g = $('#go');
  if (!g) return;
  g.disabled = busy;
  
  const val = vs ? vs.value : '';
  const isInst = installedVersions.has(val);
  g.textContent = isInst ? 'Играть' : 'Установить';
  
  // Clear the subtext under the play button as requested!
  const st = $('#st');
  if (st && !busy) st.textContent = '';
};

if (vs) vs.onchange = () => {
  $('#bi').style.width = '0';
  ST.lastVersion = vs.value;
  save();
  if (typeof window.syncModsFilterWithPlayVersion === 'function') window.syncModsFilterWithPlayVersion();
  window.upd();
};

window.doLaunchGame = async function(e) {
  if (busy) return;
  const g = $('#go');
  
  const psel = document.getElementById('play_pack_sel');
  const packId = psel && psel.value ? psel.value : undefined;
  
  let v = '26.3', l = 'Vanilla';
  if (packId && ST && ST.packs) {
    const p = ST.packs.find(q => q.id === packId);
    if (p) {
      v = p.v;
      l = p.l;
    }
  } else if (vs && vs.value) {
    const parts = vs.value.split('|');
    v = parts[0];
    l = parts[1] || 'Vanilla';
  }

  if (!v || v === 'undefined') {
    toast('Выберите версию Minecraft');
    return;
  }
  
  // Set to installed
  installedVersions.add(`${v}|${l}`);
  if (!Array.isArray(ST.installed)) ST.installed = [];
  if (!ST.installed.includes(`${v}|${l}`)) ST.installed.push(`${v}|${l}`);
  ST.lastVersion = `${v}|${l}`;
  save();
  
  busy = true;
  window.upd();
  
  try {
    toast(`Запускаем ${v} (${l})...`);
    const active = window.ST_ACCOUNTS ? window.ST_ACCOUNTS.find(a => a.id === window.ST_ACTIVE_ACC) : null;
    const res = await window.sakura.launchMinecraft({
      version: v,
      loader: l,
      ram: (ST.ram && Number(ST.ram) >= 1) ? Math.round(Number(ST.ram)) : 4,
      packId: packId,
      elyAuth: !!ST.elyAuth,
      skinData: ST.skinData || '',
      skinSlim: !!ST.skinSlim,
      nick: (active && active.name) || ST.nick || 'Player'
    });
    
    busy = false;
    window.upd();
    
    if (res.ok) {
      toast("Игра запущена!");
      if (ST.cl) {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          try { window.close(); } catch {}
        }, 6000);
      }
    } else {
      toast("Ошибка запуска: " + res.error);
    }
  } catch(err) {
    busy = false;
    window.upd();
    toast("Ошибка: " + err.message);
  }
};

const goBtn = $('#go');
if (goBtn) goBtn.onclick = window.doLaunchGame;

window.clearGameLogs = function() {
  const box = document.getElementById('game_log_box');
  if (box) box.textContent = '';
  toast('Логи очищены');
};

window.copyGameLogs = function() {
  const box = document.getElementById('game_log_box');
  if (box) {
    navigator.clipboard.writeText(box.textContent || '').then(() => toast('Логи скопированы в буфер обмена!'));
  }
};

if (window.sakura && window.sakura.onLauncherEvent) {
  window.sakura.onLauncherEvent('started', () => {
    window.isGameRunning = true;
  });
  window.sakura.onLauncherEvent('progress', (data) => {
    if (!data) return;
    const stage = data.stage || 'Загрузка...';
    const pct = data.pct || 0;
    if ($('#bi')) $('#bi').style.width = pct + '%';
    if ($('#st')) $('#st').textContent = `${stage} (${pct}%)`;
  });
  window.sakura.onLauncherEvent('log', (msg) => {
    console.log('[MCLC]', msg);
    const box = document.getElementById('game_log_box');
    if (box) {
      const line = document.createElement('div');
      const text = String(msg);
      line.textContent = text;
      if (text.includes('[ERROR]') || text.includes('Exception') || text.includes('Error')) {
        line.style.color = '#ff6b6b';
      } else if (text.includes('[WARN]')) {
        line.style.color = '#ffd166';
      }
      box.appendChild(line);
      while (box.childNodes.length > 2000) {
        box.removeChild(box.firstChild);
      }
      box.scrollTop = box.scrollHeight;
    }
  });
  window.sakura.onLauncherEvent('closed', (data) => {
    busy = false;
    window.isGameRunning = false;
    window.upd();
    const code = data ? data.code : 0;
    if (code !== 0) {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      toast(`Игра закрылась с кодом ${code}. Подробности во вкладке «Логи».`);
      if ($('#st')) $('#st').textContent = `Ошибка игры (код ${code})`;
    } else {
      if ($('#st')) $('#st').textContent = 'Игра завершена';
    }
  });
}

setTimeout(() => {
  window.fetchVersions();
}, 100);