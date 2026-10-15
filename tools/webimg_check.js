// **사이트판**(이미지 분리 · images/)에서 그림이 실제로 그려지는가 — 실측.
//   node tools/webimg_check.js
//
// ■ 왜 — 2026-10-15 사용자 제보: 사이트에서 대결 시뮬레이터의 기체 그림이 전부 빈칸이었다.
//   대결(duel.js)이 그림 주소를 따로 만들며 **인라인 그림(GBO2_IMAGES)만** 찾았는데, 사이트판은
//   그림을 인라인하지 않고 images/ 폴더로 낸다. 다른 검사는 전부 오프라인판(dist/gbo2-simulator.html,
//   그림 인라인)으로 재서 아무도 못 봤다. 그래서 이 자는 **사이트판을 직접 빌드해** 띄운다.
// ■ 「주소가 있다」 가 아니라 「그려졌다」(naturalWidth > 0)를 본다 — 엉뚱한 주소도 비어 있지는 않다.
//   두 판(사이트 · 오프라인)을 같이 재서 한쪽만 고치고 다른 쪽을 깨는 것도 잡는다.
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = f => 'file:///' + f.split(path.sep).join('/').split(' ').join('%20');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* 사이트판은 배포 직전에야 만들어진다 — 검사가 직접 만든다(dist/web, 배포가 쓰는 그 자리) */
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js'), '--web'], { cwd: ROOT, stdio: 'ignore' });
const WEB = path.join(ROOT, 'dist', 'web', 'index.html');
const OFF = path.join(ROOT, 'dist', 'gbo2-simulator.html');

/* 그림이 다 그려질 때까지 — lazy 라 화면에 보이게 한 뒤 기다린다 */
const drawn = (pg, sel) => pg.evaluate(async sel => {
  const ims = [...document.querySelectorAll(sel)].slice(0, 8);
  ims.forEach(i => { i.loading = 'eager'; });
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && ims.some(i => !i.complete)) await new Promise(r => setTimeout(r, 100));
  return { n: ims.length, ok: ims.filter(i => i.complete && i.naturalWidth > 0).length,
    empty: ims.filter(i => !i.getAttribute('src')).length,
    bad: ims.filter(i => !(i.complete && i.naturalWidth > 0)).map(i => (i.getAttribute('src') || '(빈 주소)').slice(0, 60)).slice(0, 3) };
}, sel);

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  for (const [tag, file] of [['사이트판', WEB], ['오프라인판', OFF]]) {
    if (!fs.existsSync(file)) { ok(tag + ' 빌드가 있다', false, file); continue; }
    const pg = await br.newPage();
    await pg.setViewport({ width: 1500, height: 1100 });
    await pg.goto(url(file), { waitUntil: 'load', timeout: 180000 });
    await sleep(2400);
    const mode = await pg.evaluate(() => Object.keys(window.GBO2_IMAGES || {}).length ? '인라인' : 'images/');
    ok(tag + ' — 그림 방식이 ' + (tag === '사이트판' ? 'images/' : '인라인') + ' 이다', mode === (tag === '사이트판' ? 'images/' : '인라인'), mode);

    const cards = await drawn(pg, '#msList .ms-card img');
    ok(tag + ' — 기체 선택 카드 그림이 그려진다 (' + cards.ok + '/' + cards.n + ')', cards.n > 0 && cards.ok === cards.n, cards);

    /* 대결 — 오른쪽은 처음에 「기체 고르기」 목록이다 */
    await pg.evaluate(() => window.GBO2Duel.open());
    await sleep(800);
    const pick = await drawn(pg, '.duel-side[data-side="R"] .ds-msrow img');
    ok(tag + ' — 대결 기체 고르기 목록 그림이 그려진다 (' + pick.ok + '/' + pick.n + ')   (was 사이트판 0)', pick.n > 0 && pick.ok === pick.n, pick);

    /* 기체를 고르면 위 칸 그림 · 파츠 고르기 그림 */
    await pg.evaluate(() => document.querySelector('.duel-side[data-side="R"] .ds-msrow').click());
    await sleep(600);
    const unit = await drawn(pg, '.duel-side[data-side="R"] .ds-unit img');
    ok(tag + ' — 대결 기체 칸 그림이 그려진다', unit.n > 0 && unit.ok === unit.n, unit);
    await pg.evaluate(() => {
      const b = [...document.querySelectorAll('.duel-side[data-side="R"] button')].find(e => /파츠 끼우기|＋|파츠 고르기|\+/.test(e.textContent) && e.closest('.ds-block'));
      const slot = document.querySelector('.duel-side[data-side="R"] .ds-slot, .duel-side[data-side="R"] .ds-eq');
      (slot || b || { click() {} }).click();
    });
    await sleep(600);
    const parts = await drawn(pg, '.duel-side[data-side="R"] .ds-block img:not(.ds-unit img)');
    if (parts.n) ok(tag + ' — 대결 파츠 그림이 그려진다 (' + parts.ok + '/' + parts.n + ')', parts.ok === parts.n, parts);
    await pg.close();
  }
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
