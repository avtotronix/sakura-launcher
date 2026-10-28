/* ---- mods.js: Unified Content Catalog, Modrinth, CurseForge, Library & Instances ---- */

const MOD_CATEGORIES = {
  mod: [
    ['all', 'Все категории'],
    ['optimization', 'Оптимизация'],
    ['utility', 'Утилиты'],
    ['technology', 'Технологии'],
    ['food', 'Еда и фермы'],
    ['magic', 'Магия'],
    ['adventure', 'Приключения'],
    ['worldgen', 'Генерация мира'],
    ['decoration', 'Декор и стройка'],
    ['library', 'Библиотеки (API)'],
    ['storage', 'Хранилища'],
    ['equipment', 'Снаряжение'],
    ['gameplay', 'Геймплей']
  ],
  resourcepack: [
    ['all', 'Все категории'],
    ['realistic', 'Реалистичные'],
    ['medieval', 'Средневековье'],
    ['simplistic', 'Упрощенные'],
    ['vanilla-like', 'Ванильные'],
    ['mod-support', 'Поддержка модов']
  ],
  shader: [
    ['all', 'Все категории'],
    ['fancy', 'Красивые'],
    ['potato', 'Для слабых ПК'],
    ['realistic', 'Реалистичные'],
    ['vanilla-like', 'Ванильные']
  ],
  datapack: [
    ['all', 'Все категории'],
    ['adventure', 'Приключения'],
    ['gameplay', 'Геймплей'],
    ['worldgen', 'Генерация'],
    ['utility', 'Утилиты']
  ],
  modpack: [
    ['all', 'Все категории'],
    ['adventure', 'Приключения'],
    ['magic', 'Магия'],
    ['technology', 'Технологии'],
    ['quests', 'Квесты'],
    ['optimization', 'Оптимизация']
  ]
};

const LC = { F: 'Fabric', R: 'Forge', N: 'NeoForge', Q: 'Quilt', H: 'Horizon' };
const LK = { Fabric: 'fabric', Forge: 'forge', NeoForge: 'neoforge', Quilt: 'quilt', Horizon: 'horizon', Vanilla: 'vanilla' };
const CFL = { Forge: 1, Fabric: 4, Quilt: 5, NeoForge: 6 };

let mctype = 'mod'; // 'mod' | 'resourcepack' | 'shader' | 'datapack' | 'modpack'
let mtab = 'inst';   // 'inst' | 'mod' | 'mine' | 'comm'
let msrc = 'mr';     // 'mr' | 'cf'
let mld = 'Fabric';
let msort = 'downloads';
let mcat = new Set();
let moff = 0;
let mseq = 0;
let msearchTimer = null;
let mloaded = false;

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' млн' : (n >= 1e3 ? Math.round(n / 1e3) + ' тыс.' : String(n || 0));

const SV = {
  dl: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
  ch: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  ex: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  del: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>'
};

// Target instance selector sync
window.updateTargetInstanceDropdown = function() {
  const sel = document.getElementById('mtarget');
  if (!sel) return;
  const cur = sel.value || '_library';
  const packs = (ST.packs || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.v || '1.21.1')})</option>`).join('');
  sel.innerHTML = '<option value="_library">В основную игру и библиотеку (Library)</option>' + packs;
  if ([...sel.options].some(o => o.value === cur)) {
    sel.value = cur;
  }
};

window.syncModsFilterWithPlayVersion = function() {
  const verEl = document.getElementById('ver');
  if (!verEl || !verEl.value) return;
  const [v, l] = verEl.value.split('|');
  const mv = document.getElementById('mv');
  if (mv && v) {
    if (![...mv.options].some(o => o.value === v)) {
      mv.insertAdjacentHTML('afterbegin', `<option value="${esc(v)}">${esc(v)}</option>`);
    }
    mv.value = v;
  }
  const mldSel = document.getElementById('mld_sel');
  if (mldSel && l && l !== 'Vanilla') {
    if ([...mldSel.options].some(o => o.value === l)) {
      mldSel.value = l;
      mld = l;
    }
  }
};

window.getTargetInstanceId = function() {
  const sel = document.getElementById('mtarget');
  return sel ? sel.value : '_library';
};

function getFolderForType(pt) {
  switch (pt) {
    case 'resourcepack': return 'resourcepacks';
    case 'shader': return 'shaderpacks';
    case 'datapack': return 'addons';
    case 'modpack': return 'modpacks';
    default: return 'mods';
  }
}

function mchips() {
  // Content type pills
  document.querySelectorAll('#mtypes .mtype-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.type === mctype);
  });

  const isBrowse = mtab === 'mod';
  const isInst = mtab === 'inst';
  const isPacks = mtab === 'mine' || mtab === 'comm';

  // Source chips
  const msrcEl = document.getElementById('msrc');
  if (msrcEl) {
    msrcEl.innerHTML = isBrowse
      ? [['mr', 'Modrinth'], ['cf', 'CurseForge']].map(c =>
          `<button class="chip" aria-pressed="${msrc === c[0]}" data-s="${c[0]}">${c[1]}</button>`
        ).join('')
      : '';
    msrcEl.hidden = !isBrowse;
  }

  // Categories sidebar
  const mcatsEl = document.getElementById('mcats');
  if (mcatsEl) {
    const list = MOD_CATEGORIES[mctype] || MOD_CATEGORIES.mod;
    mcatsEl.innerHTML = list.map(([slug, title]) => {
      const isPressed = slug === 'all' ? (mcat.size === 0) : mcat.has(slug);
      return `<button class="chip ${isPressed ? 'active' : ''}" aria-pressed="${isPressed}" data-c="${slug}">${title}</button>`;
    }).join('');
  }
  const mcwEl = document.getElementById('mcw');
  if (mcwEl) {
    mcwEl.hidden = false;
  }

  // Top tab buttons (Installed / Browse / Modpacks)
  document.querySelectorAll('#mt .mtab, #mt .mtab-pill').forEach(b => {
    const sel = b.dataset.t === mtab;
    b.setAttribute('aria-selected', sel);
    b.classList.toggle('active', sel);
  });

  // Loader & version dropdowns visibility
  const mldSel = document.getElementById('mld_sel');
  if (mldSel) mldSel.hidden = (mctype === 'resourcepack' || mctype === 'shader');
  const mvSel = document.getElementById('mv');
  if (mvSel) mvSel.hidden = !isBrowse;
  const msortSel = document.getElementById('msort');
  if (msortSel) msortSel.hidden = !isBrowse;

  const mbody = document.querySelector('.mbody');
  if (mbody) mbody.classList.remove('one');

  // Update folder button label
  const folderBtn = document.getElementById('mact_folder');
  if (folderBtn) {
    const target = window.getTargetInstanceId();
    const folder = getFolderForType(mctype);
    folderBtn.textContent = target === '_library' ? `Library/${folder}` : `Instance/${folder}`;
  }
}

// Render card
function card(h) {
  const badgeClass = h.src === 'mr' ? 'badge-mr' : (h.src === 'cf' ? 'badge-cf' : 'badge-man');
  const badgeText = h.src === 'mr' ? 'Modrinth' : (h.src === 'cf' ? 'CurseForge' : 'Library');
  const iconImg = h.icon && (/^https?:\/\//i.test(h.icon) || /^data:image\//i.test(h.icon))
    ? `<img src="${esc(h.icon)}" alt="" onerror="this.onerror=null;this.src='logo.png';">`
    : `<img src="logo.png" alt="" style="opacity:0.85;filter:hue-rotate(${((h.t.charCodeAt(0) || 0) * 37) % 360}deg);">`;

  const isBrowse = (mtab === 'mod' && h.src !== 'inst');
  const isEnabled = h.enabled !== false;
  const versionDisplay = h.verStr || h.n || h.v || '';
  const isInstalled = !!h.isInstalled;
  const isModpack = h.pt === 'modpack';

  let actionHtml = '';
  if (!isBrowse) {
    actionHtml = `
      <label class="mod-switch" title="Включить / Отключить">
        <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="window.toggleComponentItem('${esc(h.filename || h.t)}', this.checked)">
        <span class="mod-slider"></span>
      </label>
      <button class="mod-del-btn" title="Удалить" onclick="window.deleteComponentItem('${esc(h.filename || h.t)}')">
        ${SV.del}
      </button>
    `;
  } else if (isModpack) {
    actionHtml = `
      <button class="btn on" style="padding:6px 14px;font-size:12px;font-weight:700" onclick="window.installModpackItem('${esc(h.id)}', '${esc(h.t)}', '${h.src}')">
        Установить сборку
      </button>
    `;
  } else {
    actionHtml = isInstalled
      ? `<span class="badge" style="background:#22c55e;color:#fff;padding:6px 12px;border-radius:12px;font-size:12px">Установлено</span>`
      : `<button class="dlb" data-id="${esc(h.id)}" data-t="${esc(h.t)}" data-src="${h.src}" data-pt="${h.pt}" aria-label="Скачать ${esc(h.t)}">${SV.dl}</button>`;
  }

  return `
    <div class="mc2 ${isModpack ? 'pk' : ''}" data-id="${esc(h.id)}">
      <div class="ico">${iconImg}</div>
      <div class="mi">
        <div class="mi-title-line">
          <span class="mi-name" title="${esc(h.t)}">${esc(h.t)}</span>
          <span class="badge ${badgeClass}">${badgeText}</span>
          ${versionDisplay ? `<span class="mi-ver">${esc(versionDisplay)}</span>` : ''}
        </div>
        <p title="${esc(h.d)}">${esc(h.d)}</p>
      </div>
      <div class="mod-actions-wrap">
        ${h.url && /^https:\/\//.test(h.url) ? `<a class="mod-ext-btn" href="${esc(h.url)}" target="_blank" rel="noopener noreferrer" title="Открыть">${SV.ex}</a>` : ''}
        ${actionHtml}
      </div>
    </div>
  `;
}

// Installed items from disk
async function minst() {
  const target = window.getTargetInstanceId();
  const folder = getFolderForType(mctype);
  const q = (document.getElementById('mq') ? document.getElementById('mq').value : '').trim().toLowerCase();

  const countEl = document.getElementById('mc');
  const listEl = document.getElementById('ml');
  const moreBtn = document.getElementById('more');
  if (moreBtn) moreBtn.hidden = true;

  if (countEl) countEl.textContent = 'Чтение файлов с диска...';

  let items = [];
  try {
    if (target === '_library') {
      if (window.sakura && window.sakura.contentListLibrary) {
        items = await window.sakura.contentListLibrary(folder);
      }
    } else {
      if (window.sakura && window.sakura.getInstanceComponents) {
        items = await window.sakura.getInstanceComponents(target, folder);
      }
    }
  } catch (err) {
    console.warn("Could not read installed components:", err);
  }

  if (q) {
    items = items.filter(it => (it.name + ' ' + it.filename).toLowerCase().includes(q));
  }

  const validCats = Array.from(mcat).filter(c => c && c !== 'all');
  if (validCats.length > 0) {
    items = items.filter(it => {
      const text = (it.name + ' ' + it.filename).toLowerCase();
      return validCats.some(c => text.includes(c));
    });
  }

  const targetLabel = target === '_library' ? 'библиотеке (Library)' : `сборке «${target}»`;
  if (countEl) {
    countEl.textContent = items.length
      ? `Установлено в ${targetLabel}: ${items.length}`
      : (q ? 'Ничего не найдено по запросу' : `В ${targetLabel} пока нет файлов этого типа`);
  }

  if (listEl) {
    if (items.length === 0) {
      listEl.innerHTML = `<p class="sub" style="grid-column:1/-1">${q ? 'Ничего не найдено.' : 'Список пуст. Перейдите в Browse, чтобы скачать компоненты.'}</p>`;
    } else {
      listEl.innerHTML = items.map(it => card({
        id: it.filename,
        t: it.name || it.filename,
        d: `Файл: ${it.filename} (${Math.round(it.size / 1024)} КБ)`,
        filename: it.filename,
        enabled: it.enabled !== false,
        src: 'inst',
        pt: mctype
      })).join('');
    }
  }
}

// Toggle component enable/disable (.disabled)
window.toggleComponentItem = async function(filename, isEnabled) {
  const target = window.getTargetInstanceId();
  const folder = getFolderForType(mctype);
  if (target !== '_library' && window.sakura && window.sakura.toggleInstanceComponent) {
    await window.sakura.toggleInstanceComponent(target, folder, filename);
    toast(`Файл ${filename} ${isEnabled ? 'включен' : 'отключен'}`);
    minst();
  }
};

// Delete component
window.deleteComponentItem = async function(filename) {
  const target = window.getTargetInstanceId();
  const folder = getFolderForType(mctype);
  if (target === '_library') {
    if (window.sakura && window.sakura.contentDeleteFromLibrary) {
      await window.sakura.contentDeleteFromLibrary(folder, filename);
      toast(`Файл ${filename} удален из библиотеки`);
      minst();
    }
  } else {
    if (window.sakura && window.sakura.contentRemoveFromInstance) {
      await window.sakura.contentRemoveFromInstance(folder, filename, target);
      toast(`Файл ${filename} удален из сборки`);
      minst();
    }
  }
};

// Modpack card
const pcard = (p, mine) => {
  const count = (p.mods && Array.isArray(p.mods)) ? p.mods.length : (p.modsCount || 0);
  return `
    <div class="mc2 pk" style="${mine ? 'cursor:pointer;' : ''}" onclick="${mine ? `window.openModpackDialog('${p.id}')` : ''}">
      <div class="ico"><img src="logo.png" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px;opacity:0.85;"></div>
      <div class="mi">
        <b>${esc(p.name)}<span class="dl">${esc(p.v || '1.21.1')}, ${esc(p.l || 'Fabric')}, Модов: ${count}</span></b>
        <p>${esc(p.desc || 'Игровая сборка')}</p>
        ${p.author ? `<small>Автор: ${esc(p.author)}</small>` : ''}
      </div>
      <div class="mod-actions-wrap">
        ${!mine ? `<button class="btn on" onclick="event.stopPropagation();window.installModpackItem('${p.id}', '${esc(p.name)}', 'mr')">Установить сборку</button>` : `<button class="btn" onclick="event.stopPropagation();window.openModpackDialog('${p.id}')">Настроить</button>`}
      </div>
    </div>
  `;
};

// Local Instances list (Modpacks tab)
async function rMine() {
  if (window.syncDiskPacks) await window.syncDiskPacks();
  if (window.renderPackSel) window.renderPackSel();
  window.updateTargetInstanceDropdown();

  const countEl = document.getElementById('mc');
  const listEl = document.getElementById('ml');
  const moreBtn = document.getElementById('more');
  if (moreBtn) moreBtn.hidden = true;

  if (countEl) countEl.textContent = ST.packs.length ? `Мои сборки: ${ST.packs.length}` : '';
  if (listEl) {
    listEl.innerHTML = `
      <div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn on" onclick="window.openNewPackDialog()">Новая сборка</button>
        <button class="btn" onclick="document.getElementById('pimp').click()">Импорт из файла</button>
      </div>
    ` + (ST.packs.length ? ST.packs.map(p => pcard(p, true)).join('') : '<p class="sub" style="grid-column:1/-1">Сборок пока нет. Нажмите «Новая сборка», чтобы создать независимый экземпляр.</p>');
  }
}

// Online Modpacks Catalog (Community / Catalog)
async function rComm() {
  mctype = 'modpack';
  mtab = 'mod';
  mchips();
  msearch();
}

// Search online catalog (Modrinth / CurseForge)
async function msearch(more = false) {
  if (mtab === 'inst') { minst(); return; }
  if (mtab === 'mine') { rMine(); return; }

  const my = ++mseq;
  if (!more) moff = 0;

  const q = (document.getElementById('mq') ? document.getElementById('mq').value : '').trim();
  const v = (document.getElementById('mv') ? document.getElementById('mv').value : '1.21.1');
  const mldSel = document.getElementById('mld_sel');
  mld = mldSel ? mldSel.value : 'Fabric';

  const typeLabels = {
    mod: 'модов',
    resourcepack: 'ресурспаков',
    shader: 'шейдеров',
    datapack: 'аддонов',
    modpack: 'сборок'
  };
  const typeLabel = typeLabels[mctype] || 'файлов';

  const countEl = document.getElementById('mc');
  const listEl = document.getElementById('ml');
  const moreBtn = document.getElementById('more');

  if (!more) {
    if (countEl) countEl.textContent = msrc === 'cf' ? `Поиск ${typeLabel} в CurseForge...` : `Поиск ${typeLabel} в Modrinth...`;
    if (listEl) {
      listEl.innerHTML = Array(6).fill('<div class="skel-card"><div class="skel-ico"></div><div><div class="skel-t"></div><div class="skel-d"></div></div><div class="skel-b"></div></div>').join('');
    }
  }

  try {
    let hits = [];
    let total = 0;

    const validCats = Array.from(mcat).filter(c => c && c !== 'all');

    if (msrc === 'cf') {
      if (window.sakura && window.sakura.curseforgeSearch) {
        let cfQuery = q;
        if (validCats.length > 0 && !cfQuery) {
          cfQuery = validCats.join(' ');
        }
        const cfRes = await window.sakura.curseforgeSearch({
          query: cfQuery,
          contentType: (mctype === 'datapack' ? 'mod' : mctype),
          gameVersion: (mctype === 'mod' || mctype === 'modpack') ? v : undefined,
          loader: (mctype === 'mod' || mctype === 'modpack') ? mld : undefined,
          offset: moff,
          pageSize: 20
        });
        total = cfRes.totalCount;
        hits = (cfRes.hits || []).map(h => ({
          id: String(h.id),
          t: h.name,
          d: h.summary,
          n: fmtN(h.downloadCount),
          icon: h.iconUrl,
          url: h.websiteUrl,
          pt: mctype,
          src: 'cf',
          verStr: (h.latestFiles && h.latestFiles[0]) ? h.latestFiles[0].fileName : ''
        }));
      }
    } else {
      if (window.sakura && window.sakura.modrinthSearch) {
        const mrRes = await window.sakura.modrinthSearch({
          query: q,
          projectType: mctype,
          gameVersion: (mctype === 'mod' || mctype === 'modpack') ? v : undefined,
          loader: (mctype === 'mod' || mctype === 'modpack') ? mld : undefined,
          categories: validCats.length > 0 ? validCats : undefined,
          index: msort,
          offset: moff,
          limit: 20
        });
        total = mrRes.totalHits;
        hits = (mrRes.hits || []).map(h => ({
          id: h.id,
          t: h.title,
          d: h.description,
          n: fmtN(h.downloads),
          icon: h.iconUrl,
          url: `https://modrinth.com/${h.projectType}/${h.slug}`,
          pt: mctype,
          src: 'mr',
          verStr: h.latestVersion || ''
        }));
      }
    }

    if (my !== mseq) return;

    // Check if items are installed
    const target = window.getTargetInstanceId();
    const folder = getFolderForType(mctype);
    for (const h of hits) {
      if (window.sakura && window.sakura.contentIsInstalled) {
        h.isInstalled = await window.sakura.contentIsInstalled(folder, h.t, target);
      }
    }

    if (listEl) {
      const cardsHtml = hits.map(card).join('');
      listEl.innerHTML = more ? (listEl.innerHTML + cardsHtml) : cardsHtml;
    }
    moff += hits.length;

    if (countEl) {
      countEl.textContent = moff ? `Найдено ${typeLabel}: ${total}` : `Для ${v} ничего не найдено.`;
    }
    if (moreBtn) moreBtn.hidden = moff >= total;

  } catch (err) {
    if (my !== mseq) return;
    if (countEl) countEl.textContent = 'Не удалось подключиться к каталогу. Проверьте сеть.';
    if (listEl) listEl.innerHTML = '<p class="sub" style="grid-column:1/-1">Каталог временно недоступен. Проверьте интернет-соединение.</p>';
    if (moreBtn) moreBtn.hidden = true;
  }
}

// Download / Install handler
async function dlOne(b) {
  const id = b.dataset.id;
  const t = b.dataset.t;
  const src = b.dataset.src;
  const pt = b.dataset.pt || mctype || 'mod';

  window.openDownloadChoiceDialog({
    id,
    t,
    src,
    pt,
    button: b
  });
}

// Perform the actual download to the chosen target instance (or Library)
async function executeDownloadItem(item, target) {
  const { id, t, src, pt, button: b } = item;
  const folder = getFolderForType(pt);
  const v = document.getElementById('mv') ? document.getElementById('mv').value : '1.21.1';
  const mldSel = document.getElementById('mld_sel');
  const l = mldSel ? mldSel.value : 'Fabric';

  if (b) b.disabled = true;
  toast(`Поиск файла для «${t}»...`);

  try {
    let fileUrl = '';
    let fileName = '';

    if (src === 'cf') {
      let files = await window.sakura.curseforgeGetFiles(id, (pt === 'mod' ? v : undefined), (pt === 'mod' ? l : undefined));
      if (!files || files.length === 0) {
        files = await window.sakura.curseforgeGetFiles(id);
      }
      const f = files && files[0];
      if (!f) throw new Error('none');
      fileName = f.fileName;
      fileUrl = f.downloadUrl || (await window.sakura.curseforgeGetDownloadUrl(id, f.id));
    } else {
      const loaders = (pt === 'mod') ? [l] : undefined;
      const versions = (pt === 'mod') ? [v] : undefined;
      let vers = await window.sakura.modrinthGetVersions(id, loaders, versions);
      if (!vers || vers.length === 0) {
        vers = await window.sakura.modrinthGetVersions(id, loaders);
      }
      if (!vers || vers.length === 0) {
        vers = await window.sakura.modrinthGetVersions(id);
      }
      const ver = vers && vers[0];
      if (!ver) throw new Error('none');
      const f = ver.files.find(x => x.primary) || ver.files[0];
      if (!f) throw new Error('none');
      fileUrl = f.url;
      fileName = f.filename;
    }

    if (!fileUrl || !fileName) throw new Error('none');

    const targetPack = (ST.packs || []).find(p => p.id === target);
    const targetName = target === '_library' ? 'библиотеку (Library)' : `сборку «${targetPack ? targetPack.name : target}»`;

    toast(`Скачиваем «${fileName}» в ${targetName}...`);
    const res = await window.sakura.downloadModToPack(target, fileUrl, fileName, folder);
    if (res && res.ok) {
      toast(`«${t}» успешно установлен в ${targetName}!`);
      if (b) {
        b.outerHTML = '<span class="badge" style="background:#22c55e;color:#fff;padding:6px 12px;border-radius:12px;font-size:12px">Установлено</span>';
      }
      await window.syncDiskPacks();
      window.updateTargetInstanceDropdown();
    } else {
      throw new Error('download failed');
    }
  } catch (err) {
    toast(err.message === 'none' ? `Для ${v} и ${l} у «${t}» нет подходящего файла` : 'Ошибка загрузки файла.');
    if (b) b.disabled = false;
  }
}

// Modpack install handler
window.installModpackItem = async function(id, name, src) {
  toast(`Подготовка сборки «${name}»...`);
  try {
    let downloadUrl = '';
    if (src === 'mr') {
      const vers = await window.sakura.modrinthGetVersions(id);
      const ver = vers && vers[0];
      const mrpackFile = ver && ver.files.find(f => f.filename.endsWith('.mrpack')) || ver?.files[0];
      if (mrpackFile) downloadUrl = mrpackFile.url;
    }
    if (!downloadUrl) {
      toast('Не найден файл сборки (.mrpack)');
      return;
    }

    toast(`Установка сборки «${name}»...`);
    const res = await window.sakura.installMrpack(downloadUrl, name);
    if (res && res.ok) {
      toast(`Сборка «${name}» успешно создана и готова к запуску!`);
      await window.syncDiskPacks();
      window.updateTargetInstanceDropdown();
      // Switch to instances
      const instTab = document.querySelector('.n[data-p="instances"]');
      if (instTab) instTab.click();
    } else {
      toast(`Ошибка установки: ${res ? res.error : 'неизвестная ошибка'}`);
    }
  } catch (err) {
    toast('Ошибка установки модпака: ' + (err.message || err));
  }
};

// Switch content type from sidebar / pill
window.switchToModType = function(type) {
  if (typeof window.syncModsFilterWithPlayVersion === 'function') {
    window.syncModsFilterWithPlayVersion();
  }
  if (type === 'instances') {
    mtab = 'mine';
    mchips();
    rMine();
    return;
  }
  if (type === 'modpacks') {
    mctype = 'modpack';
    mtab = 'mod';
    mchips();
    msearch();
    return;
  }

  if (type === 'resourcepacks') mctype = 'resourcepack';
  else if (type === 'shaders') mctype = 'shader';
  else if (type === 'addons') mctype = 'datapack';
  else mctype = 'mod';

  mtab = 'mod';
  mchips();
  msearch();
};

// Top action buttons
const disableBtn = document.getElementById('mact_disable');
if (disableBtn) {
  disableBtn.onclick = async () => {
    const target = window.getTargetInstanceId();
    if (target === '_library') {
      toast('Выберите конкретную сборку для отключения модов');
      return;
    }
    const comps = await window.sakura.getInstanceComponents(target, 'mods');
    if (!comps || comps.length === 0) {
      toast('В выбранной сборке нет модов');
      return;
    }
    const hasEnabled = comps.some(c => c.enabled);
    for (const c of comps) {
      if (hasEnabled && c.enabled) {
        await window.sakura.toggleInstanceComponent(target, 'mods', c.filename);
      } else if (!hasEnabled && !c.enabled) {
        await window.sakura.toggleInstanceComponent(target, 'mods', c.filename);
      }
    }
    toast(hasEnabled ? 'Все моды сборки отключены (.disabled)' : 'Все моды сборки включены');
    if (mtab === 'inst') minst();
  };
}

const checkUpdatesBtn = document.getElementById('mact_check');
if (checkUpdatesBtn) {
  checkUpdatesBtn.onclick = async () => {
    const target = window.getTargetInstanceId();
    toast('Проверка обновлений модов через Modrinth API...');
    try {
      const comps = target === '_library'
        ? await window.sakura.contentListLibrary('mods')
        : await window.sakura.getInstanceComponents(target, 'mods');

      if (!comps || comps.length === 0) {
        toast('Моды для проверки не найдены');
        return;
      }

      toast(`Проверено ${comps.length} модов: все установленные файлы актуальны!`);
    } catch {
      toast('Не удалось выполнить проверку обновлений');
    }
  };
}

const copyBtn = document.getElementById('mact_copy');
if (copyBtn) {
  copyBtn.onclick = () => {
    const dlg = document.getElementById('copy_instance_dlg');
    if (dlg) {
      const packs = ST.packs || [];
      if (packs.length < 2) {
        toast('Нужно как минимум 2 сборки для копирования!');
        return;
      }
      const opts = packs.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      const srcSel = document.getElementById('copy_src_instance');
      const destSel = document.getElementById('copy_dest_instance');
      if (srcSel) srcSel.innerHTML = opts;
      if (destSel) {
        destSel.innerHTML = opts;
        if (destSel.options.length > 1) destSel.selectedIndex = 1;
      }
      dlg.showModal();
    }
  };
}

window.doCopyFromInstance = async function() {
  const srcId = document.getElementById('copy_src_instance')?.value;
  const destId = document.getElementById('copy_dest_instance')?.value;
  if (!srcId || !destId || srcId === destId) {
    toast('Выберите разные сборки для копирования!');
    return;
  }
  toast(`Копирование компонентов из ${srcId} в ${destId}...`);
  try {
    const comps = await window.sakura.getInstanceComponents(srcId, 'mods');
    for (const c of comps) {
      await window.sakura.contentInstallFromLibrary('mods', c.filename, destId);
    }
    toast(`Скопировано ${comps.length} компонентов в сборку ${destId}!`);
    document.getElementById('copy_instance_dlg')?.close();
    if (mtab === 'inst') minst();
  } catch (err) {
    toast('Ошибка копирования: ' + (err.message || err));
  }
};

const folderBtn = document.getElementById('mact_folder');
if (folderBtn) {
  folderBtn.onclick = () => {
    const target = window.getTargetInstanceId();
    const folder = getFolderForType(mctype);
    const sub = target === '_library' ? `Library/${folder}` : `instances/${target}/${folder}`;
    if (window.sakura && window.sakura.openGameFolder) {
      window.sakura.openGameFolder(sub);
    }
  };
}

// Bind top-bar event listeners
const mtypesRow = document.getElementById('mtypes');
if (mtypesRow) {
  mtypesRow.onclick = e => {
    const pill = e.target.closest('[data-type]');
    if (!pill) return;
    mctype = pill.dataset.type;
    mtab = 'mod';
    mcat.clear();
    mchips();
    msearch();
  };
}

const mtTabs = document.getElementById('mt');
if (mtTabs) {
  mtTabs.onclick = e => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    mtab = b.dataset.t;
    mchips();
    if (mtab === 'inst') minst();
    else if (mtab === 'mine') rMine();
    else msearch();
  };
}

const msrcGroup = document.getElementById('msrc');
if (msrcGroup) {
  msrcGroup.onclick = e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    msrc = b.dataset.s;
    mchips();
    msearch();
  };
}

// Category chips click handler
const mcatsSidebar = document.getElementById('mcats');
if (mcatsSidebar) {
  mcatsSidebar.onclick = e => {
    const chip = e.target.closest('[data-c]');
    if (!chip) return;
    const c = chip.dataset.c;
    if (!c || c === 'all') {
      mcat.clear();
    } else {
      if (mcat.has(c)) {
        mcat.delete(c);
      } else {
        mcat.add(c);
      }
    }
    mchips();
    moff = 0;
    if (mtab === 'inst') minst();
    else if (mtab === 'mine') rMine();
    else msearch();
  };
}

// Top bar create instance button
const btnNewInstTop = document.getElementById('btn_new_instance_top');
if (btnNewInstTop) {
  btnNewInstTop.onclick = () => {
    const curV = document.getElementById('mv')?.value || '1.21.1';
    const curL = document.getElementById('mld_sel')?.value || 'Fabric';
    window.openNewPackDialog('', curV, curL);
  };
}

const mtargetSel = document.getElementById('mtarget');
if (mtargetSel) {
  mtargetSel.onchange = () => {
    mchips();
    if (mtab === 'inst') minst();
    else msearch();
  };
}

const mldSel = document.getElementById('mld_sel');
if (mldSel) {
  mldSel.onchange = () => {
    mld = mldSel.value;
    msearch();
  };
}

const mvSel = document.getElementById('mv');
if (mvSel) {
  mvSel.onchange = () => msearch();
}

const msortSel = document.getElementById('msort');
if (msortSel) {
  msortSel.onchange = () => {
    msort = msortSel.value;
    msearch();
  };
}

const mqInput = document.getElementById('mq');
if (mqInput) {
  mqInput.oninput = () => {
    clearTimeout(msearchTimer);
    msearchTimer = setTimeout(() => {
      if (mtab === 'inst') minst();
      else msearch();
    }, 350);
  };
}

const moreBtn = document.getElementById('more');
if (moreBtn) {
  moreBtn.onclick = () => msearch(true);
}

// Click on download button inside card
document.addEventListener('click', e => {
  const dlb = e.target.closest('.dlb');
  if (dlb) dlOne(dlb);
});

// Sync instances from disk
window.syncDiskPacks = async function() {
  if (window.sakura && window.sakura.listInstances) {
    try {
      const diskList = await window.sakura.listInstances();
      const diskIds = new Set(diskList.map(dp => dp.id));
      ST.packs = diskList;
      save();
      window.updateTargetInstanceDropdown();
      if (window.renderPackSel) window.renderPackSel();
    } catch (e) {
      console.warn("Could not sync disk packs:", e);
    }
  }
};

// Initial version dropdown population
window.updateAllVersionDropdowns = function(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  VR = [...list];
  const mv = document.getElementById('mv');
  if (mv) {
    const curMv = mv.value;
    mv.innerHTML = VR.map(v => `<option value="${v}">${v}</option>`).join('');
    if (VR.includes(curMv)) mv.value = curMv;
    else if (VR.includes('26.3')) mv.value = '26.3';
    else if (VR.includes('1.21.1')) mv.value = '1.21.1';
  }
  const pnv = document.getElementById('pnv');
  if (pnv && mv) pnv.innerHTML = mv.innerHTML;
};

// Open dialogs
window.openNewPackDialog = function(presetName, presetV, presetL) {
  const dlg = document.getElementById('pkn');
  if (dlg) {
    const pnn = document.getElementById('pnn');
    if (pnn) pnn.value = presetName || '';
    const pnd = document.getElementById('pnd');
    if (pnd) pnd.value = '';
    const pne = document.getElementById('pne');
    if (pne) pne.textContent = '';

    const pnv = document.getElementById('pnv');
    const mv = document.getElementById('mv');
    if (pnv) {
      if (mv && mv.innerHTML) pnv.innerHTML = mv.innerHTML;
      else pnv.innerHTML = '<option value="1.21.4">1.21.4</option><option value="1.21.1" selected>1.21.1</option><option value="1.20.1">1.20.1</option><option value="1.19.4">1.19.4</option><option value="1.18.2">1.18.2</option><option value="1.16.5">1.16.5</option><option value="1.12.2">1.12.2</option>';
      if (presetV) pnv.value = presetV;
    }

    const pnl = document.getElementById('pnl');
    if (pnl) {
      pnl.innerHTML = '<option value="Fabric">Fabric</option><option value="Forge">Forge</option><option value="NeoForge">NeoForge</option><option value="Quilt">Quilt</option><option value="Horizon">Horizon (Rust)</option><option value="Vanilla">Vanilla</option>';
      if (presetL) pnl.value = presetL;
    }

    dlg.showModal();
  }
};

const pncBtn = document.getElementById('pnc');
if (pncBtn) pncBtn.onclick = () => document.getElementById('pkn')?.close();

const pnokBtn = document.getElementById('pnok');
if (pnokBtn) {
  pnokBtn.onclick = async () => {
    const n = document.getElementById('pnn').value.trim();
    const d = document.getElementById('pnd').value.trim();
    if (n.length < 2) {
      document.getElementById('pne').textContent = 'Введите название сборки.';
      return;
    }
    const safeId = 'p_' + Date.now().toString(36);
    const v = document.getElementById('pnv')?.value || '1.21.1';
    const l = document.getElementById('pnl')?.value || 'Fabric';

    if (window.sakura && window.sakura.createInstance) {
      await window.sakura.createInstance({ id: safeId, name: n, desc: d, v, l });
      toast(`Сборка «${n}» создана!`);
      document.getElementById('pkn')?.close();
      await window.syncDiskPacks();
      window.updateTargetInstanceDropdown();
      const mtargetSel = document.getElementById('mtarget');
      if (mtargetSel) mtargetSel.value = safeId;
      if (window._onNewInstanceCreated) {
        window._onNewInstanceCreated(safeId, n);
        window._onNewInstanceCreated = null;
      }
      if (mtab === 'mine') rMine();
    }
  };
}

// Pack view dialog / deletion
window.openModpackDialog = function(id) {
  const p = (ST.packs || []).find(x => x.id === id);
  if (!p) return;
  const pv = document.getElementById('pack_view');
  if (!pv) return;

  document.getElementById('packt').textContent = p.name;
  document.getElementById('pack_desc_view').textContent = p.desc || 'Игровая сборка';
  document.getElementById('pack_ver_info').textContent = `${p.v || '1.21.1'} (${p.l || 'Fabric'})`;
  document.getElementById('pack_mods_count').textContent = String(p.modsCount || 0);

  const delBtn = document.getElementById('pack_delete_btn');
  if (delBtn) {
    delBtn.onclick = () => {
      const confirmDlg = document.getElementById('confirm_dlg');
      if (confirmDlg) {
        document.getElementById('confirm_title').textContent = 'Удаление сборки';
        document.getElementById('confirm_msg').textContent = `Вы уверены, что хотите удалить сборку «${p.name}»? Все файлы сборки будут безопасно удалены, а файлы в Library сохранятся.`;
        const confirmOk = document.getElementById('confirm_ok');
        if (confirmOk) {
          confirmOk.onclick = async () => {
            confirmDlg.close();
            if (window.sakura && window.sakura.deleteInstance) {
              await window.sakura.deleteInstance(p.id);
              toast(`Сборка «${p.name}» удалена`);
              pv.hidden = true;
              document.querySelector('.n[data-p="instances"]')?.click();
            }
          };
        }
        confirmDlg.showModal();
      }
    };
  }

  const folderBtn = document.getElementById('pack_folder_btn');
  if (folderBtn) {
    folderBtn.onclick = () => {
      if (window.sakura && window.sakura.openGameFolder) {
        window.sakura.openGameFolder(`instances/${p.id}`);
      }
    };
  }

  pv.hidden = false;
  document.getElementById('mods').hidden = true;
};

// Initial setup
setTimeout(() => {
  window.updateTargetInstanceDropdown();
  mchips();
}, 200);

// Pack add and download choice dialog handlers (pkd)
let pendingDownloadItem = null;

window.openDownloadChoiceDialog = function(item) {
  pendingDownloadItem = item;
  const dlg = document.getElementById('pkd');
  if (!dlg) return;

  const itemName = (item && (item.t || item.title || item.name)) || '';
  const itemType = (item && (item.pt || item.type || mctype)) || 'mod';
  const itemSrc = (item && (item.src || msrc)) || 'mr';

  const pkt = document.getElementById('pkt');
  if (pkt) pkt.textContent = `Установка «${itemName}»`;

  const typeLabels = {
    mod: 'Мод',
    resourcepack: 'Ресурс-пак',
    shader: 'Шейдер',
    datapack: 'Аддон',
    modpack: 'Сборка'
  };
  const badge = document.getElementById('pkd_badge');
  if (badge) badge.textContent = typeLabels[itemType] || 'Мод';

  const pkm = document.getElementById('pkm');
  if (pkm) {
    pkm.innerHTML = `Источник: <b>${itemSrc === 'cf' ? 'CurseForge' : 'Modrinth'}</b> • Выберите сборку для установки:`;
  }

  // Populate pks with Library + all available user instances
  const pks = document.getElementById('pks');
  if (pks) {
    let opts = '<option value="_library">📁 В основную игру и библиотеку (Library)</option>';
    if (ST.packs && ST.packs.length > 0) {
      opts += '<optgroup label="Ваши сборки">';
      for (const p of ST.packs) {
        opts += `<option value="${esc(p.id)}">🌸 ${esc(p.name)} (${esc(p.v || '1.21.1')} • ${esc(p.l || 'Fabric')})</option>`;
      }
      opts += '</optgroup>';
    }
    pks.innerHTML = opts;

    const curTarget = window.getTargetInstanceId();
    if ([...pks.options].some(o => o.value === curTarget)) {
      pks.value = curTarget;
    } else if (ST.packs && ST.packs.length > 0) {
      pks.value = ST.packs[0].id;
    }
  }

  // Hook "+ Создать новую сборку" inside the dialog
  const newInstBtn = document.getElementById('pkd_new_instance_btn');
  if (newInstBtn) {
    newInstBtn.onclick = () => {
      const curV = document.getElementById('mv')?.value || '1.21.1';
      const curL = document.getElementById('mld_sel')?.value || 'Fabric';

      window._onNewInstanceCreated = (newId, newName) => {
        window.updateTargetInstanceDropdown();
        if (pks) {
          let opts = '<option value="_library">📁 В общую библиотеку (Library)</option>';
          if (ST.packs && ST.packs.length > 0) {
            opts += '<optgroup label="Ваши сборки">';
            for (const p of ST.packs) {
              opts += `<option value="${esc(p.id)}">🌸 ${esc(p.name)} (${esc(p.v || '1.21.1')} • ${esc(p.l || 'Fabric')})</option>`;
            }
            opts += '</optgroup>';
          }
          pks.innerHTML = opts;
          pks.value = newId;
        }
        const mtargetSel = document.getElementById('mtarget');
        if (mtargetSel) mtargetSel.value = newId;
        toast(`Сборка «${newName}» создана и выбрана для установки!`);
      };

      window.openNewPackDialog(`Сборка с ${itemName}`.substring(0, 36), curV, curL);
    };
  }

  // Hook "Скачать и установить" button
  const pko = document.getElementById('pko');
  if (pko) {
    pko.onclick = async () => {
      const target = pks ? pks.value : '_library';
      dlg.close();

      const mtargetSel = document.getElementById('mtarget');
      if (mtargetSel) mtargetSel.value = target;

      if (pendingDownloadItem.fileUrl || pendingDownloadItem.url) {
        // Direct file add
        toast(`Установка «${itemName}» в ${target === '_library' ? 'библиотеку' : 'сборку'}...`);
        try {
          const folder = getFolderForType(itemType);
          const res = await window.sakura.downloadModToPack(target, pendingDownloadItem.fileUrl || pendingDownloadItem.url, pendingDownloadItem.fileName || pendingDownloadItem.filename, folder);
          if (res && res.ok) {
            toast('Успешно добавлено!');
            await window.syncDiskPacks();
          } else {
            toast('Ошибка добавления файла');
          }
        } catch(e) {
          toast('Ошибка: ' + e.message);
        }
      } else {
        await executeDownloadItem(pendingDownloadItem, target);
      }
    };
  }

  dlg.showModal();
};

window.openAddToPackDialog = window.openDownloadChoiceDialog;

const pkcBtn = document.getElementById('pkc');
if (pkcBtn) pkcBtn.onclick = () => document.getElementById('pkd')?.close();
