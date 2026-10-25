const FD=[['mods','Установленные моды'],['config','Настройки модов'],['saves','Миры'],['resourcepacks','Ресурспаки'],['shaderpacks','Шейдеры'],['screenshots','Скриншоты'],['logs','Журналы игры'],['crash-reports','Отчёты о вылетах'],['versions','Версии и загрузчики'],['libraries','Библиотеки игры'],['assets','Звуки и ресурсы']];
const FL=[['options.txt','Настройки игры'],['servers.dat','Список серверов'],['launcher_profiles.json','Профили лаунчера']];
function fd(){
  const n=Object.values(mi).reduce((a,b)=>a+b.length,0),r=(a,d)=>`<div class="row"><div><b>${a}</b><small>${d}</small></div><button class="btn" data-o="${a}">Открыть</button></div>`;
  $('#fd').innerHTML=r('%APPDATA%\\.sakura','Корневая папка игры')+'<h2>Папки</h2>'+FD.map(f=>r(f[0],f[1]+(f[0]==='mods'&&n?`: ${n}`:''))).join('')+'<h2>Файлы</h2>'+FL.map(f=>r(f[0],f[1])).join('');
}


/* ---- settings and accounts ---- */