/* ---- downloads.js: Unified Download Manager UI ---- */

let downloadTasks = [];

function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 Б';
  const k = 1024;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fmtSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  return fmtBytes(bytesPerSec) + '/с';
}

function getStatusTitle(status) {
  switch (status) {
    case 'queued': return 'В очереди';
    case 'downloading': return 'Загрузка';
    case 'verifying': return 'Проверка целостности';
    case 'installing': return 'Установка';
    case 'completed': return 'Завершено';
    case 'failed': return 'Ошибка';
    case 'cancelled': return 'Отменено';
    default: return status;
  }
}

function renderDownloadCard(t) {
  const isPending = t.status === 'downloading' || t.status === 'verifying' || t.status === 'installing';
  const isFailed = t.status === 'failed';
  const isDone = t.status === 'completed';

  let actionHtml = '';
  if (isPending) {
    actionHtml = `<button class="btn" style="padding:4px 10px;font-size:11px" onclick="window.cancelDownloadItem('${t.id}')">Отмена</button>`;
  } else if (isFailed) {
    actionHtml = `<button class="btn on" style="padding:4px 10px;font-size:11px" onclick="window.retryDownloadItem('${t.id}')">Повторить</button>`;
  }

  const speedStr = isPending ? fmtSpeed(t.speed) : '';
  const bytesStr = `${fmtBytes(t.transferredBytes)} / ${fmtBytes(t.totalBytes)}`;

  return `
    <div class="dl-card" id="dl_card_${t.id}">
      <div class="dl-card-header">
        <div class="dl-card-info">
          <span class="dl-badge ${t.type}">${t.type}</span>
          <b style="font-size:14px">${t.name}</b>
          ${t.targetPackId ? `<small style="color:var(--mute)">(${t.targetPackId})</small>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="friends-status-badge ${isDone ? 'online' : (isFailed ? 'dnd' : 'server')}">${getStatusTitle(t.status)}</span>
          ${actionHtml}
        </div>
      </div>
      <div class="dl-bar-track">
        <div class="dl-bar-fill" style="width:${t.progress || 0}%"></div>
      </div>
      <div class="dl-meta-row">
        <span>${bytesStr} ${speedStr ? `(${speedStr})` : ''}</span>
        <span>${t.progress || 0}%</span>
      </div>
      ${t.error ? `<small style="color:#ff5555">${t.error}</small>` : ''}
    </div>
  `;
}

window.renderDownloadsList = function() {
  const container = document.getElementById('dl_list');
  const summaryText = document.getElementById('dl_summary_text');
  if (!container) return;

  const activeCount = downloadTasks.filter(t => t.status === 'downloading' || t.status === 'queued').length;
  if (summaryText) {
    summaryText.textContent = activeCount > 0
      ? `Активных загрузок: ${activeCount} (Всего: ${downloadTasks.length})`
      : `Всего загрузок: ${downloadTasks.length}`;
  }

  if (downloadTasks.length === 0) {
    container.innerHTML = '<p class="sub" id="dl_empty_text">Загрузок пока нет. Скачивайте моды, ресурс-паки, шейдеры и сборки из каталога!</p>';
    return;
  }

  container.innerHTML = downloadTasks.map(renderDownloadCard).join('');
};

window.initDownloads = async function() {
  if (window.sakura && window.sakura.getDownloads) {
    try {
      downloadTasks = await window.sakura.getDownloads();
      window.renderDownloadsList();
    } catch (e) {
      console.warn("Could not load downloads:", e);
    }
  }
};

window.cancelDownloadItem = async function(id) {
  if (window.sakura && window.sakura.cancelDownload) {
    await window.sakura.cancelDownload(id);
    toast('Загрузка отменена');
    window.initDownloads();
  }
};

window.retryDownloadItem = async function(id) {
  if (window.sakura && window.sakura.retryDownload) {
    await window.sakura.retryDownload(id);
    toast('Повторная попытка загрузки...');
    window.initDownloads();
  }
};

window.clearFinishedDownloads = async function() {
  if (window.sakura && window.sakura.clearDownloads) {
    await window.sakura.clearDownloads();
    toast('Завершенные загрузки очищены');
    window.initDownloads();
  }
};

// Real-time IPC events
if (window.sakura) {
  if (window.sakura.onDownloadProgress) {
    window.sakura.onDownloadProgress((task) => {
      const idx = downloadTasks.findIndex(t => t.id === task.id);
      if (idx !== -1) {
        downloadTasks[idx] = task;
      } else {
        downloadTasks.unshift(task);
      }
      const card = document.getElementById(`dl_card_${task.id}`);
      if (card) {
        const fill = card.querySelector('.dl-bar-fill');
        if (fill) fill.style.width = (task.progress || 0) + '%';
        const meta = card.querySelector('.dl-meta-row');
        if (meta) {
          const speedStr = fmtSpeed(task.speed);
          const bytesStr = `${fmtBytes(task.transferredBytes)} / ${fmtBytes(task.totalBytes)}`;
          meta.innerHTML = `<span>${bytesStr} ${speedStr ? `(${speedStr})` : ''}</span><span>${task.progress || 0}%</span>`;
        }
      } else {
        window.renderDownloadsList();
      }
    });
  }

  if (window.sakura.onDownloadCompleted) {
    window.sakura.onDownloadCompleted((task) => {
      const idx = downloadTasks.findIndex(t => t.id === task.id);
      if (idx !== -1) downloadTasks[idx] = task;
      toast(`Загрузка завершена: ${task.name}`);
      window.renderDownloadsList();
    });
  }

  if (window.sakura.onDownloadFailed) {
    window.sakura.onDownloadFailed((task) => {
      const idx = downloadTasks.findIndex(t => t.id === task.id);
      if (idx !== -1) downloadTasks[idx] = task;
      toast(`Ошибка загрузки: ${task.name} (${task.error || ''})`);
      window.renderDownloadsList();
    });
  }
}
