/* ---- friends.js: Friends & Multiplayer Presence UI ---- */

let curFriendsState = null;

function getStatusBadge(status) {
  switch (status) {
    case 'online': return '<span class="friends-status-badge online">В сети</span>';
    case 'server': return '<span class="friends-status-badge server">На сервере</span>';
    case 'lan_host': return '<span class="friends-status-badge lan_host">LAN-хост</span>';
    case 'singleplayer': return '<span class="friends-status-badge singleplayer">В одиночной игре</span>';
    case 'dnd': return '<span class="friends-status-badge dnd">Не беспокоить</span>';
    case 'hidden': return '<span class="friends-status-badge offline">Невидимка</span>';
    default: return '<span class="friends-status-badge offline">Оффлайн</span>';
  }
}

window.renderFriendsState = function(state) {
  if (!state) return;
  curFriendsState = state;

  // Render My Profile
  const my = state.myProfile;
  if (my) {
    const myName = document.getElementById('friends_my_name');
    if (myName) myName.textContent = my.name || 'Мой профиль';
    const myAvatar = document.getElementById('friends_my_avatar');
    if (myAvatar) myAvatar.textContent = (my.name || 'S').slice(0, 1).toUpperCase();
    const myBadge = document.getElementById('friends_my_badge');
    if (myBadge) {
      myBadge.className = 'friends-status-badge ' + (my.status || 'online');
      myBadge.textContent = my.status === 'dnd' ? 'Не беспокоить' : (my.status === 'hidden' ? 'Невидимка' : (my.status === 'server' ? 'На сервере' : (my.status === 'lan_host' ? 'LAN-хост' : 'В сети')));
    }
    const myStatusText = document.getElementById('friends_my_status_text');
    if (myStatusText) {
      if (my.status === 'server' && my.serverAddress) {
        myStatusText.textContent = 'Играет на ' + my.serverAddress;
      } else if (my.status === 'lan_host' && my.lanPort) {
        myStatusText.textContent = 'Открыл мир для сети (порт ' + my.lanPort + ')';
      } else {
        myStatusText.textContent = my.statusText || 'В лаунчере';
      }
    }
    const myId = document.getElementById('friends_my_id');
    if (myId) myId.textContent = 'ID: ' + (my.id || '—');

    const statusSel = document.getElementById('friends_status_sel');
    if (statusSel && (my.status === 'online' || my.status === 'dnd' || my.status === 'hidden')) {
      statusSel.value = my.status;
    }
  }

  // Render Friend Requests
  const reqWrap = document.getElementById('friends_requests_wrap');
  const reqList = document.getElementById('friends_requests_list');
  const reqs = state.pendingRequests || [];
  if (reqWrap && reqList) {
    if (reqs.length > 0) {
      reqWrap.hidden = false;
      reqList.innerHTML = reqs.map(r => `
        <div class="friend-card">
          <div class="friends-avatar">${(r.fromName || 'U').slice(0, 1).toUpperCase()}</div>
          <div>
            <b>${r.fromName}</b>
            <p class="sub" style="margin:2px 0 0">Хочет добавить вас в друзья</p>
          </div>
          <div class="friend-actions">
            <button class="btn on" onclick="window.acceptFriendReq('${r.id}')">Принять</button>
            <button class="btn" onclick="window.declineFriendReq('${r.id}')">Отклонить</button>
          </div>
        </div>
      `).join('');
    } else {
      reqWrap.hidden = true;
      reqList.innerHTML = '';
    }
  }

  // Render Friends List
  const listTitle = document.getElementById('friends_list_title');
  const friendsList = document.getElementById('friends_list');
  const friends = state.friends || [];
  if (listTitle) listTitle.textContent = `Список друзей (${friends.length})`;

  if (friendsList) {
    if (friends.length === 0) {
      friendsList.innerHTML = '<p class="sub">У вас пока нет друзей в списке. Добавьте друзей по никнейму или ID профиля!</p>';
    } else {
      friendsList.innerHTML = friends.map(f => {
        let actionBtn = '';
        if (f.status === 'server' && f.serverAddress) {
          actionBtn = `<button class="btn on" onclick="window.playOnServer('${f.serverAddress}')">Подключиться к игре</button>`;
        } else if (f.status === 'lan_host' && f.lanPort) {
          actionBtn = `<button class="btn on" onclick="window.playOnServer('localhost:${f.lanPort}')">Войти в LAN-мир</button>`;
        }

        return `
          <div class="friend-card">
            <div class="friends-avatar">${(f.name || 'F').slice(0, 1).toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px">
                <b>${f.name}</b>
                ${getStatusBadge(f.status)}
              </div>
              <p class="sub" style="margin:2px 0 0;font-size:13px">${f.statusText || 'В лаунчере'}</p>
            </div>
            <div class="friend-actions">
              ${actionBtn}
              <button class="btn" style="color:#ff5555;border-color:rgba(255,85,85,0.4)" title="Удалить из друзей" onclick="window.removeFriendItem('${f.id}', '${f.name}')">Удалить</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }
};

window.initFriends = async function() {
  if (window.sakura && window.sakura.getFriendsState) {
    try {
      const state = await window.sakura.getFriendsState();
      window.renderFriendsState(state);
    } catch (e) {
      console.warn("Could not load friends state:", e);
    }
  }
};

window.setMyPresenceStatus = async function(status) {
  if (window.sakura && window.sakura.updateFriendProfile) {
    await window.sakura.updateFriendProfile({ status });
    toast('Статус обновлен');
  }
};

window.openAddFriendDialog = function() {
  const dlg = document.getElementById('friend_add_dialog');
  if (dlg) {
    const inp = document.getElementById('fr_add_input');
    if (inp) inp.value = '';
    const err = document.getElementById('fr_add_err');
    if (err) err.hidden = true;
    dlg.showModal();
  }
};

window.submitFriendRequest = async function() {
  const inp = document.getElementById('fr_add_input');
  const target = (inp ? inp.value : '').trim();
  if (!target) return;

  if (window.sakura && window.sakura.sendFriendRequest) {
    const res = await window.sakura.sendFriendRequest(target);
    if (res && res.ok) {
      toast(`Запрос в друзья для «${target}» отправлен!`);
      const dlg = document.getElementById('friend_add_dialog');
      if (dlg) dlg.close();
      window.initFriends();
    } else {
      const err = document.getElementById('fr_add_err');
      if (err) {
        err.textContent = res ? res.error : 'Не удалось отправить запрос';
        err.hidden = false;
      }
    }
  }
};

window.acceptFriendReq = async function(reqId) {
  if (window.sakura && window.sakura.acceptFriendRequest) {
    await window.sakura.acceptFriendRequest(reqId);
    toast('Запрос в друзья принят!');
    window.initFriends();
  }
};

window.declineFriendReq = async function(reqId) {
  if (window.sakura && window.sakura.declineFriendRequest) {
    await window.sakura.declineFriendRequest(reqId);
    toast('Запрос отклонен');
    window.initFriends();
  }
};

window.removeFriendItem = async function(friendId, friendName) {
  if (window.sakura && window.sakura.removeFriend) {
    await window.sakura.removeFriend(friendId);
    toast(`Игрок ${friendName} удален из друзей`);
    window.initFriends();
  }
};

if (window.sakura && window.sakura.onFriendsUpdate) {
  window.sakura.onFriendsUpdate((state) => {
    window.renderFriendsState(state);
  });
}

// Real-time friends updates polling
setInterval(() => {
  const s = document.getElementById("friends");
  if (s && !s.hidden) {
    window.initFriends();
  }
}, 3000);
