// 「위키 미수록」 표시 — 무장 · 스킬이 아직 빈 새 기체에 이유를 적는가, 다른 기체에는 안 적는가.
//   node tools/wikipending_check.js
//
// ■ 왜 — 2026-10-16. 갓 나온 기체(밴디트 LV1)는 위키에 페이지가 생기기 전이라 무장 · 스킬이 비어 있었고,
//   화면은 「무장 정보가 없습니다」 만 적어 고장처럼 보였다. 이제 카드에 「위키 미수록」 꼬리표를,
//   빈칸에 이유를 적는다. 판정은 ui.js wikiPending 한 곳(무장도 스킬도 비었는가).
// ■ 자 — 대상 기체는 **데이터에서 고른다**(손으로 박지 않는다). 위키에 올라와 대상이 0 이 되면
//   표시 쪽 검사는 SKIP 하고, 「다른 기체에는 안 붙는다」 만 잰다.
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = require('./lib/duelgate.js');

let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.split(path.sep).join('/').split(' ').join('%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1500, height: 1300 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2400);

  // 대상 — 데이터에서 센다: 무장 묶음에도 스킬 원문에도 없는 기체
  const pick = await pg.evaluate(() => {
    const W = window.GBO2_WEAPONS || {}, S = window.GBO2_DATA.msSkills || {};
    const ids = new Set(Object.keys(W));
    const has = m => { const id = (String(m.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1]; return !!(id && ids.has(id) && W[id].weapons.length); };
    const ms = window.GBO2_DATA.msData;
    const pending = ms.filter(m => !has(m) && !(S[m.MS名.replace(/_LV\d+$/, '')] || []).length).map(m => m.MS名);
    const normal = ms.find(m => /^F91_LV1$/.test(m.MS名)).MS名;
    return { pending, normal };
  });
  console.log('  위키 미수록 기체: ' + (pick.pending.join(', ') || '없음'));

  const cardOf = name => pg.evaluate(async name => {
    const ko = window.GBO2i18n.msName(name);
    const q = document.querySelector('#msQuery'); q.value = ko.replace(/\s*LV\d+$/, ''); q.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const c = [...document.querySelectorAll('#msList .ms-card')].find(e => e.dataset.ms === name);
    if (!c) return null;
    const t = c.querySelector('.wiki-pending');
    return { tag: t ? t.textContent.trim() : null, title: t ? t.title : null };
  }, name);

  const n = await cardOf(pick.normal);
  ok('위키에 있는 기체(F91)에는 「위키 미수록」 이 안 붙는다', n && !n.tag, n);

  if (!pick.pending.length) {
    console.log('  SKIP  지금은 위키 미수록 기체가 없다 — 표시 쪽은 재지 않는다');
  } else {
    const name = pick.pending[0];
    const c = await cardOf(name);
    ok('기체 카드에 「위키 미수록」 꼬리표와 이유(title)', c && c.tag === '위키 미수록' && /위키/.test(c.title || ''), c);
    // 기체 정보 칸 — 무장 · 스킬 빈칸에 이유
    const info = await pg.evaluate(async name => {
      const c = [...document.querySelectorAll('#msList .ms-card')].find(e => e.dataset.ms === name);
      c.querySelector('.ms-info').click();
      await new Promise(r => setTimeout(r, 1200));
      const t = sel => [...document.querySelectorAll(sel)].map(e => e.textContent.trim()).join(' | ');
      return { w: t('#infoWpn .detail-empty, #selInfo .mi-wpn .detail-empty'), s: t('#infoSk .detail-empty, #selInfo .mi-sk .detail-empty, #selInfo .detail-empty') };
    }, name);
    ok('기체 정보 — 무장 · 스킬 빈칸에 「위키에 아직 … 없어」 이유', /위키에 아직/.test(info.w + info.s), info);
    // 파츠 화면 무장 표
    const tbl = await pg.evaluate(async () => {
      document.querySelector('#infoGo').click();
      await new Promise(r => setTimeout(r, 1200));
      return [...document.querySelectorAll('#weaponList .empty-state')].map(e => e.textContent.trim()).join(' | ');
    });
    ok('파츠 화면 무장 표 — 빈칸에 이유', /위키에 아직/.test(tbl), tbl);
    // 대결 무장 목록
    await G.measure(pg, { me: name, foe: 'ジム_LV1' });
    const duel = await pg.evaluate(() => [...document.querySelectorAll('.duel-side[data-side="L"] .ds-wlist .ds-empty')].map(e => e.textContent.trim()).join(' | '));
    ok('대결 무장 목록 — 빈칸에 이유', /위키에 아직/.test(duel), duel);
  }
  ok('페이지 오류 없음', !errs.length, errs);
  await br.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
