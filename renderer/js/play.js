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
      matrix = await window.sakura.versionsMatrix();
    }
    
    let items = [];
    if (matrix && matrix.releases) {
      matrix.releases.forEach(v => {
        const type = (matrix.versionTypes && matrix.versionTypes[v]) || 'release';
        const isSnap = type === 'snapshot';
        const isOld = type === 'old_beta' || type === 'old_alpha';
        
        if (isSnap && !ST.showSnap) return;
        if (isOld && !ST.showAlpha) return;
        if (type !== 'release' && !isSnap && !isOld && !ST.showSnap && !ST.showAlpha) return;
        
        items.push({ text: `${v} (Vanilla)`, val: `${v}|Vanilla` });
        if (matrix.loaders.Fabric && matrix.loaders.Fabric[v]) items.push({ text: `${v} (Fabric)`, val: `${v}|Fabric` });
        if (matrix.loaders.Forge && matrix.loaders.Forge[v]) items.push({ text: `${v} (Forge)`, val: `${v}|Forge` });
        if (matrix.loaders.NeoForge && matrix.loaders.NeoForge[v]) items.push({ text: `${v} (NeoForge)`, val: `${v}|NeoForge` });
      });
    } else {
      // Fallback
      items = [
        { text: '1.21.4 (Vanilla)', val: '1.21.4|Vanilla' },
        { text: '1.21.4 (Fabric)', val: '1.21.4|Fabric' },
        { text: '1.20.1 (Forge)', val: '1.20.1|Forge' }
      ];
    }
    
    const curVal = (ST.lastVersion && items.some(it => it.val === ST.lastVersion)) ? ST.lastVersion : (vs.value || items[0].val);
    vs.innerHTML = items.map(it => `<option value="${it.val}">${it.text}</option>`).join('');
    if (items.some(it => it.val === curVal)) vs.value = curVal;
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

if (vs) vs.onchange = () => { $('#bi').style.width = '0'; ST.lastVersion = vs.value; save(); window.upd(); };

window.doLaunchGame = async function(e) {
  if (busy) return;
  const g = $('#go');
  
  const psel = document.getElementById('play_pack_sel');
  const packId = psel && psel.value ? psel.value : undefined;
  
  let v = '1.21.4', l = 'Vanilla';
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
      ram: ST.ram || 4,
      packId: packId,
      elyAuth: !!ST.elyAuth
    });
    
    busy = false;
    window.upd();
    
    if (res.ok) {
      toast("Игра запущена!");
      if (ST.cl) window.close();
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

if (window.sakura && window.sakura.onLauncherEvent) {
  window.sakura.onLauncherEvent('progress', (data) => {
    if (!data) return;
    const stage = data.stage || 'Загрузка...';
    const pct = data.pct || 0;
    if ($('#bi')) $('#bi').style.width = pct + '%';
    if ($('#st')) $('#st').textContent = `${stage} (${pct}%)`;
  });
  window.sakura.onLauncherEvent('log', (msg) => {
    console.log('[MCLC]', msg);
  });
}

setTimeout(() => {
  window.fetchVersions();
}, 100);