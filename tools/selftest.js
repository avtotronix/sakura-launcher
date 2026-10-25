(async () => {
  const r = {};
  const $ = s => document.querySelector(s);
  const wait = ms => new Promise(f => setTimeout(f, ms));
  r.sakuraApi = typeof window.sakura;
  r.title = document.title;
  // WebGL availability
  const c = document.createElement('canvas');
  r.webgl = !!c.getContext('webgl');
  // skins tab
  const skBtn = $('.n[data-p="skins"]'); if (skBtn) skBtn.click();
  await wait(500);
  r.skinsVisible = !$('#skins')?.hidden;
  r.skinSd = $('#sd')?.textContent;
  // pixel check on 3D canvas (readPixels right after draw — same task)
  try {
    const sk = $('#sk');
    r.skinCanvas = sk.width + 'x' + sk.height + ' client ' + sk.clientWidth + 'x' + sk.clientHeight;
    skinG.draw();
    const gl = sk.getContext('webgl');
    const d = new Uint8Array(sk.width * sk.height * 4);
    gl.readPixels(0, 0, sk.width, sk.height, gl.RGBA, gl.UNSIGNED_BYTE, d);
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++;
    r.skinPixels = n;
  } catch (e) { r.skinPixels = 'err ' + e.message; }
  // themes
  const scn = $('#scn');
  r.themes = [];
  for (const v of ['aurora', 'forest', 'sunset', 'sakura']) {
    scn.value = v; scn.dispatchEvent(new Event('change'));
    await wait(300);
    r.themes.push(v + ':' + scn.value);
  }
  // settings buttons
  $('.n[data-p="set"]').click();
  await wait(200);
  for (const id of ['gb', 'mb', 'eb']) {
    const b = $('#' + id);
    r['btn_' + id] = b ? (typeof b.onclick) : 'missing';
  }
  r.toast = $('#t')?.textContent;
  // play
  $('.n[data-p="play"]').click();
  r.go = $('#go') ? { text: $('#go').textContent, disabled: $('#go').disabled } : 'missing';
  r.accBtn = $('#play_acc_btn') ? $('#play_acc_btn').textContent : 'missing';
  r.verCount = $('#ver')?.options.length;
  r.loaders = [...document.querySelectorAll('#ls [data-l]')].map(b => b.dataset.l + (b.disabled ? '(off)' : ''));
  if (window.__selftestExtra) r.extra = await window.__selftestExtra();
  return JSON.stringify(r, null, 1);
})()
