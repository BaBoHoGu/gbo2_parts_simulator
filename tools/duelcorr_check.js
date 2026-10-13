// 대결 시뮬의 「공격보정 직접 입력」이 구성을 따라오고, **쓰는 칸만** 쓰는가.
//   node tools/duelcorr_check.js
//
// ■ 어디서 왔나 — 피탄 시뮬의 「적 공격보정」 칸을 옮긴 자(옛 pietancorr_check).
//   그 화면에서 실제로 틀렸던 것들을 그대로 다시 잰다:
//     · 기체를 바꿔도 칸에 앞 기체 숫자가 남았다 (자쿠Ⅱ 19 → 구프로 바꿔도 19)
//     · 상대 파츠를 끼우거나 빼도 보정이 안 따라왔다
//     · 칸이 하나라 사격↔격투가 번갈아 덮였다
//     · 손으로 고친 값이 **두 칸 다** 묶였다
//
// ■ 옮기면서 모양이 하나 바뀌었다 — 피탄은 「값 + 만졌다 깃발」 둘을 들고 있었는데,
//   대결은 **값 하나**만 든다(null = 자동). 「깃발과 값이 갈리는」 꼴이 없어진 대신
//   「비우면 자동으로 돌아가는가」를 새로 잰다.
//
// ■ 기대값은 앱이 아니라 core 로 직접 센다 — 같은 식을 베끼면 같이 틀린다.
'use strict';
const GBO2Browser = require('./lib/browser.js');
const DG = require('./lib/duelgate.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));

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

const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const parts = rd('data', 'parts.json');
const msData = rd('data', 'msData.json');
const fullst = rd('data', 'fullst.json');
const allParts = [].concat(...Object.values(parts).filter(Array.isArray));
const corrOf = (ms, ps, stage) =>
  Math.round(C.calcStats(ms, ps, stage, '拡張スキル無し', parts, fullst, null, 'normal').total.shoot || 0);
const meleeOf = (ms, ps, stage) =>
  Math.round(C.calcStats(ms, ps, stage, '拡張スキル無し', parts, fullst, null, 'normal').total.meleeCorrection || 0);

/* 표본은 **데이터에서 고른다** — 이름을 코드에 박으면 조정 때 썩는다.
   대결은 base 이름으로 세우고 최고 LV 엔트리를 쓴다(duelgate 의 pick)므로 기댓값도 그 엔트리로. */
const baseOf = m => String(m.MS名).replace(/_LV\d+$/, '');
const byBase = new Map();
for (const m of msData) {
  const b = baseOf(m), cur = byBase.get(b);
  if (!cur || C.msLevel(m.MS名) > C.msLevel(cur.MS名)) byBase.set(b, m);
}
const pool = [...byBase.values()].filter(m => (m.fullst || []).length);
const msA = pool.find(m => corrOf(m, [], 6) >= 15);
const msB = pool.find(m => msA && corrOf(m, [], 6) > 0 && corrOf(m, [], 6) < corrOf(msA, [], 6) - 5);
const shootPart = allParts.find(p => p.name === '射撃強化プログラム_LV1')
  || allParts.find(p => /射撃強化プログラム/.test(p.name));
ok('표본 기체 둘과 사격 파츠를 찾았다', !!(msA && msB && shootPart),
  { A: msA && msA.MS名, B: msB && msB.MS名, 파츠: shootPart && shootPart.name });
if (!msA || !msB || !shootPart) process.exit(1);

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  await pg.setViewport({ width: 1500, height: 1100 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(3200);

  /* 오른쪽이 쏘는 쪽이다 — 피탄에서 「적 공격보정」이던 자리. */
  const shot = (foe, o) => DG.measure(pg, { me: 'ザクⅡ', foe, from: 'R', ...o });
  /* 화면의 보정 칸 — 비어 있으면 구성값이 placeholder 로 보인다. */
  const box = r => {
    const out = {};
    for (const c of (r.보정칸 || [])) out[c.ko] = c;
    return out;
  };

  // ── ① 기체를 세우면 그 기체 구성값이 칸에 보인다 ──────────────────
  const a0 = await shot(baseOf(msA), { melee: false });
  ok('A 기체를 세웠다', !a0.오류, a0.오류 || a0.무장);
  ok('새 기체를 세우면 바로 그 기체의 사격보정이 보인다',
    !a0.오류 && Number(box(a0)['사격'].구성값) === corrOf(msA, [], 6)
    && a0.구성보정 === corrOf(msA, [], 6),
    { 앱: box(a0)['사격'], 계산: corrOf(msA, [], 6), 기체: msA.MS名 });

  const b0 = await shot(baseOf(msB), { melee: false });
  ok('기체를 바꾸면 앞 기체 값이 남지 않는다',
    !b0.오류 && Number(box(b0)['사격'].구성값) === corrOf(msB, [], 6)
    && box(b0)['사격'].구성값 !== box(a0)['사격'].구성값,
    { A: box(a0)['사격'].구성값, B: box(b0)['사격'].구성값, 계산: corrOf(msB, [], 6) });

  ok('사격·격투 칸이 **동시에** 제 값으로 찬다 (한 칸으로 번갈아 덮이지 않는다)',
    !b0.오류 && Number(box(b0)['사격'].구성값) === corrOf(msB, [], 6)
    && Number(box(b0)['격투'].구성값) === meleeOf(msB, [], 6),
    { 사격: box(b0)['사격'].구성값, 격투: box(b0)['격투'].구성값,
      계산: [corrOf(msB, [], 6), meleeOf(msB, [], 6)] });

  // ── ② 쓰는 칸만 쓴다 — 격투 무장은 격투 칸만 수를 움직인다 ────────
  const bm = await shot(baseOf(msB), { melee: true });
  if (bm.오류) console.log('  (이 기체엔 격투 무장이 없어 건너뜀)');
  else {
    ok('격투 무장을 골라도 두 칸은 그대로다 (쓰는 쪽만 격투)',
      Number(box(bm)['사격'].구성값) === corrOf(msB, [], 6)
      && Number(box(bm)['격투'].구성값) === meleeOf(msB, [], 6),
      { 무장: bm.무장, 사격: box(bm)['사격'].구성값, 격투: box(bm)['격투'].구성값 });
    ok('격투 무장은 격투보정을 쓴다', bm.구성보정 === meleeOf(msB, [], 6),
      { 쓴값: bm.구성보정, 격투: meleeOf(msB, [], 6), 사격: corrOf(msB, [], 6) });
    /* **칸이 찬 것만 봐서는 모자란다.** 「늘 사격 칸을 쓴다」로 심으면 그대로 통과한다 —
       계산이 어느 칸을 쓰는지는 **결과 숫자**로만 알 수 있다. 한 칸씩 흔들어 본다. */
    const mWig = await shot(baseOf(msB), { melee: true, weaponExact: bm.무장, corr: { melee: 250 } });
    ok('격투 무장일 때 **격투 칸**을 흔들면 결과가 바뀐다',
      mWig.한발 !== bm.한발 && mWig.보정 === 250,
      { 원래: bm.한발, 격투250: mWig.한발, 쓴보정: mWig.보정 });
    const sWig = await shot(baseOf(msB), { melee: true, weaponExact: bm.무장, corr: { shoot: 250 } });
    ok('격투 무장일 때 사격 칸을 흔들어도 결과가 안 바뀐다',
      sWig.한발 === bm.한발, { 원래: bm.한발, 사격250: sWig.한발 });
  }

  // ── ③ 파츠를 끼우고 빼면 구성값이 따라온다 ───────────────────────
  const fit = C.checkEquip(shootPart, msB, [], C.calcSlots(msB, [], 6, fullst)).ok ? [shootPart] : [];
  ok('그 파츠가 이 기체에 들어간다', fit.length === 1, { 파츠: shootPart.name, 기체: msB.MS名 });
  const withPart = await shot(baseOf(msB), { melee: false, foeParts: [shootPart.name] });
  ok('파츠를 끼우면 보정이 따라 오른다', withPart.구성보정 > b0.구성보정,
    { 끼우기전: b0.구성보정, 끼운뒤: withPart.구성보정 });
  ok('그 값이 손으로 센 값과 같다', withPart.구성보정 === corrOf(msB, fit, 6),
    { 앱: withPart.구성보정, 계산: corrOf(msB, fit, 6), 파츠없이: corrOf(msB, [], 6) });
  const removed = await shot(baseOf(msB), { melee: false });
  ok('파츠를 빼면 보정이 되돌아간다', removed.구성보정 === b0.구성보정,
    { 뺀뒤: removed.구성보정, 원래: b0.구성보정 });

  // ── ④ 저장 구성으로 세워도 파츠가 반영된 값으로 온다 ─────────────
  await pg.evaluate((ms, pn) => {
    localStorage.setItem('gbo2-offline-builds', JSON.stringify([{
      id: 'probe', name: '검사용 구성', ms, parts: [pn], stage: 6, ts: Date.now()
    }]));
  }, msB.MS名, shootPart.name);
  const viaBuild = await pg.evaluate(async () => {
    const w = x => new Promise(r => setTimeout(r, x));
    const Duel = window.GBO2Duel, S = Duel.state;
    Duel.open(); await w(400);
    S.R.pickMs = true; S.R.ms = null;
    Duel.use({}); await w(600);
    const sel = [...document.querySelectorAll('.duel-side[data-side="R"] select')]
      .find(x => /저장 구성에서/.test((x.options[0] || {}).textContent || ''));
    if (!sel) { Duel.close(); return { 오류: '저장 구성 드롭다운이 없다' }; }
    sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await w(900);
    const cells = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-corr')]
      .map(e => ({ ko: (e.querySelector('i') || {}).textContent,
        구성값: (e.querySelector('input') || {}).placeholder }));
    const out = { 파츠: S.R.parts.map(p => p.name), 칸: cells };
    Duel.close();
    return out;
  });
  ok('저장 구성의 파츠가 들어왔다', (viaBuild.파츠 || []).length === fit.length,
    { 들어온것: viaBuild.파츠, 들어가야: fit.map(p => p.name), 오류: viaBuild.오류 });
  const bCell = (viaBuild.칸 || []).find(c => c.ko === '사격');
  ok('저장 구성은 파츠가 반영된 보정으로 온다',
    !!bCell && Number(bCell.구성값) === corrOf(msB, fit, 6),
    { 앱: bCell && bCell.구성값, 계산: corrOf(msB, fit, 6), 파츠없이: corrOf(msB, [], 6) });

  // ── ⑤ 손으로 넣은 값은 **그 칸만** · 무장을 바꿔도 지켜진다 ───────
  const held = await pg.evaluate(async () => {
    const w = x => new Promise(r => setTimeout(r, x));
    const Duel = window.GBO2Duel, S = Duel.state;
    Duel.open(); await w(400);
    S.R.corr = { shoot: null, melee: null };
    Duel.use({}); await w(400);
    /* **칸에 타이핑한다.** 상태를 직접 넣으면 입력 처리기를 지나지 않아,
       「한 칸을 넣으면 두 칸이 같이 묶이는」 회귀를 심어도 안 운다(심어 보고 알았다). */
    const si = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-corr')]
      .map(e => ({ ko: (e.querySelector('i') || {}).textContent, inp: e.querySelector('input') }))
      .find(x => x.ko === '사격');
    if (!si) { Duel.close(); return { 오류: '사격 칸이 없다' }; }
    si.inp.value = '999';
    si.inp.dispatchEvent(new Event('input', { bubbles: true }));
    await w(500);
    // 무장을 바꿔 본다 — 손으로 넣은 값은 그대로여야 한다
    const ws = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-w')];
    if (ws[1]) { ws[1].click(); Duel.use({}); await w(400); }
    const cells = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-corr')]
      .map(e => ({ ko: (e.querySelector('i') || {}).textContent,
        값: (e.querySelector('input') || {}).value,
        구성값: (e.querySelector('input') || {}).placeholder,
        켜짐: e.classList.contains('on') }));
    const out = { 칸: cells, corr: { ...S.R.corr } };
    const b2 = [...document.querySelectorAll('.duel-side[data-side="R"] .d-btn')]
      .find(x => /자동으로/.test(x.textContent));
    out.자동단추 = !!b2;
    if (b2) { b2.click(); Duel.use({}); await w(400); out.누른뒤 = { ...S.R.corr }; }
    Duel.close();
    return out;
  });
  const hs = (held.칸 || []).find(c => c.ko === '사격');
  const hm = (held.칸 || []).find(c => c.ko === '격투');
  ok('손으로 넣은 값은 무장을 바꿔도 지켜진다', !!hs && hs.값 === '999' && hs.켜짐 === true, held);
  ok('사격 칸을 넣어도 격투 칸은 자동 그대로다',
    !!hm && hm.값 === '' && hm.켜짐 === false, held);
  ok('「↺ 자동으로」 가 나오고, 누르면 두 칸이 풀린다',
    held.자동단추 === true && held.누른뒤 && held.누른뒤.shoot == null && held.누른뒤.melee == null,
    held);

  // ── ⑥ 기체를 바꾸면 손으로 넣은 값이 풀린다 ──────────────────────
  const afterSwap = await pg.evaluate(async () => {
    const w = x => new Promise(r => setTimeout(r, x));
    const Duel = window.GBO2Duel, S = Duel.state;
    Duel.open(); await w(400);
    S.R.corr = { shoot: 999, melee: 888 };
    Duel.use({}); await w(400);
    // 화면의 「⇄ 기체 변경」 → 목록에서 고른다 (setMs 를 거쳐야 풀린다)
    const chg = [...document.querySelectorAll('.duel-side[data-side="R"] .d-btn')]
      .find(x => /기체 변경/.test(x.textContent));
    if (!chg) { Duel.close(); return { 오류: '기체 변경 단추가 없다' }; }
    chg.click(); Duel.use({}); await w(500);
    const row = document.querySelector('.duel-side[data-side="R"] .ds-msrow');
    if (!row) { Duel.close(); return { 오류: '기체 줄이 없다' }; }
    row.click(); await w(700);
    const out = { corr: { ...S.R.corr }, 기체: S.R.ms && S.R.ms.MS名 };
    Duel.close();
    return out;
  });
  ok('기체를 바꾸면 손으로 넣은 값이 풀린다 (두 칸 다)',
    !afterSwap.오류 && afterSwap.corr.shoot == null && afterSwap.corr.melee == null, afterSwap);

  ok('콘솔 오류가 없다', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
