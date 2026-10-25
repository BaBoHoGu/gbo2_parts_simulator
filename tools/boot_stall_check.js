// 첫 로딩이 **멈췄을 때** 앱이 스스로 빠져나오는가(index.html 머리의 감시).
//
//   node tools/boot_stall_check.js        (먼저 node tools/build.js --web)
//
// 2026-10-26 사용자 제보 — 모바일에서 「불러오는 중」 에 멈춘 채 끝나지 않고, 앱을 완전히 끄고 다시 열어야 떴다.
// 9MB 한 장을 받다가 연결이 오류 없이 멈추면 브라우저는 영원히 기다린다. 헤드리스로는 망이 늘 멀쩡해 재현이 안 되므로,
// **멈추는 서버**를 여기서 직접 띄운다(앞부분만 보내고 연결을 붙잡는다). 경우는 다섯:
//   정상 · 느리지만 계속 받음(멈춤으로 잘못 보면 안 된다) · 첫 요청만 멈춤(저절로 한 번 새로 받아 떠야 한다)
//   · 계속 멈춤(다시 불러오기 단추) · 다 받았는데 시작 중 오류(오류 글이 보여야 한다)
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const GBO2Browser = require('./lib/browser.js');
const { findChrome } = require('./lib/wiki_fetch.js');
const FILE = path.join(__dirname, '..', 'dist', 'web', 'index.html');
if (!fs.existsSync(FILE)) { console.log('FAIL  사이트판 빌드가 없습니다 — node tools/build.js --web 먼저'); process.exit(1); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const HTML = fs.readFileSync(FILE);
const BROKEN = Buffer.from(HTML.toString('utf8').replace('(function(){"use strict";const C=window.GBO2Core', 'throw new Error("시험 오류 — 시작 중 터짐");(function(){"use strict";const C=window.GBO2Core'));

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra != null ? '  ' + JSON.stringify(extra) : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hung = [];

/* 경우마다 요청 번호(n)에 따라 다르게 답한다 */
const PLAN = {
  normal: () => 'full',
  slow: () => 'slow',
  stallOnce: n => (n === 1 ? 'stall' : 'full'),
  stallAlways: () => 'stall',
  error: () => 'broken'
};
function serve(mode) {
  let n = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/' && u.pathname !== '/index.html') { res.writeHead(404); res.end(); return; }
    n++;
    const how = PLAN[mode](n);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    if (how === 'full') { res.end(HTML); return; }
    if (how === 'broken') { res.end(BROKEN); return; }
    if (how === 'stall') { res.write(HTML.subarray(0, 600 * 1024)); hung.push(res); return; }   // 앞부분만 — 그리고 붙잡는다
    // slow — 약 20초에 걸쳐 끝까지(1초에 ~480KB). 멈춤 판정(15초 무진척)에 걸리면 안 된다
    let at = 0;
    const step = Math.ceil(HTML.length / 200);
    const t = setInterval(() => {
      if (res.destroyed) { clearInterval(t); return; }
      res.write(HTML.subarray(at, at + step)); at += step;
      if (at >= HTML.length) { clearInterval(t); res.end(); }
    }, 100);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, count: () => n })));
}

async function run(br, mode, waitMs) {
  const { srv, port, count } = await serve(mode);
  const ctx = await br.createBrowserContext();
  const pg = await ctx.newPage();
  await pg.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 80)));
  pg.goto('http://127.0.0.1:' + port + '/', { timeout: 120000 }).catch(() => {});
  const t0 = Date.now();
  let st = null;
  while (Date.now() - t0 < waitMs) {
    await sleep(1000);
    st = await pg.evaluate(() => ({
      ready: !!window.GBO2_READY,
      cards: document.querySelectorAll('#msList .ms-card').length,
      msg: (document.querySelector('.ms-load-msg') || {}).textContent || '',
      err: (document.querySelector('.ms-load-err') || {}).textContent || '',
      btn: !!document.querySelector('.ms-loading button'),
      url: location.href
    })).catch(() => st);
    if (st && (st.ready || st.btn)) break;
  }
  const sec = Math.round((Date.now() - t0) / 1000);
  await ctx.close();
  for (const r of hung.splice(0)) { try { r.destroy(); } catch (e) {} }
  srv.close();
  return { ...st, sec, requests: count() };
}

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });

  console.log('== 정상 ==');
  let r = await run(br, 'normal', 30000);
  ok('정상이면 앱이 뜨고 감시는 아무것도 안 한다', r && r.ready && r.cards > 0 && !r.msg && r.requests === 1, r);

  console.log('== 느리지만 계속 받음 (약 20초) ==');
  r = await run(br, 'slow', 60000);
  ok('느려도 받는 중이면 멈춤으로 보지 않는다 (다시 받지 않는다)', r && r.ready && r.requests === 1, r);

  console.log('== 첫 요청만 멈춤 ==');
  r = await run(br, 'stallOnce', 60000);
  ok('멈추면 저절로 한 번 새로 받아 뜬다', r && r.ready && r.cards > 0 && r.requests === 2, r);
  ok('다 뜬 뒤 주소에 _r 이 남지 않는다', r && !/[?&]_r=/.test(r.url), r && r.url);

  console.log('== 계속 멈춤 ==');
  r = await run(br, 'stallAlways', 70000);
  ok('두 번째도 멈추면 「다시 불러오기」 단추를 보여 준다 (끝없이 다시 받지 않는다)', r && r.btn && /멈췄/.test(r.msg) && r.requests === 2, r);

  console.log('== 시작 중 오류 ==');
  r = await run(br, 'error', 40000);
  ok('시작하지 못하면 오류 글과 단추를 보여 준다', r && r.btn && /시작하지 못했/.test(r.msg) && /시험 오류/.test(r.err), r);

  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
