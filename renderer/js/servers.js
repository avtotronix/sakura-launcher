/* ---- servers.js: Minecraft Server List, Branded Avatars & Live Ping ---- */

function makeSvgAvatar(text, bg1, bg2, fg) {
  fg = fg || '#ffffff';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
    '<defs><linearGradient id="g_' + text + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" stop-color="' + bg1 + '"/>' +
    '<stop offset="100%" stop-color="' + bg2 + '"/>' +
    '</linearGradient></defs>' +
    '<rect width="96" height="96" rx="22" fill="url(#g_' + text + ')"/>' +
    '<text x="48" y="59" font-family="Arial, Helvetica, sans-serif" font-size="' + (text.length > 2 ? '26' : '34') + '" font-weight="900" fill="' + fg + '" text-anchor="middle" letter-spacing="1">' + text + '</text>' +
    '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const DEFAULT_SERVERS = [
  {
    id: "funtime",
    name: "FunTime",
    ip: "mc.funtime.su",
    desc: "Популярнейший сервер с Анархией и Грифом! Ивенты, мистические сундуки, крутая экономика и кланы.",
    modes: ["Анархия", "Гриферство", "PvP", "Ивенты"],
    versions: "1.16.5 — 26.3",
    icon: makeSvgAvatar('FT', '#ff4b1f', '#ff9068'),
    onlineFallback: 16500,
    featured: true
  },
  {
    id: "reallyworld",
    name: "ReallyWorld",
    ip: "mc.reallyworld.ru",
    desc: "Топовый сервер с Анархией и Выживанием. Уникальные боссы, талисманы, сбалансированное PvP.",
    modes: ["Анархия", "Гриферство", "Выживание"],
    versions: "1.12.2 — 26.3",
    icon: makeSvgAvatar('RW', '#00c6ff', '#0072ff'),
    onlineFallback: 9800,
    featured: true
  },
  {
    id: "holyworld",
    name: "HolyWorld",
    ip: "mc.holyworld.ru",
    desc: "Анархия нового поколения: крутые данжи, кастомные зачарования, сбалансированная броня и дуэли.",
    modes: ["Анархия", "Дуэли", "PvP"],
    versions: "1.16.5 — 26.3",
    icon: makeSvgAvatar('HW', '#7f00ff', '#e100ff'),
    onlineFallback: 8200,
    featured: true
  },
  {
    id: "mstnw",
    name: "MST Network",
    ip: "mc.mstnw.net",
    desc: "Классическая хардкорная Анархия и клановые войны без правил. Стабильный ТПС и честный античит.",
    modes: ["Анархия", "PvP", "Кланы"],
    versions: "1.16.5 — 26.3",
    icon: makeSvgAvatar('MST', '#eb3349', '#f45c43'),
    onlineFallback: 4100,
    featured: true
  },
  {
    id: "hypixel",
    name: "Hypixel",
    ip: "mc.hypixel.net",
    desc: "Самый масштабный сервер Minecraft в мире: BedWars, SkyBlock, SkyWars, Murder Mystery и десятки мини-игр.",
    modes: ["Мини-игры", "BedWars", "SkyBlock"],
    versions: "1.8.9 — 26.3",
    icon: makeSvgAvatar('H', '#f7971e', '#ffd200'),
    onlineFallback: 45000,
    featured: true
  },
  {
    id: "prostocraft",
    name: "ProstoCraft",
    ip: "play.prostocraft.ru",
    desc: "Разнообразные режимы: Выживание с приватами, SkyBlock, Creative и увлекательные авторские мини-игры.",
    modes: ["Выживание", "SkyBlock", "Мини-игры"],
    versions: "1.12.2 — 26.3",
    icon: makeSvgAvatar('PC', '#11998e', '#38ef7d'),
    onlineFallback: 2800,
    featured: false
  },
  {
    id: "mineblaze",
    name: "MineBlaze",
    ip: "mc.mineblaze.ru",
    desc: "Любимое Выживание и BedWars для игры с друзьями. Рабочие работы, свадьбы, магазины и питомцы.",
    modes: ["Выживание", "BedWars", "Гриферство"],
    versions: "1.12.2 — 26.3",
    icon: makeSvgAvatar('MB', '#f857a6', '#ff5858'),
    onlineFallback: 3400,
    featured: false
  },
  {
    id: "dexland",
    name: "DexLand",
    ip: "play.dexland.ru",
    desc: "Выживание с красивыми городами, SkyBlock с генераторами руд и весёлая Анархия.",
    modes: ["Выживание", "SkyBlock", "Анархия"],
    versions: "1.12.2 — 26.3",
    icon: makeSvgAvatar('DL', '#8e2de2', '#4a00e0'),
    onlineFallback: 2100,
    featured: false
  },
  {
    id: "sunmc",
    name: "SunMC",
    ip: "play.sunmc.ru",
    desc: "Анархия и комфортное Выживание. Сбалансированный донат, честная игра и отзывчивая администрация.",
    modes: ["Анархия", "Выживание", "PvP"],
    versions: "1.16.5 — 26.3",
    icon: makeSvgAvatar('SUN', '#f12711', '#f5af19'),
    onlineFallback: 1900,
    featured: false
  },
  {
    id: "gommehd",
    name: "GommeHD",
    ip: "gommehd.net",
    desc: "Один из лучших европейских серверов: динамичный BedWars, Jump League, TTT и дуэли.",
    modes: ["Мини-игры", "BedWars", "PvP"],
    versions: "1.8.9 — 26.3",
    icon: makeSvgAvatar('G', '#fc466b', '#3f5efb'),
    onlineFallback: 3500,
    featured: false
  },
  {
    id: "cubecraft",
    name: "CubeCraft",
    ip: "play.cubecraft.net",
    desc: "Легендарный сервер с EggWars, Lucky Islands, BlockWars и классическим SkyWars.",
    modes: ["Мини-игры", "SkyBlock", "BedWars"],
    versions: "1.12.2 — 26.3",
    icon: makeSvgAvatar('CC', '#00b4db', '#0083b0'),
    onlineFallback: 5100,
    featured: false
  },
  {
    id: "minedraft",
    name: "Minedraft",
    ip: "play.minedraft.ru",
    desc: "Чистое ванильное выживание без лишних плагинов и доната. Дружное сообщество и красивый мир.",
    modes: ["Выживание", "Ванилла"],
    versions: "1.20 — 26.3",
    icon: makeSvgAvatar('MD', '#56ab2f', '#a8e063'),
    onlineFallback: 850,
    featured: false
  }
];

let srvFilter = 'Все';
let srvQuery = '';
let srvOnlineCache = {};

function getStoredServers() {
  const custom = ST.customServers || [];
  return [...custom, ...DEFAULT_SERVERS];
}

async function pingServer(ip) {
  if (srvOnlineCache[ip] !== undefined) return srvOnlineCache[ip];
  try {
    const res = await fetch('https://api.mcsrvstat.us/2/' + encodeURIComponent(ip), { signal: AbortSignal.timeout(4500) });
    if (res.ok) {
      const data = await res.json();
      if (data.online) {
        const count = data.players ? data.players.online : 0;
        srvOnlineCache[ip] = {
          online: true,
          players: count,
          icon: data.icon || null,
          motd: data.motd ? (data.motd.clean || []).join(' ') : ''
        };
        return srvOnlineCache[ip];
      }
    }
  } catch (e) {}
  srvOnlineCache[ip] = null;
  return null;
}

window.copyServerIp = function(ip, btnElem) {
  navigator.clipboard.writeText(ip).then(() => {
    toast('IP ' + ip + ' скопирован в буфер обмена!');
    if (btnElem) {
      const orig = btnElem.innerHTML;
      btnElem.innerHTML = 'Скопировано';
      btnElem.classList.add('copied');
      setTimeout(() => {
        btnElem.innerHTML = orig;
        btnElem.classList.remove('copied');
      }, 2000);
    }
  }).catch(() => {
    toast('IP сервера: ' + ip);
  });
};

window.playOnServer = function(ip) {
  if (window.setDirectServer) {
    window.setDirectServer(ip);
  }
  const playTab = document.querySelector('.n[data-p="play"]');
  if (playTab) playTab.click();
  toast('Сервер ' + ip + ' выбран! Нажмите «Играть» для подключения.');
};


let curServerPage = 1;
let totalServerPages = 1;
let currentServerList = [];
let favServerSet = new Set();

window.renderServers = async function(more = false) {
  const container = document.getElementById('srv_list');
  if (!container) return;

  if (!more) {
    curServerPage = 1;
    currentServerList = [];
  }

  const q = srvQuery.trim().toLowerCase();

  if (window.sakura && window.sakura.getServerFavorites) {
    try {
      const favs = await window.sakura.getServerFavorites();
      favServerSet = new Set(favs);
    } catch(e) {}
  }

  let list = [];
  let total = 0;

  if (window.sakura && window.sakura.queryServers) {
    try {
      const res = await window.sakura.queryServers({
        search: q,
        mode: srvFilter,
        page: curServerPage,
        pageSize: 30
      });
      total = res.total;
      totalServerPages = res.totalPages;
      list = res.servers;
      currentServerList = more ? [...currentServerList, ...list] : list;
    } catch(err) {
      console.warn("Catalog query failed, using local servers:", err);
      list = getStoredServers();
      total = list.length;
      currentServerList = list;
    }
  } else {
    list = getStoredServers();
    total = list.length;
    currentServerList = list;
  }

  const countBadge = document.getElementById('srv_count');
  if (countBadge) countBadge.textContent = 'Доступно серверов в каталоге: ' + total;

  const cardsHtml = currentServerList.map(s => {
    const cached = srvOnlineCache[s.ip];
    const onlineText = cached && cached.online
      ? '<span class="srv-online-badge live"><span class="srv-pulse"></span> ' + cached.players.toLocaleString() + ' игроков</span>'
      : '<span class="srv-online-badge"><span class="srv-pulse"></span> ~' + (s.onlineFallback || 500).toLocaleString() + ' игроков</span>';

    const initials = (s.name || 'MC').replace(/[^a-zA-Z0-9а-яА-Я]/g, '').slice(0, 3).toUpperCase() || 'MC';
    const hue = (s.name.charCodeAt(0) * 47) % 360;
    const defIcon = s.icon || makeSvgAvatar(initials, `hsl(${hue}, 70%, 45%)`, `hsl(${(hue + 40) % 360}, 80%, 35%)`);
    const iconSrc = (cached && cached.icon) ? cached.icon : defIcon;
    const isFav = favServerSet.has(s.id) || favServerSet.has(s.ip);

    return '<div class="srv-card" data-ip="' + s.ip + '">' +
      '<div class="srv-card-top">' +
        '<img class="srv-icon" src="' + iconSrc + '" alt="" onerror="this.onerror=null;this.src=\'logo.png\';">' +
        '<div class="srv-info">' +
          '<div class="srv-title-row">' +
            '<span class="srv-name">' + s.name + '</span>' +
            onlineText +
            '<span class="srv-ver-badge">' + (s.versions || '1.7.10 — 26.3') + '</span>' +
            (s.platform ? '<span class="badge badge-mr" style="text-transform:capitalize">' + s.platform + '</span>' : '') +
          '</div>' +
          '<p class="srv-desc">' + (s.desc || '') + '</p>' +
          '<div class="srv-tags">' +
            (s.modes || []).map(m => '<span class="srv-tag">' + m + '</span>').join('') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="srv-card-bottom">' +
        '<div class="srv-ip-box" title="Нажмите, чтобы скопировать" onclick="window.copyServerIp(\'' + s.ip + '\', this)">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<code>' + s.ip + '</code>' +
        '</div>' +
        '<div class="srv-actions">' +
          '<button class="btn srv-copy-btn" onclick="window.copyServerIp(\'' + s.ip + '\', this)">' +
            'Скопировать IP' +
          '</button>' +
          '<button class="btn on srv-play-btn" onclick="window.playOnServer(\'' + s.ip + '\')">' +
            'Играть' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const moreBtnHtml = (curServerPage < totalServerPages)
    ? '<div style="grid-column:1/-1;text-align:center;margin-top:16px"><button class="btn" id="srv_load_more_btn" style="padding:10px 24px" onclick="window.loadMoreServers()">Показать ещё серверы</button></div>'
    : '';

  container.innerHTML = cardsHtml + moreBtnHtml;

  // Background live ping for visible servers
  list.slice(0, 15).forEach(async s => {
    const data = await pingServer(s.ip);
    if (data) {
      const card = container.querySelector('[data-ip="' + s.ip + '"]');
      if (card) {
        if (data.online) {
          const badge = card.querySelector('.srv-online-badge');
          if (badge) {
            badge.className = "srv-online-badge live";
            badge.innerHTML = '<span class="srv-pulse"></span> ' + data.players.toLocaleString() + ' игроков';
          }
        }
        if (data.icon) {
          const img = card.querySelector('.srv-icon');
          if (img) img.src = data.icon;
        }
      }
    }
  });
};

window.loadMoreServers = function() {
  curServerPage++;
  window.renderServers(true);
};


window.openAddServerDialog = function() {
  const dlg = document.getElementById('srv_add_dialog');
  if (dlg) {
    document.getElementById('srv_add_name').value = '';
    document.getElementById('srv_add_ip').value = '';
    document.getElementById('srv_add_desc').value = '';
    dlg.showModal();
  }
};

window.closeAddServerDialog = function() {
  const dlg = document.getElementById('srv_add_dialog');
  if (dlg) dlg.close();
};

window.saveNewServer = function() {
  const name = document.getElementById('srv_add_name').value.trim();
  const ip = document.getElementById('srv_add_ip').value.trim();
  const desc = document.getElementById('srv_add_desc').value.trim() || 'Пользовательский сервер';
  if (!name || !ip) {
    toast('Введите название и IP сервера!');
    return;
  }
  if (!ST.customServers) ST.customServers = [];
  const initials = name.slice(0, 3).toUpperCase();
  ST.customServers.unshift({
    id: 'custom_' + Date.now(),
    name,
    ip,
    desc,
    modes: ['Мой сервер'],
    versions: '1.7.10 — 26.3',
    icon: makeSvgAvatar(initials, '#3a7bd5', '#3a6073'),
    onlineFallback: 0,
    featured: false
  });
  save();
  window.closeAddServerDialog();
  toast('Сервер ' + name + ' добавлен в ваш список!');
  window.renderServers();
};

window.initServers = function() {
  const searchInput = document.getElementById('srv_search_input');
  if (searchInput) {
    searchInput.oninput = () => {
      srvQuery = searchInput.value;
      window.renderServers();
    };
  }

  const chips = document.querySelectorAll('#srv_filter_chips .chip');
  chips.forEach(c => {
    c.onclick = () => {
      chips.forEach(x => x.setAttribute('aria-pressed', 'false'));
      c.setAttribute('aria-pressed', 'true');
      srvFilter = c.dataset.mode || 'Все';
      window.renderServers();
    };
  });

  window.renderServers();
};
