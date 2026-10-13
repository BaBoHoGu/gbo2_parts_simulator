// 대결 시뮬레이터가 **앱의 구성을 그대로 들고 오는가**를 실측한다.
//   node tools/duel_check.js
//
// ■ 왜 — 2026-10-13 에 사용자가 짚은 둘:
//   ① 「저장된 파츠를 가져오지 못한다」 — 왼쪽은 **처음 열 때 한 번만** 앱 구성을 가져왔다.
//      대결을 먼저 열어 본 뒤 파츠를 끼우고 다시 열면 옛 구성 그대로였다(4개를 끼웠는데 3개로 셌다).
//      그리고 저장 구성 드롭다운이 「기체 고르기」 화면에만 있어, 기체가 이미 앉은 쪽에서는
//      ⇄ 기체 변경을 거치지 않으면 저장한 파츠를 가져올 길이 없었다.
//   ② 「커스텀 확장 스킬이 없다」 — statsOf 가 EXPANSION_NONE 으로 못 박혀 있었다.
//      확장은 사격·격투 보정과 상한을 올리므로, 없으면 **실제로 끼고 싸우는 구성과 다른 수**가 나온다.
//
// ■ 자 — 둘 다 **수가 움직이는지**로 본다. 칸이 그려졌는지만 보면, 칸만 있고 계산에
//   안 먹히는 상태를 통과시킨다(실제로 그 상태였다).
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.split(String.fromCharCode(92)).join('/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  — ' + JSON.stringify(extra) : '')); }
};

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  pg.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 140)); });
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(3200);

  const r = await pg.evaluate(async () => {
    const w = x => new Promise(r => setTimeout(r, x));
    const o = {};
    const G = window.GBO2_DATA, C = window.GBO2Core;
    // 앱에서 기체를 고르고 파츠 3개를 **눌러** 끼운다
    const q = document.querySelector('#msQuery');
    q.value = '사자비'; q.dispatchEvent(new Event('input', { bubbles: true })); await w(700);
    const card = [...document.querySelectorAll('#msList .ms-card')][0];
    if (!card) return { 오류: '기체 카드를 못 찾음' };
    card.click(); await w(1500);
    const free = () => [...document.querySelectorAll('#partList .part-tile:not(.blocked):not(.on)')];
    for (let i = 0; i < 3; i++) { const f = free()[0]; if (!f) break; f.click(); await w(330); }
    o.앱파츠1 = document.querySelectorAll('#partList .part-tile.on').length;

    const db = document.getElementById('duelBtn');
    db.click(); await w(1300);
    const S = window.GBO2Duel.state;
    o.왼쪽파츠1 = S.L.parts.length;

    // ① 닫고 파츠를 하나 더 끼운 뒤 다시 열면 따라오는가
    window.GBO2Duel.close(); await w(700);
    const f = free()[0]; if (f) { f.click(); await w(420); }
    o.앱파츠2 = document.querySelectorAll('#partList .part-tile.on').length;
    db.click(); await w(1200);
    o.왼쪽파츠2 = S.L.parts.length;

    // ①b 대결 안에서 왼쪽을 손봤는데 앱이 그대로면 **덮지 않는다**
    const keep = S.L.parts.slice(0, 1);
    S.L.parts = keep;
    window.GBO2Duel.close(); await w(500); db.click(); await w(1100);
    o.손본것유지 = S.L.parts.length;

    // ② 저장 구성 드롭다운이 **기체가 앉은 쪽에도** 있는가 + 실제로 불러오는가
    const all = Object.values(G.parts).flat();
    const picked = all.slice(0, 3).map(p => p.name);
    localStorage.setItem('gbo2-offline-builds', JSON.stringify([{
      id: 't', name: '검사용 구성', ms: 'サザビー_LV2', parts: picked, stage: 6,
      expansion: '格闘補正拡張', expLevel: 3, ts: Date.now()
    }]));
    window.GBO2Duel.close(); window.GBO2Duel.open(); await w(900);
    /* **기체가 이미 앉은 쪽**을 본다. 오른쪽은 이 시점에 「기체 고르기」 화면이라
       거기 드롭다운은 예전에도 있었다 — 그걸 보면 회귀를 심어도 안 운다(심어 보고 알았다).
       왼쪽은 앱 구성이 앉아 있으므로, 여기 드롭다운이 있어야 사용자가 닿을 수 있다. */
    const inL = [...document.querySelectorAll('.duel-side[data-side="L"] select')];
    o.왼쪽고르기화면 = !!S.L.pickMs;
    const bsel = inL.find(s => /저장 구성에서/.test(s.options[0] ? s.options[0].textContent : ''));
    o.저장드롭다운 = !!bsel;
    if (bsel) {
      bsel.value = '0'; bsel.dispatchEvent(new Event('change', { bubbles: true })); await w(900);
      o.불러온파츠 = S.L.parts.map(p => p.name);
      o.불러온확장 = S.L.exp;
      o.불러온확장LV = S.L.expLv;
    }

    // ③ 확장 스킬이 **수를 움직이는가**
    S.R.ms = G.msData.find(m => m.MS名 === 'ザクⅡ_LV5'); S.R.stage = 6; S.R.parts = [];
    S.R.exp = C.EXPANSION_NONE;
    S.L.exp = C.EXPANSION_NONE; S.L.expLv = C.MAX_EXPANSION_LEVEL;
    window.GBO2Duel.close(); window.GBO2Duel.open(); await w(900);
    const esel = document.querySelector('.duel-side[data-side="L"] select.ds-exp');
    o.확장드롭다운 = !!esel;
    o.확장항목수 = esel ? esel.options.length : 0;
    const a0 = window.GBO2Duel.attack(S.L, S.R);
    o.확장없음 = a0 && { 보정: Math.round(a0.corr), 한발: a0.perHp };
    if (esel) { esel.value = '射撃補正拡張'; esel.dispatchEvent(new Event('change', { bubbles: true })); await w(800); }
    const a1 = window.GBO2Duel.attack(S.L, S.R);
    o.사격확장LV5 = a1 && { 보정: Math.round(a1.corr), 한발: a1.perHp };
    // LV 를 낮추면 더 작아져야 한다
    const lvBtns = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-row .seg-btn')]
      .filter(b => /^LV[1-5]$/.test(b.textContent));
    const lv1 = lvBtns[lvBtns.length - 5];
    if (lv1 && lv1.textContent === 'LV1') { lv1.click(); await w(700); }
    const a2 = window.GBO2Duel.attack(S.L, S.R);
    o.사격확장LV1 = a2 && { 보정: Math.round(a2.corr), 한발: a2.perHp };
    return o;
  });

  if (r.오류) { ok('화면을 띄웠다', false, r.오류); }
  else {
    ok('처음 열 때 앱 파츠를 그대로 가져온다 (' + r.앱파츠1 + '개)', r.왼쪽파츠1 === r.앱파츠1,
      { 앱: r.앱파츠1, 대결: r.왼쪽파츠1 });
    ok('앱에서 파츠를 바꾼 뒤 다시 열면 따라온다 (' + r.앱파츠2 + '개)   (was ' + r.앱파츠1 + '개에서 안 움직였다)',
      r.왼쪽파츠2 === r.앱파츠2, { 앱: r.앱파츠2, 대결: r.왼쪽파츠2 });
    ok('앱이 그대로면 대결에서 손본 왼쪽을 덮지 않는다', r.손본것유지 === 1, r.손본것유지);
    ok('왼쪽은 기체가 앉은 화면이다 (고르기 화면의 드롭다운을 보고 통과하지 않게)',
      r.왼쪽고르기화면 === false, r.왼쪽고르기화면);
    ok('저장 구성 드롭다운이 **기체가 앉은 쪽**에도 있다   (was 기체 고르기 화면에만 있었다)',
      r.저장드롭다운 === true);
    ok('저장 구성을 불러오면 파츠가 들어온다', (r.불러온파츠 || []).length === 3, r.불러온파츠);
    ok('저장 구성의 확장 스킬·LV 까지 되살린다 (격투보정확장 LV3)',
      r.불러온확장 === '格闘補正拡張' && r.불러온확장LV === 3, { 확장: r.불러온확장, LV: r.불러온확장LV });
    ok('확장 스킬 목록이 앱과 같다 (13개)', r.확장항목수 === 13, r.확장항목수);
    ok('확장을 켜면 **사격보정이 오른다** (칸만 있는 게 아니다)',
      !!r.사격확장LV5 && r.사격확장LV5.보정 > r.확장없음.보정, { 없음: r.확장없음, LV5: r.사격확장LV5 });
    ok('확장으로 피해도 늘어난다', !!r.사격확장LV5 && r.사격확장LV5.한발 > r.확장없음.한발,
      { 없음: r.확장없음, LV5: r.사격확장LV5 });
    ok('확장 LV1 은 LV5 보다 작다 (LV 도 먹힌다)',
      !!r.사격확장LV1 && r.사격확장LV1.보정 < r.사격확장LV5.보정 && r.사격확장LV1.보정 > r.확장없음.보정,
      { 없음: r.확장없음, LV1: r.사격확장LV1, LV5: r.사격확장LV5 });
  }
  ok('콘솔 오류가 없다', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
