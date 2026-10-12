// 「조건부 강경직」을 조건부라고 적는가.
//   node tools/stag2_check.js
//
// 사용자 보고(2026-10-10): F89·걍 개량형은 **공중의 적에게만** 강경직인데
// 기체 정보가 그냥 「강경직」이라고 적었다. 늘 걸리는 무장과 구별이 안 된다.
//
// DB 를 재 보니 「강경직」이 적힌 무장 148개 중 **33개가 조건부**다
// (집속 30 · 공중의 적 3). 그중 공중 쪽 셋이 F89 · 카풀(CN) · 걍 개량형이다.
//
// 까다로운 점 — 備考 는 ` / ` 로 끊어 적는데 **조건과 효과가 다른 조각**에 있을 수 있다:
//     … / 공격 대상이 공중에 있는 경우, 다음과 같은 효과를 발휘 / 강경직 있음 / …
// 조각 하나만 보면 「강경직 있음」이라 조건이 안 보인다. 앞 조각이 연 조건을 물려받아야 한다.
// 처음 셀 때 이걸 안 봐서 F89 를 통째로 놓쳤다.
//
// 판정은 src/ui.js 의 stag2Of 하나뿐이다(기체 정보·피탄 시뮬이 같이 쓴다).
// 이 자는 그 함수를 **ui.js 에서 떼어 와** 쓴다 — 베껴 적으면 언젠가 갈린다.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* ── 판정 함수를 ui.js 에서 떼어 온다 ─────────────────────────────── */
const src = fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
const a = src.indexOf('  const STAG2 = /강경직');
const b = src.indexOf('  function weaponTagsOf', a);
ok('ui.js 에서 판정 함수를 떼어 왔다', a > 0 && b > a, { a, b });
const stag2Of = new Function(src.slice(a, b) + '; return stag2Of;')();

/* ── ① 규칙 자체 ──────────────────────────────────────────────── */
ok('강경직이 없으면 null', stag2Of('경직 있음 / 경직치: 50%') === null);
ok('그냥 강경직이면 조건 없음',
  JSON.stringify(stag2Of('연격 불가 / 강경직 있음')) === '{"cond":false}',
  stag2Of('연격 불가 / 강경직 있음'));
ok('같은 조각에 조건이 있으면 조건부',
  (stag2Of('집속 시 강경직 있음') || {}).cond === true);
/* 여기가 핵심 — 조건이 **앞 조각**에 있다(F89 꼴). */
ok('앞 조각이 연 조건을 물려받는다 (F89 꼴)',
  (stag2Of('경직 있음 / 공격 대상이 공중에 있는 경우, 다음과 같은 효과를 발휘 / 강경직 있음') || {}).cond === true,
  stag2Of('경직 있음 / 공격 대상이 공중에 있는 경우, 다음과 같은 효과를 발휘 / 강경직 있음'));
/* 조건 조각이 **뒤에** 있으면 앞의 강경직까지 조건부로 만들면 안 된다. */
ok('뒤에 온 조건은 앞 조각에 걸지 않는다',
  (stag2Of('강경직 있음 / 집속 시 위력 상승') || {}).cond === false,
  stag2Of('강경직 있음 / 집속 시 위력 상승'));
ok('일본어 원문도 같은 답 (피탄 시뮬이 보는 길)',
  (stag2Of('よろけ有 / 集束時大よろけ有') || {}).cond === true
  && (stag2Of('連撃不可 / 大よろけ有') || {}).cond === false,
  [stag2Of('よろけ有 / 集束時大よろけ有'), stag2Of('連撃不可 / 大よろけ有')]);

/* ── ② DB 전체 ────────────────────────────────────────────────── */
const W = rd('data', 'weapons.json');
const NOTE = rd('data', 'i18n', 'weapon_note.json');
const msData = rd('data', 'msData.json');
const I = rd('data', 'i18n', 'ms.json');
const page = new Map();
for (const m of msData) {
  const id = (String(m.wiki_url || '').match(/pages\/(\d+)/) || [])[1];
  if (id && !page.has(id)) page.set(id, I[String(m['MS名']).replace(/_LV\d+$/, '')] || id);
}

let tot = 0, cond = 0;
const air = [];
const koRes = new Map(), jaRes = new Map();
for (const [id, p] of Object.entries(W)) for (const w of p.weapons || []) {
  const ja = (w.info && w.info['備考']) || '';
  if (!ja) continue;
  const ko = NOTE[ja] != null ? NOTE[ja] : ja;
  const key = id + '|' + w.name;
  const rk = stag2Of(ko);
  const rj = stag2Of(String((w.mods && w.mods.stagger) || '') + ' ' + ja);
  if (rk) koRes.set(key, rk.cond);
  if (rj) jaRes.set(key, rj.cond);
  if (!rk) continue;
  tot++;
  if (rk.cond) { cond++; if (!/집속/.test(ko)) air.push(page.get(id) + ' / ' + w.name); }
}
ok('강경직 무장이 꽤 있다', tot > 100, { 무장: tot });
ok('조건부가 하나 이상 있다', cond > 0, { 조건부: cond });
/* 비율이 통째로 흔들리면 규칙이 넓어졌거나 좁아진 것이다 — 자료가 늘어도 비율은 비슷하다. */
ok('조건부 비율이 10~40% 사이다', cond / tot >= 0.1 && cond / tot <= 0.4,
  { 비율: (cond / tot * 100).toFixed(1) + '%', 조건부: cond, 전체: tot });

/* 한국어로 본 답과 원문으로 본 답이 **같아야** 한다 — 화면 둘이 다른 말을 하면 안 된다. */
const diff = [...koRes.keys()].filter(k => jaRes.has(k) && jaRes.get(k) !== koRes.get(k));
ok('한국어와 원문이 같은 답을 낸다', diff.length === 0, diff.slice(0, 5));
ok('원문 쪽에서도 같은 수를 센다', jaRes.size === koRes.size,
  { 한국어: koRes.size, 원문: jaRes.size });

/* 사용자가 짚은 셋 — 공중의 적에게만 걸리는 무장. 늘어나도 줄어도 알아야 한다. */
ok('집속이 아닌 조건부가 셋이고 그 안에 F89·걍 개량형이 있다',
  air.length === 3 && air.some(x => /F89/.test(x)) && air.some(x => /걍 개량형/.test(x)),
  air);

/* ── ③ 화면에서 **진짜로** 그렇게 적히는가 ───────────────────────── */
(async () => {
  const DIST = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  if (!fs.existsSync(DIST)) {
    console.log('  (건너뜀) dist 가 없다 — node tools/build.js 먼저');
  } else {
    const GBO2Browser = require('./lib/browser.js');
    const { findChrome } = require('./lib/wiki_fetch.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const br = await GBO2Browser.launch({ executablePath: findChrome(), headless: 'new',
      args: ['--no-sandbox', '--allow-file-access-from-files'] });
    const pg = await br.newPage();
    await pg.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 });
    await pg.goto('file:///' + DIST.replace(/\\/g, '/').replace(/ /g, '%20'),
      { waitUntil: 'load', timeout: 180000 });
    await sleep(2500);
    const look = async q => pg.evaluate(async (q) => {
      const i = document.querySelector('#msQuery');
      i.value = q; i.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(x => setTimeout(x, 700));
      const ib = document.querySelector('#msList .ms-info');
      if (!ib) return null;
      ib.click();
      await new Promise(x => setTimeout(x, 900));
      const tags = [...document.querySelectorAll('#infoBody .t-stag2')]
        .map(e => e.textContent.replace(/\s+/g, ' ').trim());
      const r = { tags, cond: document.querySelectorAll('#infoBody .t-stag2.cond').length };
      const c = document.querySelector('#infoClose'); if (c) c.click();
      await new Promise(x => setTimeout(x, 350));
      return r;
    }, q);

    const f89 = await look('F89');
    ok('F89 의 강경직은 **전부 조건부로** 적힌다',
      !!f89 && f89.tags.length > 0 && f89.tags.every(t => t === '조건부 강경직'), f89);
    /* 걍 개량형은 둘 다 있다 — 앵커는 늘 강경직, 실드[투척]은 조건부.
       한쪽만 보면 「전부 조건부로 칠했다」는 잘못을 못 잡는다. */
    const gyan = await look('걍 개량형');
    ok('걍 개량형은 조건부와 무조건이 **섞여** 적힌다',
      !!gyan && gyan.tags.includes('조건부 강경직') && gyan.tags.includes('강경직'), gyan);
    const zaku = await look('자쿠Ⅱ');
    ok('늘 강경직인 무장은 그냥 「강경직」이다',
      !!zaku && zaku.tags.length > 0 && zaku.cond === 0 && zaku.tags.every(t => t === '강경직'), zaku);

    /* 피탄 시뮬도 **같은 말**을 해야 한다. 기체 정보만 보면 이쪽을 옛 판정으로
       되돌려도 안 운다 — 실제로 심어서 확인했다. 두 화면이 갈리면 어느 쪽이 맞는지 모른다. */
    const pietan = await pg.evaluate(async () => {
      document.querySelector('#pietanBtn').click();
      await new Promise(r => setTimeout(r, 700));
      const back = document.querySelector('.pietan-back');
      if (back) { back.click(); await new Promise(r => setTimeout(r, 400)); }
      const q = document.querySelector('#pietanQuery');
      if (!q) return null;
      q.value = 'F89'; q.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
      const first = [...document.querySelectorAll('#pietanList > *')]
        .find(x => !/다른 기체|검색 결과/.test(x.textContent));
      if (!first) return null;
      first.click();
      await new Promise(r => setTimeout(r, 1100));
      /* 무장 줄을 **한 번 더 눌러야** 반응 표가 뜬다 — 목록에는 안 그려진다(재서 봤다). */
      const row = [...document.querySelectorAll('#pietanList > *')]
        .find(x => /A 라이플|A·라이플/.test(x.textContent));
      if (!row) return null;
      row.click();
      await new Promise(r => setTimeout(r, 900));
      return [...document.querySelectorAll('.pietan-react')]
        .map(e => e.textContent.replace(/\s+/g, ' ').trim());
    });
    ok('피탄 시뮬도 무장 반응을 적는다', Array.isArray(pietan) && pietan.length > 0, pietan);
    /* F89 의 A·라이플은 공중의 적에게만 강경직이다 — 여기서도 조건부라고 적혀야 한다. */
    ok('피탄 시뮬도 조건부는 조건부라고 적는다',
      Array.isArray(pietan) && pietan.includes('조건부 강경직'),
      pietan);
    await br.close();
  }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
