// 서비스 워커의 보관함(CacheStorage)이 실패해도 **페이지가 뜨는가**.
//   node tools/sw_cachefail_check.js        (먼저 node tools/build.js --web)
//
// ■ 왜 — 2026-10-19 사용자 제보 「웹이든 모바일이든 처음 들어가면 로딩이 안 되고 F5 를 눌러야 된다」.
//   워커가 망에서 페이지를 멀쩡히 받아 놓고도, 보관하려고 caches.open 을 같은 try 안에서 기다렸다.
//   보관함이 실패하면(저장 공간 부족 · 브라우저의 저장소 정리 · 시크릿 창 · 프로필 경로 문제 등)
//   catch 로 떨어지고 거기서 또 보관함을 찾다 실패해 respondWith 가 거절 → **ERR_FAILED, 화면 없음.**
//   그림 길도 같은 구조였다. 이 PC 의 한글 경로 프로필에서 실제로 그렇게 실패하는 것을 재현했다.
// ■ 자 — 사이트판(dist/web)을 직접 띄운 서버로 내주되, sw.js 앞에 **보관함을 일부러 실패시키는 줄**을
//   붙인다. 워커가 깔린 뒤(= 워커가 페이지를 맡는 재방문) 페이지와 그림이 뜨는지 본다.
//   옛 워커(SW_FILE=그 파일)로 돌리면 이 검사가 운다.
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
const SW_FILE = process.env.SW_FILE || path.join(WEB, 'sw.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* 보관함의 모든 길을 실패시킨다 — 실제로 본 오류와 같은 꼴(UnknownError)로 */
const SABOTAGE = `(() => { const no = () => Promise.reject(new DOMException('시험: 보관함 실패', 'UnknownError'));
  for (const k of ['open', 'match', 'keys', 'has', 'delete']) self.caches[k] = no; })();\n`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
    return res.end(SABOTAGE + fs.readFileSync(SW_FILE, 'utf8'));
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => srv.listen(0, r));
  const BASE = 'http://localhost:' + srv.address().port + '/';
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const ctx = await br.createBrowserContext();
    const pg = await ctx.newPage();
    await pg.setViewport({ width: 1500, height: 900 });
    await pg.goto(BASE + '?sw=1', { waitUntil: 'load', timeout: 180000 });
    const active = await pg.evaluate(async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        const r = await navigator.serviceWorker.getRegistration();
        if (r && r.active && r.active.state === 'activated') return true;
        await new Promise(x => setTimeout(x, 200));
      }
      return false;
    });
    ok('보관함이 실패해도 워커는 깔린다', active);

    /* 재방문 — 이제 워커가 페이지를 맡는다. 사용자가 「안 뜬다」 고 한 그 순간이다. */
    let navErr = null;
    await pg.goto(BASE + '?sw=1', { waitUntil: 'load', timeout: 60000 }).catch(e => { navErr = e.message; });
    ok('워커가 맡은 재방문에서 페이지가 뜬다 (ERR_FAILED 가 아니다)', !navErr, navErr);
    await sleep(2500);
    const st = await pg.evaluate(() => ({
      ctl: !!navigator.serviceWorker.controller,
      cards: document.querySelectorAll('#msList .ms-card').length,
      imgs: [...document.querySelectorAll('#msList .ms-card img')].filter(i => i.complete && i.naturalWidth > 0).length
    })).catch(e => ({ err: e.message }));
    ok('그때 워커가 페이지를 맡고 있다 (워커 길을 실제로 탔다)', st.ctl === true, st);
    ok('기체 카드가 그려진다', st.cards > 0, st);
    ok('그림도 뜬다 (그림 길도 보관함 실패에 막히지 않는다)', st.imgs > 0, st);
  } finally {
    await br.close();
    srv.close();
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
