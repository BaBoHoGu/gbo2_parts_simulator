// 「一度の攻撃で受けるダメージが最大HPの3％以上なら10％、未満なら20％軽減」 — 충격 분산 장갑[耐実弾] 을 대결이 거는가.
//   node tools/hitcut_check.js        (먼저 node tools/build.js)
//
// ■ 왜 — 2026-10-30 신규 파츠. 한 방의 크기로 경감률이 갈려 고정 경감(partDamageCuts)으로 못 넣고,
//   앱 어디에서도 안 셌다(「계산에 반영되지 않는 효과」 고지만). 대결은 한 방과 상대 최대 HP 를 둘 다 알아
//   셀 수 있다 → core.partHitCuts · applyHitCuts 로 판정하고 duel.attack() 이 히트마다 건다(2026-11-13).
//
// 재는 것 — 값을 박지 않고 **관계**로 잰다(어느 무장이 3% 를 넘는지는 데이터가 바뀌면 달라진다):
//   · 파서가 원문을 읽는다 · 문턱 바로 위/아래가 10%/20% 로 갈린다 · 다른 속성엔 안 건다
//   · 대결: 실탄 사격은 「한방전 ÷ 실효 HP」 가 3% 이상이면 ×0.9, 미만이면 ×0.8 (버림) — 두 갈래 다 밟는다
//   · 빔 · 격투는 파츠를 달아도 그대로 · 파츠가 없으면 그대로 · 발수는 바뀐 한 발로 센다
//   · 동시 발사(히트 여럿)도 발마다 같은 판정 · 계산식에 「한 방 경감」 줄이 뜬다
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GBO2Browser = require('./lib/browser.js');
const { findChrome } = require('./lib/wiki_fetch.js');
const DG = require('./lib/duelgate.js');
const C = require(path.join(ROOT, 'src', 'core.js'));

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};
const PART = '衝撃分散装甲[耐実弾]_LV1';

(async () => {
  // ① core — 원문 파싱과 문턱
  const parts = require(path.join(ROOT, 'data', 'parts.json'));
  const p = [].concat(...Object.values(parts).filter(Array.isArray)).find(x => x.name === PART);
  ok('파츠가 데이터에 있다', !!p);
  const hcs = C.partHitCuts && p ? C.partHitCuts([p]) : [];
  ok('원문을 읽는다 (실탄 · 3% · 10/20)', hcs.length === 1 && hcs[0].scope === 'solid'
    && hcs[0].thr === 3 && hcs[0].big === 10 && hcs[0].small === 20, hcs);
  ok('고정 경감(partDamageCuts)으로는 안 샌다', p && C.partDamageCuts([p], 1).length === 0);
  if (C.applyHitCuts && hcs.length) {
    ok('문턱 위(3%) → −10%', C.applyHitCuts(300, 10000, hcs, 'solid').hit === 270);
    ok('문턱 아래(2.99%) → −20%', C.applyHitCuts(299, 10000, hcs, 'solid').hit === 239);
    ok('빔에는 안 건다', C.applyHitCuts(300, 10000, hcs, 'beam').hit === 300);
  } else ok('applyHitCuts 가 있다', false);

  // ② 대결
  const CHROME = findChrome();
  if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(fail ? 1 : 0); }
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const pg = await br.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
    await pg.goto('file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20'),
      { waitUntil: 'load', timeout: 180000 });
    await new Promise(r => setTimeout(r, 4000));

    const FOE = 'ガンダム', ATK = 'ザクⅡ';
    const names = await DG.weaponsOf(pg, { me: ATK, foe: FOE });
    let big = 0, small = 0, tried = 0;
    for (const wn of names) {
      const on = await DG.measure(pg, { me: ATK, foe: FOE, weaponExact: wn, foeParts: [PART] });
      const off = await DG.measure(pg, { me: ATK, foe: FOE, weaponExact: wn });
      if (on.오류 || off.오류) { ok(wn + ' 잴 수 있다', false, on.오류 || off.오류); continue; }
      tried++;
      const solidShot = on.속성 === 'solid' && !on.격투;
      if (!solidShot) {
        ok(wn + ' (' + (on.격투 ? '격투' : on.속성) + ') — 그대로', on.한발 === off.한발 && !on.한방경감, { on: on.한발, off: off.한발 });
        continue;
      }
      const share = on.한방전 / on.내구 * 100;
      const isBig = share >= 3;
      const want = Math.floor(on.한방전 * (isBig ? 0.9 : 0.8));
      isBig ? big++ : small++;
      ok(wn + ' — 한 방 ' + share.toFixed(2) + '% → ' + (isBig ? '−10%' : '−20%'),
        on.한방 === want && on.한방전 === off.한방, { 전: on.한방전, 후: on.한방, 기대: want, 파츠없음: off.한방 });
      ok(wn + ' — 한 발 = 한 방 × 히트 + 고정', on.한발 === on.한방 * on.히트 + on.고정, on);
      if (on.발수 != null && !on.구간) ok(wn + ' — 발수는 바뀐 한 발로', on.발수 === Math.ceil(on.내구 / on.한발), on);
    }
    ok('실탄 사격 무장을 잰다 (' + tried + '종 중 3%↑ ' + big + ' · 3%↓ ' + small + ')', big + small > 0);
    ok('두 갈래(10% · 20%)를 다 밟는다', big > 0 && small > 0, { big, small });

    // 빔 — 건담이 파츠 단 자쿠를 쏜다
    const beam = await DG.measure(pg, { me: FOE, foe: ATK, melee: false, weapon: 'ビーム', foeParts: [PART] });
    const beam0 = await DG.measure(pg, { me: FOE, foe: ATK, melee: false, weapon: 'ビーム' });
    ok('빔 사격은 그대로', !beam.오류 && beam.속성 === 'beam' && beam.한발 === beam0.한발, { beam, beam0 });

    // 계산식 줄
    await DG.measure(pg, { me: ATK, foe: FOE, melee: false, weapon: 'マシンガン', foeParts: [PART] });
    const fx = await pg.evaluate(() => [...document.querySelectorAll('#duelModal .dc-card[data-dir="LR"] .fx-lb')]
      .map(e => e.textContent));
    ok('계산식에 「한 방 경감」 줄이 뜬다', fx.includes('한 방 경감'), fx);
    await DG.close(pg);
    ok('스크립트 오류 없음', errs.length === 0, errs);
  } finally { await br.close(); }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
