// 아이콘(src/icons.js)이 **제자리에, 한 번씩, 뜻을 잃지 않고** 붙는가 — 실측.
//   node tools/icon_check.js
//
// ■ 왜 — 2026-10-15 아이콘을 앱에 넣었다(사용자 확정 시안). 아이콘은 조용히 틀린다:
//   · 이름을 잘못 적으면 icons.js 가 빈 글자를 돌려준다 — 화면은 안 깨지고 아이콘만 사라진다.
//   · 「아이콘만」 칸은 글자를 감춘다. 이름(title)이 빠지면 무슨 뜻인지 알 길이 없고,
//     폰은 올려 볼 수가 없어 글자를 보여야 한다(CSS 가 hover 기기에서만 감춘다).
//   · 같은 칸을 두 번 그리면 아이콘이 두 개 붙는다.
//   · 번개는 자동 구성 전용이다(사용자 결정) — DPS 에 다시 붙으면 뜻이 둘이 된다.
// ■ 아이콘 이름은 코드에서 이렇게만 적는다(이 검사가 그 꼴을 읽는다):
//     ICON.prepend(x, 'name') · ICON.only(x, 'name') · ICON.el('name') · ICON.svg('name')
//     { ic: 'name' } · 이름표는 `const XXX_IC = { 키: 'name', … }` 또는 `[[/정규식/, 'name'], …]` · HTML 은 data-ic="name"
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = require('./lib/duelgate.js');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* ── 1. 코드에 적힌 아이콘 이름이 다 정의돼 있는가(브라우저 없이) ── */
require(path.join(ROOT, 'src', 'icons.js'));
const ICON = globalThis.GBO2Icons;
{
  const used = new Map();   // 이름 → 처음 나온 곳
  const add = (n, where) => { if (!used.has(n)) used.set(n, where); };
  for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
    if (!/\.(js|html)$/.test(f) || f === 'icons.js') continue;
    const s = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
    const pats = [
      /ICON\.(?:prepend|only)\([^,()]+(?:\([^()]*\))?[^,()]*,\s*'(\w+)'/g,
      /ICON\.(?:el|svg)\(\s*'(\w+)'/g,
      /\bic:\s*'(\w+)'/g,
      /data-ic="(\w+)"/g,
    ];
    for (const re of pats) for (const m of s.matchAll(re)) add(m[1], f);
    for (const m of s.matchAll(/const\s+\w+_IC\s*=\s*\{([^}]*)\}/g))
      for (const v of m[1].matchAll(/:\s*'(\w+)'/g)) add(v[1], f);
    // 배열 꼴 — const XXX_IC = [ [/정규식/, 'name'], … ];
    for (const m of s.matchAll(/const\s+\w+_IC\s*=\s*\[([\s\S]*?)\];/g))
      for (const v of m[1].matchAll(/\/,\s*'(\w+)'/g)) add(v[1], f);
  }
  for (const v of Object.values(ICON.ATTR)) add(v, 'icons.js ATTR');
  for (const v of Object.values(ICON.MS_ATTR)) add(v, 'icons.js MS_ATTR');
  add('rarity', 'ui.js rarityChip');
  const missing = [...used].filter(([n]) => !ICON.has(n));
  ok('코드에 적힌 아이콘 이름이 모두 정의돼 있다 (' + used.size + '개)', used.size > 0 && !missing.length, missing);
  ok('svg() 는 없는 이름에 빈 글자를 돌려준다', ICON.svg('없는이름') === '');
}

/* ── 2. 화면에서 ── */
let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); finish(); }
const CHROME = findChrome && findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); finish(); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); finish(); }
const URL = 'file:///' + FILE.split(path.sep).join('/').split(' ').join('%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function finish() {
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

/* F91 — 실탄·빔·격투·실드와 경직 태그가 다 있는 기체 */
async function openInfo(pg) {
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = 'F91'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(600);
  await pg.evaluate(() => {
    const c = [...document.querySelectorAll('#msList .ms-card')].find(e => /^F91_LV/.test(e.dataset.ms || ''));
    c.querySelector('.ms-info').click();
  });
  await sleep(1500);
}
/* 문서 전체 — 한 요소의 바로 아래에 아이콘이 둘 이상 붙었는가 */
const doubled = () => [...document.querySelectorAll('*')]
  .filter(e => [...e.children].filter(c => c.matches('svg.ic')).length > 1)
  .map(e => e.className + ' 「' + e.textContent.trim().slice(0, 16) + '」').slice(0, 5);
/* 아이콘만 칸 — 이름·글자·글자가 보이는 폭 */
const onlyCells = () => [...document.querySelectorAll('.ic-only')].filter(e => e.getClientRects().length).map(e => {
  const tx = e.querySelector(':scope > .tx');
  return { title: e.title, tx: tx ? tx.textContent : null, txW: tx ? tx.getBoundingClientRect().width : -1,
    ic: !!e.querySelector(':scope > svg.ic') };
});

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  try {
    /* ── 데스크톱(마우스) ── */
    const pg = await br.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
    await pg.setViewport({ width: 1500, height: 1300, deviceScaleFactor: 1 });
    await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2400);
    ok('앱에 아이콘 모듈이 실렸다', await pg.evaluate(() => !!(window.GBO2Icons && window.GBO2Icons.has('beam'))));

    /* ⑥ 상단바 — 이모지 대신 SVG. 단추는 기체 선택 화면에서도 DOM 에 있다(접혀 있어도). */
    const tb = await pg.evaluate(() => {
      const want = { openAuto: 'auto', compareBtn: 'compare', duelBtn: 'duel', exportMenuBtn: 'exportI', galleryBtn: 'gallery',
        patchBtn: 'patch', codexBtn: 'codex', tokenBtn: 'token', planBtn: 'plan' };
      const emoji = /[←-⯿\u{1F000}-\u{1FAFF}]/u;
      return Object.entries(want).map(([id, ic]) => { const b = document.getElementById(id);
        return { id, want: ic, got: b ? (b.querySelector(':scope > svg.ic') || {}).dataset?.ic || null : '없음',
          emoji: b ? emoji.test(b.textContent.replace('▾', '')) : false }; });
    });
    ok('상단바 단추 9개 — 정해 둔 SVG 아이콘, 이모지 없음', tb.every(t => t.got === t.want && !t.emoji), tb.filter(t => t.got !== t.want || t.emoji));

    /* ② 기체 속성 · 등급 — 기체 카드(점 → 속성 아이콘, 별 → 등급 칩) · 속성 필터 칩 */
    const cards = await pg.evaluate(() => [...document.querySelectorAll('#msList .ms-card')].slice(0, 40).map(c => {
      const m = window.GBO2_DATA.msData.find(x => x.MS名 === c.dataset.ms) || {};
      const ic = c.querySelector('.meta svg.attr-ic');
      const st = c.querySelector('.meta .stars');
      return { ms: c.dataset.ms, attr: m.属性 || '', ic: ic ? ic.dataset.ic : null, dot: !!c.querySelector('.meta .dot'),
        rar: (m.レアリティ || '').length, chip: st ? st.textContent.trim() : null, chipCls: st ? st.className : null, title: st ? st.title : null };
    }));
    const MSA = { '強襲': 'assault', '汎用': 'general', '支援': 'support' };
    const badCard = cards.filter(c => (MSA[c.attr] || null) !== c.ic || (MSA[c.attr] && c.dot));
    ok('기체 카드 — 색 점 대신 그 속성 아이콘 (' + cards.length + '장)', cards.length >= 20 && !badCard.length, badCard.slice(0, 3));
    const badRar = cards.filter(c => c.rar && (c.chip !== String(c.rar) || !/rar/.test(c.chipCls) || !/성/.test(c.title || '')));
    ok('기체 카드 — 등급은 「별 + 숫자」 칩(이름은 title)', cards.some(c => c.rar) && !badRar.length, badRar.slice(0, 3));
    const chips = await pg.evaluate(() => [...document.querySelectorAll('#attrChips .chip')].map(c => ({ t: c.textContent.trim(), ic: (c.querySelector('svg.ic') || {}).dataset?.ic || null })));
    const wantChip = { '강습': 'assault', '범용': 'general', '지원': 'support', '전체': null };
    ok('속성 필터 칩 — 속성 아이콘 + 글자', chips.length === 4 && chips.every(c => wantChip[c.t] === c.ic), chips);

    await openInfo(pg);
    const info = await pg.evaluate(() => [...document.querySelectorAll('#selInfo .mi-w')].map(w => {
      const ty = w.querySelector('.ty');
      return { nm: w.querySelector('.nm').textContent, ty: ty.textContent.trim(), ic: (ty.querySelector('svg.ic') || {}).dataset?.ic || null,
        tags: [...w.querySelectorAll('.mi-wtag')].map(t => ({ t: t.textContent.trim(), ic: (t.querySelector('svg.ic') || {}).dataset?.ic || null, only: t.classList.contains('ic-only') })) };
    }));
    const ATTR = { '실탄': 'solid', '빔': 'beam', '격투': 'melee' };
    const badTy = info.filter(r => (ATTR[r.ty] || null) !== r.ic);
    ok('기체 정보 무장 목록 — 유형 칸에 그 속성 아이콘이 붙는다(실드·기타는 글자만) (' + info.length + '줄)',
      info.length >= 8 && !badTy.length && info.some(r => r.ty === '실드' && !r.ic), badTy);
    const stag = info.flatMap(r => r.tags).filter(t => t.t === '경직');
    ok('기체 정보 무장 목록 — 「경직」 태그는 경직 아이콘만', stag.length >= 2 && stag.every(t => t.ic === 'stagger' && t.only), stag);
    /* ④ 기체 정보 — 성능 12줄 · 파츠 칸 · 출격 환경 · 스킬 분류 */
    const mi = await pg.evaluate(() => {
      const icOf = e => (e.querySelector(':scope > svg.ic') || {}).dataset?.ic || null;
      return {
        st: [...document.querySelectorAll('#selInfo .mi-st > i')].map(e => ({ t: e.textContent.trim(), ic: icOf(e), cut: e.scrollWidth > e.clientWidth + 1 })),
        slot: [...document.querySelectorAll('#selInfo .mi-slot > i')].map(e => icOf(e)),
        env: [...document.querySelectorAll('#selInfo .env-g, #selInfo .env-s')].map(e => [e.textContent.trim(), icOf(e)]),
        cat: [...document.querySelectorAll('#selInfo .mi-skcatbtn, #selInfo .mi-skcat')].map(e => [e.childNodes[e.childNodes.length - 1 - (e.querySelector('u') ? 1 : 0)]?.textContent?.trim() || e.textContent.trim(), icOf(e)]),
      };
    });
    ok('기체 정보 성능 — 12줄(HP ~ 재출격) 모두 아이콘', mi.st.length === 12 && mi.st.every(r => r.ic), mi.st.filter(r => !r.ic));
    ok('기체 정보 성능 — 아이콘 때문에 이름이 잘리지 않는다', mi.st.every(r => !r.cut), mi.st.filter(r => r.cut));
    ok('파츠 칸 — 근접 · 중거리 · 원거리 = 호 1 · 2 · 3겹', mi.slot.join() === 'near,mid,far', mi.slot);
    ok('출격 · 적성 — 지상 = 산 · 우주 = 행성', mi.env.length >= 2 && mi.env.every(([t, ic]) => ic === ({ '지상': 'ground', '우주': 'space' })[t]), mi.env);
    const catWant = { '기동': 'mob', '공격': 'atk', '방어': 'def', '전체': null, '기타': null };
    ok('스킬 분류 — 기동 · 공격 · 방어에 파츠 분류와 같은 아이콘', mi.cat.length >= 3 && mi.cat.every(([t, ic]) => !(t in catWant) || catWant[t] === ic), mi.cat);
    const cells = await pg.evaluate(onlyCells);
    ok('아이콘만 칸 — 이름(title)과 글자가 남아 있다 (' + cells.length + '칸)',
      cells.length >= 10 && cells.every(c => c.ic && c.title && c.tx && c.title === c.tx), cells.filter(c => !(c.ic && c.title && c.tx && c.title === c.tx)).slice(0, 3));
    ok('아이콘만 칸 — 마우스 기기에서는 글자가 눈에 안 보인다', cells.every(c => c.txW <= 1), cells.filter(c => c.txW > 1).slice(0, 3));

    await pg.evaluate(() => document.querySelector('#infoGo').click());
    await sleep(1400);
    const build = await pg.evaluate(() => {
      const icOf = e => (e.querySelector(':scope > svg.ic') || {}).dataset?.ic || null;
      return { stat: [...document.querySelectorAll('#statBody .stat-row .label')].map(e => [e.textContent.trim(), icOf(e), e.scrollWidth > e.clientWidth + 1]),
        tabs: [...document.querySelectorAll('#tabs .chip')].map(e => [e.textContent.trim(), icOf(e)]),
        tabIcShown: [...document.querySelectorAll('#tabs .chip > svg.ic')].filter(i => i.getClientRects().length).length };
    });
    ok('파츠 화면 성능 표 — 11줄 모두 아이콘, 잘림 없음', build.stat.length === 11 && build.stat.every(([, ic, cut]) => ic && !cut), build.stat.filter(([, ic, cut]) => !ic || cut));
    const tabWant = { '전체': null, '방어': 'def', '공격': 'atk', '이동': 'mob', '보조': 'sup', '특수': 'spc' };
    ok('파츠 분류 탭 — 분류 아이콘 + 글자(넓은 칸에서는 보인다)', build.tabs.length === 6 && build.tabs.every(([t, ic]) => tabWant[t] === ic) && build.tabIcShown === 5, build);
    const table = await pg.evaluate(() => [...document.querySelectorAll('#weaponList .w-type')].map(e => ({
      cls: [...e.classList].find(c => c.startsWith('type-')), ic: (e.querySelector('svg.ic') || {}).dataset?.ic || null,
      w: Math.round(e.getBoundingClientRect().width), over: e.scrollWidth > e.clientWidth + 1 })));
    const wantIc = c => ({ 'type-solid': 'solid', 'type-beam': 'beam', 'type-melee': 'melee' })[c] || null;
    ok('무장 표 — 유형 칸에 그 속성 아이콘 (' + table.length + '칸)', table.length >= 8 && table.every(t => t.ic === wantIc(t.cls)), table.filter(t => t.ic !== wantIc(t.cls)));
    ok('무장 표 — 유형 칸이 넘치지 않는다', table.every(t => !t.over), table.filter(t => t.over));
    ok('무장 표 — 유형 칸 폭이 고르다', new Set(table.map(t => t.w)).size === 1, [...new Set(table.map(t => t.w))]);
    /* ③ 표 머리 · 상세 항목 이름 · 설명 칩 — 베스바 x2(동시 · 경직 · 관통 · 실드 무시가 다 있다) */
    const head = await pg.evaluate(() => [...document.querySelectorAll('.weapon-head span')].map(e => (e.querySelector('svg.ic') || {}).dataset?.ic || null).filter(Boolean));
    ok('무장 표 머리 — 다섯 칸에 아이콘', head.join() === 'cooldown,heat,stagger,range,reload', head);
    const vs = await pg.evaluate(async () => {
      const row = [...document.querySelectorAll('#weaponList .weapon')].find(r => /베스바 x2/.test(r.textContent) && !/조사/.test(r.textContent));
      row.click();
      await new Promise(r => setTimeout(r, 500));
      const det = row.nextElementSibling;
      const icOf = e => (e.querySelector(':scope > svg.ic') || {}).dataset?.ic || null;
      return { mult: icOf(row.querySelector('.w-mult')),
        keys: [...det.querySelectorAll('.wd-k')].map(e => [e.textContent.trim(), icOf(e)]),
        chips: [...det.querySelectorAll('.wd-chip')].map(e => [e.textContent.trim(), icOf(e)]) };
    });
    const chipIc = Object.fromEntries(vs.chips);
    ok('「2발 동시」 태그에 동시 발사 아이콘', vs.mult === 'dual', vs.mult);
    const keyIc = Object.fromEntries(vs.keys);
    ok('상세 항목 이름 — 누적치 · 전환 시간 · 사거리에 표 머리와 같은 아이콘',
      keyIc['누적치'] === 'stagger' && keyIc['전환 시간'] === 'cooldown' && keyIc['사거리'] === 'range' && keyIc['논차지 위력'] === null, vs.keys);
    const wantChips = { '2발 동시 발사': 'dual', '즉시발사 경직 있음': 'stagger', '집속 시 유닛 관통 효과 있음': 'pierce',
      '집속시 공격 대상의 실드 무시': 'shieldX', '사격 시 정지': null, '집속 가능': null };
    const badChip = Object.entries(wantChips).filter(([t, ic]) => chipIc[t] !== ic);
    ok('설명 칩 — 정해 둔 것에만, 실드 무시는 실드 무시 아이콘(방패 아님)', vs.chips.length >= 8 && !badChip.length, { badChip, chips: vs.chips });
    const dps = await pg.evaluate(() => [...document.querySelectorAll('.w-dps')].map(e => e.textContent));
    ok('DPS 에 번개가 없다(번개는 자동 구성 전용) (' + dps.length + '칸)', dps.length > 0 && dps.every(t => !t.includes('⚡')), dps.slice(0, 3));

    await pg.evaluate(() => window.GBO2Duel.open());
    await sleep(1500);
    const duel = await pg.evaluate(() => [...document.querySelectorAll('.ds-wlist .w-type')].map(e => ({
      cls: [...e.classList].find(c => c.startsWith('type-')), ic: (e.querySelector('svg.ic') || {}).dataset?.ic || null,
      over: e.scrollWidth > e.clientWidth + 1 })));
    const dpick = await pg.evaluate(async () => {
      const side = document.querySelector('.duel-side[data-side="R"]') || document.querySelector('.duel-side');
      const b = [...side.querySelectorAll('button')].find(e => /기체 변경/.test(e.textContent));
      if (b) b.click();
      await new Promise(r => setTimeout(r, 700));
      const chips = [...side.querySelectorAll('.ds-mf-row')][0];
      const rows = [...side.querySelectorAll('.ds-msrow small')].slice(0, 30);
      return { chips: chips ? [...chips.querySelectorAll('.chip')].map(c => ({ t: c.textContent.trim(), ic: (c.querySelector('svg.ic') || {}).dataset?.ic || null })) : [],
        rows: rows.map(s => ({ t: s.textContent.trim().split(' · ')[0], ic: (s.querySelector('svg.ic') || {}).dataset?.ic || null })) };
    });
    ok('대결 기체 고르기 — 속성 칩에 속성 아이콘', dpick.chips.length === 4 && dpick.chips.every(c => wantChip[c.t] === c.ic), dpick.chips);
    const KO = { '강습': 'assault', '범용': 'general', '지원': 'support' };
    ok('대결 기체 고르기 — 목록 줄에 속성 아이콘 (' + dpick.rows.length + '줄)', dpick.rows.length >= 10 && dpick.rows.every(r => (KO[r.t] || null) === r.ic), dpick.rows.filter(r => (KO[r.t] || null) !== r.ic).slice(0, 3));
    ok('대결 무장 목록 — 유형 칸에 그 속성 아이콘 (' + duel.length + '칸)', duel.length >= 4 && duel.every(t => t.ic === wantIc(t.cls) && !t.over), duel.filter(t => t.ic !== wantIc(t.cls) || t.over));
    /* ⑤ 대결 카드 — 베스바 x2［조사］: 경직 · 실드 무시 · 관통 · 상대 내빔 감소가 다 있다 */
    const rr = await G.measure(pg, { me: 'F91_LV1', foe: 'ジム_LV1', weapon: 'ヴェスバー.*照射' });
    await sleep(500);
    const dc = await pg.evaluate(() => {
      const icOf = e => (e.querySelector(':scope > svg.ic') || {}).dataset?.ic || null;
      document.querySelectorAll('.dc-formula').forEach(d => { d.open = true; });
      return { react: [...document.querySelectorAll('.dc-react')].map(e => [e.textContent.trim(), icOf(e)]),
        conds: [...document.querySelectorAll('.fx-cond b')].map(e => [e.textContent.trim(), icOf(e)]),
        charge: [...document.querySelectorAll('.dc-chips span')].filter(e => /집속\)/.test(e.textContent)).map(e => icOf(e)) };
    });
    ok('대결 — 무장을 세웠다', rr && !rr.오류, rr && rr.오류);
    ok('대결 반응 배지 — 경직 = 파형 · 강경직 = 두 겹 파형', dc.react.length >= 1 && dc.react.every(([t, ic]) => ic === (/강경직/.test(t) ? 'stagger2' : 'stagger')), dc.react);
    const condIc = Object.fromEntries(dc.conds.map(([t, ic]) => [t.replace(/\s.*$/, ''), ic]));
    ok('대결 계산식 조건 — 실드 무시 · 관통 · 상대 내성 감소에 각 아이콘',
      condIc['실드'] === 'shieldX' && condIc['관통'] === 'pierce' && dc.conds.some(([t, ic]) => /^상대 내빔/.test(t) && ic === 'foeArmor'), dc.conds);
    ok('대결 위력 칩 — 「(집속)」 이면 집속 아이콘', dc.charge.every(ic => ic === 'charge'), dc.charge);
    // 기체를 바꿔 다시 그려도 아이콘이 하나씩이어야 한다
    await pg.evaluate(() => { const d = window.GBO2Duel; d.close(); d.open(); });
    await sleep(800);
    const dbl = await pg.evaluate(doubled);
    ok('한 요소에 아이콘이 두 번 붙지 않는다', !dbl.length, dbl);
    ok('페이지 오류 없음', !errs.length, errs);
    await pg.close();

    /* ── 폰(터치) — 올려 볼 수 없으니 아이콘만 칸도 글자를 보인다 ── */
    const ph = await br.newPage();
    await ph.emulate({ viewport: { width: 390, height: 1600, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36' });
    await ph.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await sleep(2400);
    await openInfo(ph);
    const pc = await ph.evaluate(onlyCells);
    ok('폰 — 아이콘만 칸도 글자가 보인다 (' + pc.length + '칸)', pc.length >= 10 && pc.every(c => c.txW > 4), pc.filter(c => c.txW <= 4).slice(0, 3));
    await ph.evaluate(() => document.querySelector('#infoGo').click());
    await sleep(1400);
    /* 탭 줄이 칸을 넘치면 「특수」 가 잘린다(아이콘을 붙였을 때 387px > 376px 칸).
       탭을 화면으로 끌어와서 보면 안 된다 — 끌어오면 잘린 것도 보인다. 넘침 자체를 잰다. */
    const ptabs = await ph.evaluate(() => {
      const t = document.querySelector('#tabs');
      let p = t.parentElement;
      while (p && p !== document.body && getComputedStyle(p).overflowX === 'visible') p = p.parentElement;
      const box = (p && p !== document.body ? p : document.documentElement).getBoundingClientRect();
      const tabs = [...t.querySelectorAll('.chip')].map(e => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), over: Math.round(r.right - box.right) }; });
      return { scroller: p && p !== document.body ? (p.className || p.id) + ' ' + p.scrollWidth + '/' + p.clientWidth : 'page', overflow: p && p !== document.body ? p.scrollWidth - p.clientWidth : 0, tabs };
    });
    ok('폰 — 파츠 분류 탭이 칸을 넘치지 않는다(「특수」 까지 보인다)', ptabs.tabs.length === 6 && ptabs.overflow <= 1 && ptabs.tabs.every(t => t.over <= 1), ptabs);
    await ph.close();
  } finally {
    await br.close();
  }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
