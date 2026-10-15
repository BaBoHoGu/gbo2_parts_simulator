// 대결 카드의 **피해량 계산식**과 **완충재 무시** — 실측.
//   node tools/fxdamage_check.js
//
// ■ 왜 — 대결 카드 아래에 계산식을 붙였다(사용자 요청 2026-10-15). 식은 셈을 다시 하지 않고
//   attack() 이 쓴 중간값을 옮겨 적는다 — 그 약속이 깨지면 식과 위 숫자가 갈라진다. 그래서
//   식의 값(기본 피해 · 경감 뒤 · 실효 HP · 깎이는 HP · 격파)이 카드 숫자와 같은지 잰다.
// ■ 같이 고친 것 — 「攻撃対象の(特殊)緩衝材系スキル無視」 무장 34종이 상대 완충재 스킬 경감을
//   그대로 받고 있었다(피해 작게 · 발수 많게). 늘 무시하는 무장과, 무시가 없는 대조 무장을
//   **같은 상대 · 같은 완충재 켬** 으로 재서 한쪽만 깎이는지 본다.
// ■ 원문 문구 — 조건 넷(늘 · 집속 · 하격 · 스킬 발동 중)의 개수를 센다. 새 문구가 생겨
//   읽히지 않으면 개수가 어긋나 운다(조용히 「무시 없음」 으로 떨어지지 않게).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'src', 'damage.js'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* ── ① 원문 문구 (Chrome 없음) ── */
const cases = [
  ['攻撃対象の特殊緩衝材系スキル無視', 'always', true],
  ['集束時攻撃対象の特殊緩衝材系スキル無視', 'charged', true],
  ['下格闘時、攻撃対象の特殊緩衝材系スキル無視', 'down', true],
  ['スキル発動中、攻撃対象の緩衝材系スキル無視', 'skill', false],
];
for (const [t, when, special] of cases) {
  const r = D.bufferIgnoreOf('前 / ' + t + ' / 後');
  ok('문구 「' + t + '」 → ' + when + (special ? ' · 특수만' : ' · 완충재 모두'), !!r && r.when === when && r.special === special, r);
}
ok('완충재 무시가 없는 원문은 null', D.bufferIgnoreOf('ユニット貫通効果有 / よろけ有') === null);

const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'weapons.json'), 'utf8'));
const by = { always: 0, charged: 0, down: 0, skill: 0 }; let mention = 0;
for (const p of Object.values(W)) for (const w of p.weapons || []) {
  const n = (w.info && w.info['備考']) || '';
  if (/緩衝材系スキル無視/.test(n)) mention++;
  const r = D.bufferIgnoreOf(n);
  if (r) by[r.when]++;
}
const read = by.always + by.charged + by.down + by.skill;
ok('「緩衝材系スキル無視」 원문을 모두 읽는다 (' + read + ' / ' + mention + ')', read === mention && mention > 0, by);
/* was = 2026-10-15 셈. 늘면 새 무장이니 괜찮고, 줄면 문구가 바뀌어 못 읽는 것이다 */
ok('조건별 개수가 줄지 않았다 (늘 ≥24 · 집속 ≥4 · 하격 ≥1 · 스킬 ≥5)',
  by.always >= 24 && by.charged >= 4 && by.down >= 1 && by.skill >= 5, by);

/* ── ② 대결 화면 (Chrome) ── */
let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); finish(); }
const CHROME = findChrome && findChrome();
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!CHROME || !fs.existsSync(FILE)) { console.log('SKIP  Chrome 또는 dist 없음'); finish(); }
const GBO2Browser = require('./lib/browser.js');
const G = require('./lib/duelgate.js');
const URL = 'file:///' + FILE.split(path.sep).join('/').split(' ').join('%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function finish() {
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}

/* 상대 쪽 「다리 특수 완충재」 칩을 진짜로 눌러 켠다 — 사용자가 켜는 길 그대로 */
const legBuffer = pg => pg.evaluate(() => {
  const c = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip.def')].find(e => /다리 특수 완충재/.test(e.textContent));
  if (c) c.click();
  return !!c;
});
const now = pg => pg.evaluate(() => {
  const S = window.GBO2Duel.state; const r = window.GBO2Duel.attack(S.L, S.R);
  return r && { per: r.per, perHp: r.perHp, shots: r.shots, factor: r.factor, raw: r.raw, hit: r.hit, eff: r.eff,
    ign: r.cutList.filter(c => c.ignored).length };
});

if (CHROME && fs.existsSync(FILE)) (async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1700, deviceScaleFactor: 1 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2400);

  const pair = {};
  for (const [tag, weapon] of [['bazooka', 'ビーム・バズーカ'], ['rifle', 'B・R［ML］']]) {
    const r = await G.measure(pg, { me: 'V2ガンダム_LV1', foe: 'ドム', weapon });
    if (r.오류) { ok(tag + ' 무장을 골랐다', false, r); continue; }
    const off = await now(pg);
    const clicked = await legBuffer(pg);
    await sleep(300);
    const on = await now(pg);
    pair[tag] = { off, on, clicked };
  }
  if (pair.bazooka && pair.rifle) {
    ok('상대 「다리 특수 완충재 −55%」 칩을 켰다', pair.bazooka.clicked && pair.rifle.clicked);
    ok('완충재 무시 무장(V2 빔 바주카) — 완충재를 켜도 한 발이 그대로다 (' + pair.bazooka.off.per + ' → ' + pair.bazooka.on.per + ')',
      pair.bazooka.on.per === pair.bazooka.off.per && pair.bazooka.on.ign === 1, pair.bazooka);
    ok('대조 무장(V2 빔 라이플) — 완충재를 켜면 줄어든다 (' + pair.rifle.off.per + ' → ' + pair.rifle.on.per + ')',
      pair.rifle.on.per < pair.rifle.off.per && pair.rifle.on.ign === 0, pair.rifle);
  }

  /* 계산식의 값이 카드 숫자와 같은가 — 두 방향 모두 */
  await G.measure(pg, { me: 'ガンダムEz8_LV1', foe: 'ザクⅠ_LV1' });
  await pg.evaluate(() => { const S = window.GBO2Duel.state; const b = document.querySelector('.duel-side[data-side="R"] .ds-w'); if (b) b.click(); window.GBO2Duel.use({}); });
  await sleep(500);
  const fx = await pg.evaluate(() => {
    const S = window.GBO2Duel.state;
    const fmt = v => Number(v).toLocaleString('en-US');
    const out = [];
    for (const [dir, A, B] of [['LR', S.L, S.R], ['RL', S.R, S.L]]) {
      const r = window.GBO2Duel.attack(A, B);
      const card = document.querySelector('.dc-card[data-dir="' + dir + '"]');
      const box = card && card.querySelector('.dc-formula');
      if (!r || !box) { out.push({ dir, none: true, r: !!r, box: !!box }); continue; }
      const val = lb => {
        const li = [...box.querySelectorAll('.fx-steps li')].find(l => (l.querySelector('.fx-lb') || {}).textContent === lb);
        return li ? ((li.querySelector('.fx-val') || {}).textContent || '').replace(/^=\s*/, '') : null;
      };
      out.push({ dir,
        raw: [val('기본 피해'), fmt(r.raw)], hit: [val('상대 경감'), fmt(r.hit)], eff: [val('실효 HP'), fmt(r.eff)],
        perHp: [val('깎이는 HP'), fmt(r.perHp) + ' / 발'], shots: [val('격파'), r.shots + '발'],
        kill: [(card.querySelector('.dc-kill') || {}).firstChild ? card.querySelector('.dc-kill').firstChild.textContent : null, String(r.shots)] });
    }
    return out;
  });
  for (const f of fx) {
    if (f.none) { ok(f.dir + ' 카드에 계산식이 있다', false, f); continue; }
    ok(f.dir + ' 카드에 계산식이 있다', true);
    const bad = ['raw', 'hit', 'eff', 'perHp', 'shots', 'kill'].filter(k => f[k][0] !== f[k][1]).map(k => k + ': 식 ' + f[k][0] + ' / 셈 ' + f[k][1]);
    ok(f.dir + ' 계산식 값이 카드의 셈과 같다 (기본 · 경감 뒤 · 실효 HP · 깎이는 HP · 격파)', bad.length === 0, bad);
  }

  /* 접어 둔 채로 다시 그려도 펼친 상태가 남는가 — 발수 막대를 움직이면 다시 그린다 */
  await pg.evaluate(() => { const d = document.querySelector('.dc-card[data-dir="LR"] .dc-formula'); d.open = true; d.dispatchEvent(new Event('toggle')); });
  await sleep(100);
  await pg.evaluate(() => window.GBO2Duel.use({}));
  await sleep(300);
  const still = await pg.evaluate(() => document.querySelector('.dc-card[data-dir="LR"] .dc-formula').open);
  ok('펼친 계산식이 다시 그려도 펼쳐져 있다', still === true, still);

  await br.close();
  finish();
})().catch(e => { console.error(e); process.exit(1); });
