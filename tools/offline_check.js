// 사이트 오프라인(서비스 워커)이 실제로 되는가 — 실측.
//   node tools/offline_check.js
//
// ■ 왜 — 2026-10-16 사이트에 서비스 워커를 넣었다(src/sw.js). 워커는 조용히 실패한다:
//   등록이 안 돼도, 보관이 안 돼도 화면은 인터넷이 있는 동안 멀쩡하다. 끊어 봐야만 드러난다.
// ■ 자 — 사이트판(dist/web)을 이 검사가 직접 띄운 작은 서버로 열고(?sw=1), 워커가 깔린 뒤
//   **인터넷을 끊고 다시 연다.** 앱이 뜨고 카드가 그려지고 본 그림이 나오는지 본다.
//   파일로 여는 판(오프라인판 · APK)에서는 워커를 깔지 않아야 한다 — 그것도 본다.
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');

let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const WEB = path.join(ROOT, 'dist', 'web');
if (!fs.existsSync(path.join(WEB, 'sw.js'))) { console.log('SKIP  dist/web 없음 (node tools/build.js --web)'); process.exit(0); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => srv.listen(0, r));
  const PORT = srv.address().port;
  const BASE = 'http://localhost:' + PORT + '/';
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const ctx = await br.createBrowserContext();
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
    await pg.setViewport({ width: 1500, height: 900 });
    await pg.goto(BASE + '?sw=1', { waitUntil: 'load', timeout: 180000 });
    const ready = await pg.evaluate(async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        const r = await navigator.serviceWorker.getRegistration();
        if (r && r.active) return { state: r.active.state, scope: r.scope };
        await new Promise(x => setTimeout(x, 200));
      }
      return null;
    });
    ok('사이트판(?sw=1)에서 서비스 워커가 깔린다', !!ready, ready);
    // 워커가 페이지를 맡도록 한 번 더 연다 — 이때 그림도 받아 보관된다
    await pg.goto(BASE + '?sw=1', { waitUntil: 'load', timeout: 180000 });
    await sleep(2500);
    const seen = await pg.evaluate(() => [...document.querySelectorAll('#msList .ms-card img')].filter(i => i.complete && i.naturalWidth > 0).slice(0, 3).map(i => i.src));
    ok('다시 열면 워커가 페이지를 맡는다', await pg.evaluate(() => !!navigator.serviceWorker.controller));
    const cached = await pg.evaluate(async () => (await caches.keys()));
    ok('페이지 보관함과 그림 보관함이 생긴다', cached.some(k => k.startsWith('gbo2-page-')) && cached.includes('gbo2-img-v1'), cached);

    /* ── 인터넷을 끊고 다시 연다 ── */
    await pg.setOfflineMode(true);
    await pg.goto(BASE + '?sw=1', { waitUntil: 'load', timeout: 60000 }).catch(e => errs.push('goto: ' + e.message));
    await sleep(2000);
    const off = await pg.evaluate(srcs => ({
      cards: document.querySelectorAll('#msList .ms-card').length,
      data: !!(window.GBO2_DATA && window.GBO2_DATA.msData && window.GBO2_DATA.msData.length),
      imgs: Promise.all(srcs.map(s => new Promise(r => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = s; })))
    }), seen).then(async o => ({ ...o, imgs: await pg.evaluate(srcs => Promise.all(srcs.map(s => new Promise(r => { const i = new Image(); i.onload = () => r(true); i.onerror = () => r(false); i.src = s; }))), seen) }));
    ok('인터넷이 끊겨도 앱이 뜨고 기체 카드가 그려진다', off.cards > 0 && off.data, off);
    ok('한 번 본 그림은 끊긴 채로도 나온다 (' + seen.length + '장)', seen.length > 0 && off.imgs.every(Boolean), { seen, imgs: off.imgs });
    await pg.setOfflineMode(false);
    ok('페이지 오류 없음', !errs.length, errs);
    await ctx.close();

    /* ── 파일로 여는 판에서는 깔지 않는다 ── */
    const fp = await br.newPage();
    await fp.goto('file:///' + path.join(WEB, 'index.html').split(path.sep).join('/').split(' ').join('%20'), { waitUntil: 'load', timeout: 180000 });
    await sleep(1500);
    const fileSw = await fp.evaluate(async () => !!(navigator.serviceWorker && await navigator.serviceWorker.getRegistration().catch(() => null)));
    ok('파일로 열면(오프라인판 · APK) 워커를 깔지 않는다', !fileSw);
    // 주소에 ?sw=1 이 없는 http(로컬 검사 서버)에서도 깔지 않는다
    const ctx2 = await br.createBrowserContext();
    const p2 = await ctx2.newPage();
    await p2.goto(BASE, { waitUntil: 'load', timeout: 180000 }); await sleep(1500);
    ok('로컬 검사 서버(http, ?sw=1 없음)에서는 깔지 않는다', !(await p2.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))));
    await ctx2.close();
  } finally {
    await br.close();
    srv.close();
  }
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
