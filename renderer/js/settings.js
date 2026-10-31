
if ($('#sfx_enabled')) {
  $('#sfx_enabled').checked = ST.sfxEnabled !== false;
  $('#sfx_enabled').onchange = (e) => {
    ST.sfxEnabled = e.target.checked;
    save();
  };
}

function accUI(){ if($('#gb')){$('#gb').textContent=ST.g?'Выйти':'Войти через Google';$('#gb').classList.toggle('on',!!ST.g);$('#gs').textContent=ST.g?'Google аккаунт подключён':'Используйте Google для удобного входа';} if($('#who')) $('#who').textContent=ST.nick||(ST.g?'Аккаунт Google':'Гость'); }
function applyST(full){ if($('#showSnap')) $('#showSnap').checked=!!ST.showSnap; if($('#showAlpha')) $('#showAlpha').checked=!!ST.showAlpha;
  if($('#jvm_args')) $('#jvm_args').value=ST.jvmArgs||'';
  if($('#game_w')) $('#game_w').value=ST.gameW||'1280';
  if($('#game_h')) $('#game_h').value=ST.gameH||'720';
  if($('#game_fs')) $('#game_fs').checked=!!ST.gameFs;
  $('#ram').value=ST.ram;$('#rv').textContent=ST.ram+' ГБ';$('#java').selectedIndex=ST.java;$('#dir').value=ST.dir;$('#cl').checked=ST.cl;
  $('#qs').value=ST.q;$('#an').checked=ST.anim!==false;document.documentElement.dataset.q=ST.q;$('#phd').value=ST.phDim;$('#phbl').value=ST.phBlur;$('#pt').checked=ST.petals;S.petals=ST.petals;$('#wd').value=ST.wind;S.wind=ST.wind;if($('#sfx_enabled')) $('#sfx_enabled').checked=ST.sfxEnabled!==false;accUI();
  if(full){setScene(ST.scene);$('#scn').value=ST.scene;}
}
if($('#jvm_args')) $('#jvm_args').oninput=e=>{ST.jvmArgs=e.target.value;save()};
if($('#game_w')) $('#game_w').oninput=e=>{ST.gameW=e.target.value;save()};
if($('#game_h')) $('#game_h').oninput=e=>{ST.gameH=e.target.value;save()};
if($('#game_fs')) $('#game_fs').onchange=e=>{ST.gameFs=e.target.checked;save()};
if($('#showSnap')) $('#showSnap').onchange=e=>{ST.showSnap=e.target.checked;save();if(window.fetchVersions)window.fetchVersions()};
if($('#showAlpha')) $('#showAlpha').onchange=e=>{ST.showAlpha=e.target.checked;save();if(window.fetchVersions)window.fetchVersions()};
if($('#ram')) $('#ram').oninput=e=>{ST.ram=+e.target.value;$('#rv').textContent=ST.ram+' ГБ';save()};
if($('#java')) $('#java').onchange=e=>{ST.java=e.target.selectedIndex;save()};
if($('#dir')) $('#dir').onchange=e=>{ST.dir=e.target.value;save()};
window.browseDataDir = async function() {
  if (window.sakura && window.sakura.showOpenFile) {
    try {
      const selected = await window.sakura.showOpenFile({
        title: 'Выберите папку для данных лаунчера (LauncherData)'
      });
      if (selected) {
        const folder = selected.replace(/[\\/][^\\/]+$/, '');
        ST.dir = folder;
        if (document.getElementById('dir')) document.getElementById('dir').value = folder;
        save();
        if (window.sakura.contentGetStructure) {
          await window.sakura.contentGetStructure();
        }
        toast('Папка данных лаунчера успешно обновлена и проверена!');
      }
    } catch {
      toast('Не удалось изменить папку');
    }
  }
};
if($('#cl')) $('#cl').onchange=e=>{ST.cl=e.target.checked;save()};
if($('#wd')) $('#wd').oninput=e=>{S.wind=ST.wind=+e.target.value;save()};
if($('#pt')) $('#pt').onchange=e=>{S.petals=ST.petals=e.target.checked;save()};
if($('#scn')) $('#scn').onchange=e=>{setScene(e.target.value);$('#scn').value=ST.scene;save()};
if($('#qs')) $('#qs').onchange=e=>{ST.q=e.target.value;document.documentElement.dataset.q=ST.q;if(scene&&scene.gl)scene.build();save()};
if($('#an')) $('#an').onchange=e=>{ST.anim=e.target.checked;rm=!ST.anim;save()};
if($('#phb')) $('#phb').onclick=()=>$('#phf').click();
$('#phf').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  e.target.value = '';

  const isVideo = f.type.startsWith('video/') || /\.(mp4|webm|ogg|mov)$/i.test(f.name);
  if (isVideo) {
    // Validate video duration: maximum 30 seconds!
    const blobUrl = URL.createObjectURL(f);
    const tempVid = document.createElement('video');
    tempVid.preload = 'metadata';
    tempVid.src = blobUrl;
    tempVid.onloadedmetadata = async () => {
      URL.revokeObjectURL(blobUrl);
      const dur = tempVid.duration;
      if (dur > 30.5) {
        toast(`Видео слишком длинное (${Math.round(dur)} сек.). Максимум 30 секунд!`);
        return;
      }
      try {
        const ph = SCN.photo || (SCN.photo = mkPhoto());
        if (window.applyVideoBg) window.applyVideoBg(f);
        // Save to IndexedDB
        const idb = () => new Promise((res, rej) => {
          const r = indexedDB.open('sakura', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('bg');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        const db = await idb();
        await new Promise((res, rej) => {
          const t = db.transaction('bg', 'readwrite');
          t.objectStore('bg').put(f, 'img');
          t.oncomplete = res;
          t.onerror = () => rej(t.error);
        });
        toast(`Видео-фон (${Math.round(dur)} сек.) успешно установлен!`);
      } catch (err) {
        toast('Ошибка при установке видео');
      }
    };
    tempVid.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      toast('Не удалось прочитать видео-файл');
    };
  } else {
    // Image
    const ph = SCN.photo || (SCN.photo = mkPhoto());
    try {
      if (window.stopVideoBg) window.stopVideoBg();
      const g = document.getElementById('g');
      if (g) g.hidden = false;
      await ph.set(f);
      toast('Фото установлено');
    } catch (x) {
      toast('Не удалось открыть это фото');
    }
  }
};
if($('#phd')) $('#phd').oninput=e=>{ST.phDim=+e.target.value;save();if(window.updateBgFilters)window.updateBgFilters()};
if($('#phbl')) $('#phbl').oninput=e=>{ST.phBlur=+e.target.value;save();if(window.updateBgFilters)window.updateBgFilters()};
if($('#gb')) $('#gb').onclick=async()=>{ try { toast('Открываем браузер...'); const r=await window.sakura.accountsGoogle(); if(r.ok) { window.syncAccounts(r); toast('Google подключён'); } else toast('Ошибка: '+r.error); } catch(e){toast('Ошибка: '+e.message);} };

const elyd=$('#elyp');
/*
  if(ST.ely){ST.ely='';accUI();save();return}
  $('#eyn').value='';$('#eye').textContent='';$('#eya').hidden=false;$('#eyr').hidden=true;elyd.showModal();$('#eyn').focus();
};
$('#eyc').onclick=()=>elyd.close();
*/ if($('#eyk')) $('#eyk').onclick=(e)=>{ window.doAuthElyFinish(e); }; /*
  const v=$('#eyn').value.trim();
  if(!/^[\w.-]{2,32}$/.test(v)){$('#eye').textContent='Ник Ely.by: 2–32 символа, латиница, цифры, _ . -';return}
  $('#eya').hidden=true;$('#eyr').hidden=false;
  setTimeout(()=>{elyd.close();ST.ely=v;accUI();save();toast(`Ely.by подключён: ${v}`)},1200);
*/ 

/* (если есть): общая база ников и профиль, который сохраняется между устройствами */
(async()=>{
  try{
    if(!window.claude)return;
    DB=await window.claude.use('db');const u=await window.claude.use('user');UID=u?await u.id():null;
    if(DB&&UID){
      const q=await DB.doc(`data/users/${UID}/profile`).get();
      if(q.exists){Object.assign(ST,q.data());applyST(true)}else if(ST.nick)save();
    }
  }catch(e){}
})();

applyST(false);
setScene(ST.scene||(matchMedia('(prefers-color-scheme:dark)').matches?'aurora':'sakura'));$('#scn').value=ST.scene;
requestAnimationFrame(frame);

if (typeof ST !== 'undefined' && typeof ST.cl === 'undefined') ST.cl = true;
// ==== SAKURA ELECTRON CORE ====

window.makeCustomSelects = () => {};

window.uiConfirm = (text, cb) => {
  const dlg = document.getElementById('confirm_dlg');
  if(dlg) {
    document.getElementById('confirm_txt').textContent = text;
    document.getElementById('confirm_yes').onclick = () => { dlg.close(); cb(); };
    dlg.showModal();
  } else if (confirm(text)) cb();
};

window.openModpackDialog = async (pid) => {
  const p = ST.packs.find(q=>q.id===pid);
  if(!p) return;
  window.activePackId = pid;
  document.getElementById('packt').textContent = p.name;
  document.getElementById('pack_desc_view').textContent = p.desc || 'Нет описания';
  
  // Fill stats
  const playtimeEl = document.getElementById('pack_playtime');
  if (playtimeEl) playtimeEl.textContent = (p.playtime ? Math.round(p.playtime / 60) + ' ч.' : '0 мин.');
  const pvi = document.getElementById('pack_ver_info');
  if (pvi) pvi.textContent = `${p.v || '1.21.1'} (${p.l || 'Fabric'})`;
  const pmc = document.getElementById('pack_mods_count');
  if (pmc) pmc.textContent = (p.mods ? p.mods.length : 0);
  const cd = document.getElementById('pack_created_date');
  if (cd) {
    const d = p.createdAt || p.ts || Date.now();
    cd.textContent = new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  
  const list = document.getElementById('pack_mods_list');
  let diskMods = [];
  if (window.sakura && window.sakura.getPackMods) {
    try {
      diskMods = await window.sakura.getPackMods(pid);
    } catch(e) {}
  }

  // Merge disk mods and p.mods
  const allMods = [];
  const seenFiles = new Set();

  diskMods.forEach(dm => {
    seenFiles.add(dm.filename.toLowerCase());
    allMods.push({
      t: dm.name,
      filename: dm.filename,
      size: dm.size,
      onDisk: true
    });
  });

  if (p.mods && Array.isArray(p.mods)) {
    p.mods.forEach((pm, i) => {
      const fn = (pm.filename || pm.t || '').toLowerCase();
      if (!seenFiles.has(fn)) {
        allMods.push({
          t: pm.t,
          filename: pm.filename || null,
          id: pm.id,
          meta: pm.meta,
          pIdx: i,
          onDisk: false
        });
      }
    });
  }

  if (pmc) pmc.textContent = allMods.length;

  if (!allMods.length) {
    list.innerHTML = '<p class="sub">В сборке пока нет модов</p>';
  } else {
    list.innerHTML = allMods.map((m, i) => {
      const sub = m.onDisk 
        ? `${(m.size / 1024 / 1024).toFixed(1)} МБ • Установлен в папку`
        : `В списке сборки`;
      return `<div class="mc2">
        <div class="ico">${esc(m.t[0] || 'M')}</div>
        <div class="mi">
          <b>${esc(m.t)}</b>
          <p>${esc(sub)}</p>
        </div>
        <div class="mb">
          <button class="btn" onclick="window.removeModFromPack('${pid}', '${esc(m.filename || '')}', ${typeof m.pIdx === 'number' ? m.pIdx : -1});event.stopPropagation()">Удалить</button>
        </div>
      </div>`;
    }).join('');
  }
  
  const pt = document.getElementById('pack_tab_settings');
  if (pt) pt.click();
  document.querySelectorAll('section').forEach(s => s.hidden = true);
  document.querySelectorAll('.n').forEach(b => b.classList.remove('on'));
  const panel = document.querySelector('.panel');
  if (panel) panel.classList.add('xl');
  document.getElementById('pack_view').hidden = false;
};

window.removeModFromPack = async (pid, filename, pIdx) => {
  window.customConfirm('Удалить этот мод из сборки?', async () => {
    if (filename && window.sakura && window.sakura.deletePackMod) {
      await window.sakura.deletePackMod(pid, filename);
    }
    const p = ST.packs.find(q=>q.id===pid);
    if (p && p.mods) {
      if (pIdx >= 0 && pIdx < p.mods.length) {
        p.mods.splice(pIdx, 1);
      } else if (filename) {
        p.mods = p.mods.filter(m => (m.filename || m.t) !== filename);
      }
      save();
    }
    window.openModpackDialog(pid);
    toast('Мод удалён');
  });
};

window.ST_ACCOUNTS = [];
window.ST_ACTIVE_ACC = null;

window.syncAccounts = async function(res) {
  if (!res && window.sakura && window.sakura.accountsList) res = await window.sakura.accountsList();
  if (res && res.ok) {
    window.ST_ACCOUNTS = res.list || [];
    window.ST_ACTIVE_ACC = res.active || null;
    ST.g = res.google ? true : false;
    ST.googleUser = res.google || null;
    if (res.google && res.google.name) ST.nick = res.google.name;
    const ely = window.ST_ACCOUNTS.find(a => a.type === "elyby");
    if (ely) ST.ely = ely.name; else ST.ely = "";
  }
  if (typeof save === "function") save();
  if (typeof accUI === "function") accUI();
  if (window.renderAccList) window.renderAccList();
};

window.renderAccList = function() {
  const list = document.getElementById('acc_list');
  if (list) {
    const ICONS = {
      microsoft: `<svg style="width:16px;height:16px;vertical-align:text-bottom;margin-right:4px;" viewBox="0 0 88 88"><path fill="currentColor" d="M0 12.4l35.7-4.9v34.4l-35.7.2zm35.7 33.5v33.9l-35.7-4.7V46.1zM39.9 7V48.4l48.1-.3V1zM88 53v42.8l-48.1-6.7V53.3z"/></svg>`,
      elyby: `<span style="font-weight:bold;margin-right:4px;color:#1890ff">Ely.by</span>`,
      offline: `<svg style="width:16px;height:16px;vertical-align:text-bottom;margin-right:4px;" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm0-13c-1.7 0-3 1.3-3 3s1.3 3 3 3 3-1.3 3-3-1.3-3-3-3zm0 5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm-4.5 4c-.3 0-.5.2-.5.5v1.5h10v-1.5c0-.3-.2-.5-.5-.5h-9z"/></svg>`
    };
    if (!window.ST_ACCOUNTS.length) {
      list.innerHTML = '<p class="sub">Нет добавленных аккаунтов</p>';
    } else {
      list.innerHTML = window.ST_ACCOUNTS.map((a) => `<div class="acc-card ${window.ST_ACTIVE_ACC === a.id ? 'active' : ''}" data-accid="${a.id}"><b>${a.name}</b> <small>${ICONS[a.type] || a.type}</small><button class="btn" data-rmacc="${a.id}" style="float:right;padding:2px 8px">X</button></div>`).join('');
    }
  }
  
  const active = window.ST_ACCOUNTS.find(a => a.id === window.ST_ACTIVE_ACC);
  const ICONS = {
    microsoft: `<svg style="width:16px;height:16px;vertical-align:text-bottom;margin-right:4px;" viewBox="0 0 88 88"><path fill="currentColor" d="M0 12.4l35.7-4.9v34.4l-35.7.2zm35.7 33.5v33.9l-35.7-4.7V46.1zM39.9 7V48.4l48.1-.3V1zM88 53v42.8l-48.1-6.7V53.3z"/></svg>`,
    elyby: `<span style="font-weight:bold;margin-right:4px;color:#1890ff">Ely.by</span>`,
    offline: `<svg style="width:16px;height:16px;vertical-align:text-bottom;margin-right:4px;" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm0-13c-1.7 0-3 1.3-3 3s1.3 3 3 3 3-1.3 3-3-1.3-3-3-3zm0 5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm-4.5 4c-.3 0-.5.2-.5.5v1.5h10v-1.5c0-.3-.2-.5-.5-.5h-9z"/></svg>`
  };

  const btn = document.getElementById('play_acc_btn');
  if (btn) {
    if (active) {
      btn.innerHTML = `<span style="display:inline-block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;">${ICONS[active.type] || active.type} ${active.name}</span>`;
    } else {
      btn.textContent = "Выбрать аккаунт...";
    }
  }

  // Update left rail user card & avatar
  const rAvatar = document.getElementById('rail_avatar');
  const rName = document.getElementById('rail_name');
  const rStatus = document.getElementById('rail_status');
  
  const gUser = ST.googleUser;
  if (gUser && gUser.name) {
    if (rName) rName.textContent = gUser.name;
    if (rStatus) rStatus.textContent = active ? `${active.name}` : 'Google подключён';
    if (rAvatar) {
      if (gUser.picture) {
        rAvatar.innerHTML = `<img src="${gUser.picture}" alt="Avatar">`;
      } else {
        rAvatar.textContent = gUser.name[0].toUpperCase();
      }
    }
  } else if (active) {
    if (rName) rName.textContent = active.name;
    if (rStatus) rStatus.textContent = active.type === 'elyby' ? 'Ely.by' : active.type === 'microsoft' ? 'Microsoft' : 'Оффлайн';
    if (rAvatar) rAvatar.textContent = active.name[0].toUpperCase();
  } else {
    if (rName) rName.textContent = "Гость";
    if (rStatus) rStatus.textContent = "Не выбран аккаунт";
    if (rAvatar) rAvatar.textContent = "G";
  }

  const ms = document.getElementById('ms');
  if (ms) ms.textContent = window.ST_ACCOUNTS.some(a => a.type === 'microsoft') ? 'Подключён аккаунт Microsoft' : 'Для игры нужен аккаунт Microsoft';
  const es = document.getElementById('es');
  if (es) es.textContent = window.ST_ACCOUNTS.some(a => a.type === 'elyby') ? 'Подключён аккаунт Ely.by' : 'Скин и вход через Ely.by';
  if (window.autoLoadSkin) window.autoLoadSkin();
};

window.renderPackSel = function() {
  const sel = document.getElementById('play_pack_sel');
  if (!sel) return;
  const current = sel.value;
  let opts = '<option value="">Без сборки (чистая игра)</option>';
  if (typeof ST !== 'undefined') {
    if (!ST.packs) ST.packs = [];
    ST.packs.forEach(p => {
      opts += `<option value="${p.id}">${esc(p.name)} (${p.v}, ${p.l})</option>`;
    });
  }
  sel.innerHTML = opts;
  const packToSelect = current || (ST && ST.lastPack) || '';
  if (ST && ST.packs && ST.packs.find(p => p.id === packToSelect)) sel.value = packToSelect;
  
  sel.onchange = (e) => {
    if (ST) { ST.lastPack = sel.value; save(); }
    const mtarget = document.getElementById("mtarget");
    if (mtarget && sel.value) {
      if ([...mtarget.options].some(o => o.value === sel.value)) mtarget.value = sel.value;
    }
    const isPack = !!sel.value;
    const vLab = document.querySelector('label[for="ver"]');
    const vSel = document.getElementById('ver');
    if (vLab) vLab.style.display = isPack ? 'none' : 'block';
    if (vSel) {
      vSel.style.display = isPack ? 'none' : 'block';
      vSel.disabled = isPack;
      if (isPack && ST && ST.packs) {
        const p = ST.packs.find(q => q.id === sel.value);
        if (p) {
          const packVal = `${p.v}|${p.l}`;
          if (Array.from(vSel.options).some(o => o.value === packVal)) vSel.value = packVal;
        }
      }
    }
  };
  sel.onchange();
};

window.autoLoadSkin = async () => {
  if (ST.skinData && ST.skinName && ST.skinName !== 'Ely.by') return;
  const acc = window.ST_ACCOUNTS.find(a => a.id === window.ST_ACTIVE_ACC);
  const n = acc ? acc.name : (ST.nick || "");
  if (!n) return;
  const url = "https://skinsystem.ely.by/skins/" + encodeURIComponent(n) + ".png";
  try {
    const im = await new Promise((res, rej) => {
      const i = new Image(); i.crossOrigin="anonymous";
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    window.useImage(im, n, 'Ely.by');
    try { ST.skinData = tc.toDataURL('image/png'); ST.skinName = n; save(); } catch(e){}
  } catch(e) { console.error("Skin load error:", e); }
};

if (document.getElementById('play_acc_btn')) {
  document.getElementById('play_acc_btn').onclick = () => {
    window.syncAccounts();
    document.getElementById('acc_dlg').showModal();
  };
}

if (document.getElementById('acc_list')) {
  document.getElementById('acc_list').onclick = async (e) => {
    const rm = e.target.closest('[data-rmacc]');
    if (rm) {
      const id = rm.dataset.rmacc;
      window.uiConfirm('Удалить этот аккаунт?', async () => {
        const res = await window.sakura.accountsRemove(id);
        window.syncAccounts(res);
      });
      return;
    }
    const card = e.target.closest('.acc-card');
    if (card) {
      const id = card.dataset.accid;
      const res = await window.sakura.accountsSelect(id);
      window.syncAccounts(res);
      document.getElementById('acc_dlg').close();
    }
  };
}

window.doAuthMs = async () => {
  toast("Вход через Microsoft...");
  try {
    const res = await window.sakura.accountsAddMicrosoft();
    if (res.ok) {
      toast("Успешный вход!");
      window.syncAccounts(res);
    } else {
      toast("Ошибка входа: " + res.error);
    }
  } catch(e) { toast("Ошибка: " + e.message); }
};

window.doAuthElyPrompt = () => {
  document.getElementById('eyn').value='';
  document.getElementById('eye').textContent='';
  document.getElementById('eya').hidden=false;
  document.getElementById('eyr').hidden=true;
  document.getElementById('elyp').showModal();
  document.getElementById('eyn').focus();
};

window.doAuthElyFinish = async () => {
  const v = document.getElementById('eyn').value.trim();
  const pwd = document.getElementById('eyp').value;
  if (!v || !pwd) { document.getElementById('eye').textContent = "Введите логин и пароль"; return; }
  document.getElementById('eya').hidden = true; document.getElementById('eyr').hidden = false;
  try {
    const res = await window.sakura.accountsAddElyby(v, pwd);
    if (res.ok) {
      document.getElementById('elyp').close();
      toast("Ely.by подключён!");
      window.syncAccounts(res);
    } else {
      document.getElementById('eya').hidden = false; document.getElementById('eyr').hidden = true;
      document.getElementById('eye').textContent = "Ошибка: " + res.error;
    }
  } catch(e) { 
    document.getElementById('eya').hidden = false; document.getElementById('eyr').hidden = true;
    document.getElementById('eye').textContent = "Ошибка: " + e.message; 
  }
};

window.doAuthOff = async () => {
  document.getElementById('offn').value = '';
  document.getElementById('offp').showModal();
  document.getElementById('offn').focus();
};

window.doAuthOffFinish = async () => {
  const v = document.getElementById('offn').value.trim();
  if (!v) return;
  try {
    const res = await window.sakura.accountsAddOffline(v);
    if (res.ok) {
      toast("Оффлайн аккаунт создан!");
      document.getElementById('offp').close();
      window.syncAccounts(res);
    } else {
      toast("Ошибка: " + res.error);
    }
  } catch(e) { toast("Ошибка: " + e.message); }
};

if (document.getElementById('dlg_add_off')) document.getElementById('dlg_add_off').onclick = window.doAuthOff;
if (document.getElementById('dlg_add_ms')) document.getElementById('dlg_add_ms').onclick = window.doAuthMs;
if (document.getElementById('dlg_add_ely')) document.getElementById('dlg_add_ely').onclick = window.doAuthElyPrompt;

let activePackId = null;

document.getElementById('pack_tab_settings').onclick = (e) => {
  document.getElementById('pack_tab_settings').classList.add('act');
  document.getElementById('pack_tab_mods').classList.remove('act');
  document.getElementById('pack_settings_view').hidden = false;
  document.getElementById('pack_mods_view').hidden = true;
};
document.getElementById('pack_tab_mods').onclick = (e) => {
  document.getElementById('pack_tab_mods').classList.add('act');
  document.getElementById('pack_tab_settings').classList.remove('act');
  document.getElementById('pack_settings_view').hidden = true;
  document.getElementById('pack_mods_view').hidden = false;
};
window.openPackFolder = () => {
  if (window.activePackId && window.sakura && window.sakura.openGameFolder) {
    window.sakura.openGameFolder('instances/' + window.activePackId);
  } else {
    toast('Папка пока не создана на диске');
  }
};

window.cloneActivePack = () => {
  const p = ST.packs.find(q => q.id === window.activePackId);
  if (!p) return;
  const clone = {
    ...p,
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: p.name + ' (Копия)',
    mods: p.mods ? p.mods.map(m => ({ ...m })) : []
  };
  ST.packs.push(clone);
  save();
  if (window.rMine) window.rMine();
  toast('Сборка успешно клонирована!');
};

window.customConfirm = (msg, onOk) => {
  const dlg = document.getElementById('confirm_dlg');
  if (!dlg) { if (confirm(msg)) onOk(); return; }
  document.getElementById('confirm_msg').textContent = msg;
  document.getElementById('confirm_ok').onclick = () => { dlg.close(); onOk(); };
  dlg.showModal();
};

const expBtn = document.getElementById('pack_export_btn');
if (expBtn) {
  expBtn.onclick = () => {
    const p = ST.packs.find(q => q.id === window.activePackId);
    if (p && window.expPack) window.expPack(p);
    else toast('Сборка не найдена');
  };
}

const delBtn = document.getElementById('pack_delete_btn');
if (delBtn) {
  delBtn.onclick = () => {
    window.customConfirm('Удалить эту сборку модов навсегда?', async () => {
      const pid = window.activePackId;
      if (pid && window.sakura && window.sakura.deleteInstance) {
        await window.sakura.deleteInstance(pid);
      }
      ST.packs = ST.packs.filter(q => q.id !== pid);
      save();
      if (window.rMine) window.rMine();
      if (window.renderPackSel) window.renderPackSel();
      document.querySelector('[data-p="mods"]').click();
      toast('Сборка удалена');
    });
  };
}

const ea = document.getElementById('elyAuth');
if (ea) {
  ea.checked = !!ST.elyAuth;
  ea.onchange = () => { ST.elyAuth = ea.checked; save(); };
}

window.syncInstancesFromDisk = async function() {
  if (window.sakura && window.sakura.instancesList) {
    try {
      const diskList = await window.sakura.instancesList();
      if (Array.isArray(diskList) && diskList.length > 0) {
        if (!ST.packs) ST.packs = [];
        diskList.forEach(dp => {
          const existing = ST.packs.find(p => p.id === dp.id);
          if (!existing) {
            ST.packs.push({
              id: dp.id,
              name: dp.name,
              desc: dp.desc,
              v: dp.v,
              l: dp.l,
              mods: dp.mods || [],
              pub: false,
              ts: dp.createdAt || Date.now(),
              createdOnDisk: true
            });
          }
        });
        save();
        if (window.renderPackSel) window.renderPackSel();
        if (typeof rMine === 'function' && typeof mtab !== 'undefined' && mtab === 'mine') rMine();
      }
    } catch(e) {}
  }
};

window.showUpdateModal = function(info) {
  if (!info || !info.hasUpdate) return;
  const dlg = document.getElementById('update_dlg');
  if (!dlg) return;
  const t = document.getElementById('upd_title');
  if (t) t.textContent = info.title || 'Доступно обновление!';
  const v = document.getElementById('upd_version');
  if (v) v.textContent = `Новая версия: v${info.latestVersion} (у вас: v${info.currentVersion})`;
  const cl = document.getElementById('upd_changelog');
  if (cl) cl.textContent = info.changelog || 'Улучшения производительности и исправление ошибок.';

  const laterBtn = document.getElementById('upd_later_btn');
  if (laterBtn) {
    laterBtn.style.display = info.mandatory ? 'none' : 'inline-block';
    laterBtn.onclick = () => dlg.close();
  }

  const actionBtn = document.getElementById('upd_action_btn');
  if (actionBtn) {
    actionBtn.onclick = () => {
      if (info.downloadUrl && window.sakura && window.sakura.openUpdateUrl) {
        window.sakura.openUpdateUrl(info.downloadUrl);
      } else if (info.downloadUrl && window.sakura && window.sakura.openExternal) {
        window.sakura.openExternal(info.downloadUrl);
      }
      if (!info.mandatory) dlg.close();
    };
  }

  try { dlg.showModal(); } catch(e){}
};

if (window.sakura && window.sakura.onUpdateAvailable) {
  window.sakura.onUpdateAvailable((info) => {
    window.showUpdateModal(info);
  });
}

window.checkForLauncherUpdate = async function() {
  const btn = document.getElementById('btn_check_update_logs');
  const statusLbl = document.getElementById('logs_upd_status');
  if (btn) btn.disabled = true;
  if (statusLbl) statusLbl.textContent = 'Проверка обновлений на GitHub...';
  toast('Проверяем обновления на GitHub...');
  try {
    if (window.sakura && window.sakura.checkForUpdates) {
      const res = await window.sakura.checkForUpdates();
      if (res && res.hasUpdate) {
        if (statusLbl) {
          statusLbl.innerHTML = `<b style="color:#ff75b5">Доступно обновление v${res.latestVersion}!</b>`;
        }
        window.showUpdateModal(res);
      } else {
        if (statusLbl) {
          statusLbl.textContent = `У вас актуальная версия (v${res ? res.currentVersion : '0.2.0'})`;
        }
        toast('У вас установлена последняя версия лаунчера!');
      }
    }
  } catch(e) {
    if (statusLbl) statusLbl.textContent = 'Ошибка проверки обновлений';
    toast('Не удалось связаться с сервером обновлений');
  } finally {
    if (btn) btn.disabled = false;
  }
};

const checkUpdBtn = document.getElementById('check_upd_btn');
if (checkUpdBtn) {
  checkUpdBtn.onclick = () => window.checkForLauncherUpdate();
}

if (window.sakura && window.sakura.getVersion) {
  window.sakura.getVersion().then((v) => {
    const lbl = document.getElementById('app_ver_txt');
    if (lbl) lbl.textContent = `Sakura Launcher v${v}`;
    const logsUpdLbl = document.getElementById("logs_upd_status");
    if (logsUpdLbl) logsUpdLbl.textContent = `Версия v${v}`;
  }).catch(() => {});
}

setTimeout(async () => { await window.syncAccounts(); if (window.syncInstancesFromDisk) await window.syncInstancesFromDisk(); window.renderPackSel(); if (window.initSkin) window.initSkin(); else window.autoLoadSkin(); }, 500);
window.avail = () => true;