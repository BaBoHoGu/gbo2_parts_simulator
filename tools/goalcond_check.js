// 「N발 버티기」 목표가 조건부 파츠 경감(관통·폭풍)을 같은 자로 재는지 실측.
//   node tools/goalcond_check.js
//
// 관통 경감 장갑(-20%)·폭풍 경감 장갑(-15%)은 **상대 무장의 성질에 따라서만** 걸린다.
// 피탄 시뮬은 「격파까지」에 이미 넣고 있는데 자동 구성이 재는 실효 HP 축에서 빠져 있으면,
// 사용자가 본 발수를 그대로 목표로 걸었는데도 「하한 미달」 이 뜬다 — 정작 그 파츠를 뽑으라고
// 만든 기능이 그 파츠를 못 세는 셈이다.
const path = require('path');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const URL = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (!ok && extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};
const num = s => Number(String(s).replace(/,/g, ''));

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  pg.on('dialog', d => d.accept());
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '짐 스나이퍼'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(800);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1400);

  // ── 관통 경감 장갑을 끼우고 잠근다 ────────────────────────────────
  await pg.evaluate(() => { const q = document.querySelector('#partQuery'); q.value = '관통'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  const partName = await pg.evaluate(() => {
    const t = document.querySelector('#partList .part-tile');
    if (!t) return null;
    const nm = t.querySelector('.pt-nm').textContent;
    t.click();
    return nm;
  });
  await sleep(800);
  check('관통 경감 장갑 장착', !!partName, '파츠를 못 찾음');
  // 남은 칸을 아무 파츠로나 채운 뒤 **전부 잠근다**.
  // 잠그지 않으면 자동 구성이 장갑·HP 파츠를 더 넣어 목표를 다른 방법으로 채워 버려,
  // 조건부 경감을 세는지 아닌지가 결과에 드러나지 않는다(그래서 이 점검이 한 번 헛돌았다).
  await pg.evaluate(() => { const q = document.querySelector('#partQuery'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(600);
  await pg.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      const t = [...document.querySelectorAll('#partList .part-tile')]
        .find(x => !x.classList.contains('blocked') && !x.classList.contains('on'));
      if (!t) break;
      t.click();
      await new Promise(r => setTimeout(r, 120));
    }
  });
  await sleep(800);
  const locked = await pg.evaluate(() => {
    const ls = [...document.querySelectorAll('#equipped .eq .lock')];
    ls.forEach(l => l.click());
    return ls.length;
  });
  await sleep(500);
  check('구성을 채우고 전부 잠갔다 (자동 구성이 보충하지 못하게)', locked >= 2, '잠근 파츠 ' + locked + '개');

  // ── 이 파츠가 실제로 피해를 깎는 적 무장을 찾는다 ─────────────────
  // (그 무장이 곧 「관통 성능을 가진 사격 무장」이다 — 이름으로 짐작하지 않고 값으로 고른다)
  await pg.evaluate(() => document.querySelector('#pietanBtn').click());
  await sleep(700);
  // 헤비 건담의 「빔 캐논」 이 ユニット貫通 · 사이코뮤 아님 · 사격 — 관통 경감이 걸리는 조건이다
  await pg.evaluate(() => { const q = document.querySelector('#pietanQuery'); q.value = '헤비 건담'; q.dispatchEvent(new Event('input')); });
  await sleep(800);
  await pg.evaluate(() => { const r = document.querySelector('#pietanModal .pietan-row'); if (r) r.click(); });
  await sleep(1200);
  const found = await pg.evaluate(async () => {
    const n = document.querySelectorAll('#pietanModal .pietan-row').length;
    for (let i = 0; i < n; i++) {
      [...document.querySelectorAll('#pietanModal .pietan-row')][i].click();
      await new Promise(r => setTimeout(r, 450));
      const m = [...document.querySelectorAll('#pietanModal .pietan-metric')].find(x => /격파까지/.test(x.textContent));
      const t = m ? m.textContent.replace(/\s+/g, ' ').trim() : '';
      if (/관통 경감/.test(t)) {
        return { i, text: t, hits: Number((t.match(/격파까지\s*(\d+)발/) || [])[1]) };
      }
    }
    return null;
  });
  if (!found) { check('관통 경감이 걸리는 적 무장을 찾음', false, '헤비 건담 무장 중 없음'); await br.close(); process.exit(1); }
  check('관통 경감이 걸리는 적 무장을 찾음', true);
  console.log('   ' + found.text.slice(0, 170));

  // ── 지금 실제로 버티는 발수를 그대로 목표로 건다 ───────────────────
  const setOk = await pg.evaluate(hits => {
    const g = document.querySelector('.pietan-goal');
    if (!g) return false;
    const inp = g.querySelector('input');
    inp.value = String(hits);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    g.querySelector('.btn-primary').click();
    return true;
  }, found.hits);
  check(`지금 버티는 ${found.hits}발을 그대로 목표로 건다`, setOk);
  await sleep(900);

  const bar = await pg.evaluate(() => (document.querySelector('#autoTargetNote') || {}).textContent || '');
  check('목표가 어느 무장 기준인지 밝힌다', /실효 HP 는 「.+」 기준/.test(bar), bar);
  console.log('   ' + bar);

  // ── 값으로 대조한다 ────────────────────────────────────────────────
  // 통과/실패만 보면 자동 구성이 장갑을 더 넣어 목표를 다른 방법으로 채워 버려 구별이 안 된다.
  // 그래서 '도달 가능한 최댓값'을 숫자로 읽어, 피탄 화면이 보여 준 값과 맞는지 본다.
  //   피탄: 「내구 23,630 … 경감 ×0.8」 → 이 무장에 대한 실효 HP = 23,630 ÷ 0.8 = 29,538
  // 조건부 경감(관통)이 빠져 있으면 이 값이 나오지 않는다.
  // 도달 불가능한 목표를 걸면 후보 카드마다 「하한 미달: 실효 HP 빔 <측정값>/<목표>」 가 붙는다.
  // 그 측정값이 곧 '자동 구성이 이 구성을 어떻게 쟀는가' 다 — 같은 구성을 피탄 화면으로도 재서 맞춰 본다.
  await pg.evaluate(() => {
    const inp = [...document.querySelectorAll('#autoGrid input.auto-tgt')]
      .find(i => i.value && Number(i.value) > 1000);
    if (inp) { inp.value = '99999999'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(400);
  await pg.evaluate(() => document.querySelector('#runAuto').click());
  await sleep(25000);
  const res = await pg.evaluate(() => {
    const c = document.querySelector('#autoResults .auto-cand');
    return {
      n: document.querySelectorAll('#autoResults .auto-cand').length,
      warn: c ? ((c.querySelector('.ac-warn') || {}).textContent || '') : ''
    };
  });
  check('후보가 나온다', res.n > 0);
  const measured = num((res.warn.match(/실효 HP[^\d]*([\d,]+)\s*\//) || [])[1]);
  check('자동 구성이 후보의 실효 HP 를 알려 준다', !!measured, res.warn.slice(0, 120));

  // 그 후보를 실제로 적용하고, 같은 적 무장으로 피탄 화면에서 다시 잰다
  await pg.evaluate(() => { const c = document.querySelector('#autoResults .auto-cand'); if (c) c.click(); });
  await sleep(1500);
  await pg.evaluate(() => document.querySelector('#pietanBtn').click());
  await sleep(1500);
  const now = await pg.evaluate(() => {
    const m = [...document.querySelectorAll('#pietanModal .pietan-metric')].find(x => /격파까지/.test(x.textContent));
    return m ? m.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  const eff = num((now.match(/내구 ([\d,]+)/) || [])[1]);
  const factor = Number((now.match(/경감 ×([\d.]+)/) || [])[1] || 1);
  const expect = Math.round(eff / factor);
  console.log(`   피탄: 내구 ${eff.toLocaleString()} ÷ 경감 ×${factor} = ${expect.toLocaleString()}`);
  console.log(`   자동 구성 측정값: ${measured.toLocaleString()}`);
  check('같은 구성을 두 화면이 같은 값으로 잰다', measured === expect,
    `자동 ${measured.toLocaleString()} ≠ 피탄 ${expect.toLocaleString()}`
    + (/관통 경감/.test(now) ? ' (관통 경감이 한쪽에만 반영됨)' : ''));

  check('스크립트 오류 없음', errs.length === 0, errs.join(' / '));
  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n조건부 경감 목표 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
