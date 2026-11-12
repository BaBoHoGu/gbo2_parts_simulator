// 「有利カテゴリー…」 — 유리한 병과를 칠 때만 걸리는 공격 스킬을 그때만 거는가.
//   node tools/skilladv_check.js        (먼저 node tools/build.js)
//
// ■ 왜 — 2026-11-11 버그 탐색(ν건담［DFF装備］ 병과 경감을 고치다 같은 부류로 나왔다):
//   ・グリモア（青）(ファーヴニル)   「有利カテゴリーへの与ダメージ ＋10%」 → 상대 가리지 않고 피해 +10%
//   ・対空射撃補助プログラム(6기)    「空中にいる有利カテゴリーの敵機に…与えるダメージを 50% 増加」 → 병과 안 봄
//   ・ウェポンパージ(キャノンガンダム) 「有利カテゴリ補正 ＋20%」 → 아예 빠짐
//   ・能力UP「覚醒」(バンシィ・ノルン) 「有利カテゴリー補正＋15%」 → 다른 수치가 없어 스킬째 빠짐(켤 단추도 없음)
// 「補正 +N%」 은 상성 배율 130% 에 더한다(위키 7000 카테고리 특공: 「130%に＋10%され、140%」).
// 상대가 없는 셈(무장 표 · 성능표)은 병과를 모르니 이 몫을 안 건다 — 대결에서만 센다.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GBO2Browser = require('./lib/browser.js');
const { findChrome } = require('./lib/wiki_fetch.js');
const DG = require('./lib/duelgate.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};
const CORR = { shoot: 50, melee: 50 };   // 스킬의 사격·격투 + 몫이 섞이지 않게 보정을 고정한다

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const pg = await br.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
    await pg.goto('file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20'),
      { waitUntil: 'load', timeout: 180000 });
    await new Promise(r => setTimeout(r, 4000));

    // 켬 ÷ 끔 — 같은 무장 · 같은 보정이라 비율이 곧 스킬 몫이다
    const ratio = async (q, buff) => {
      const off = await DG.measure(pg, { ...q, corr: CORR, melee: false });
      const on = await DG.measure(pg, { ...q, corr: CORR, melee: false, buffs: [buff] });
      if (off.오류 || on.오류) return { 오류: off.오류 || on.오류 };
      return { r: Math.round(on.한발 / off.한발 * 1000) / 1000, 상성: on.상성, 스킬피해: on.스킬피해, 무장: on.무장 };
    };
    const near = (r, w) => r && !r.오류 && Math.abs(r.r - w) <= 0.01;
    const cases = [
      // [이름, 공격, 맞는 쪽, 공격 모드, 스킬, 기대 비율]
      ['그리모어(청) · 강습 상대(유리) +10%', 'ファーヴニル', 'ギャン', null, 'グリモア（青）', 1.1],
      ['그리모어(청) · 범용 상대(동일) 0', 'ファーヴニル', 'ガンダム', null, 'グリモア（青）', 1],
      ['대공 사격 보조 · 범용 상대(유리) +50%', 'ジム・シューター', 'ガンダム', null, '対空射撃補助プログラム', 1.5],
      ['대공 사격 보조 · 강습 상대(불리) 0', 'ジム・シューター', 'ギャン', null, '対空射撃補助プログラム', 1],
      ['웨폰 퍼지 · 범용 상대(유리) 130→150%', 'キャノンガンダム', 'ガンダム', null, 'ウェポンパージ', 1.5 / 1.3],
      ['웨폰 퍼지 · 강습 상대(불리) 0', 'キャノンガンダム', 'ギャン', null, 'ウェポンパージ', 1],
      ['밴시 노른 각성 · 강습 상대(유리) 130→145%', 'バンシィ・ノルン', 'ギャン', 'transform', '能力UP「覚醒」', 1.45 / 1.3],
      ['밴시 노른 각성 · 범용 상대(동일) 0', 'バンシィ・ノルン', 'ガンダム', 'transform', '能力UP「覚醒」', 1]
    ];
    for (const [label, me, foe, form, buff, want] of cases) {
      const r = await ratio({ me, foe, form: form || undefined }, buff);
      ok(label + ' → ×' + Math.round(want * 1000) / 1000, near(r, want), r);
    }
    await DG.close(pg);

    // 상대가 없는 무장 표는 이 몫을 안 건다 — 그리모어를 켜도 표의 스킬 피해% 가 0
    const table = await pg.evaluate(() => {
      const K = window.GBO2_SKILLS || {};
      const sk = (K['ファーヴニル'] || []).find(s => s.name === 'グリモア（青）');
      const e = sk && sk.levels[sk.levels.length - 1];
      return e ? { dmgAny: e.dmgAny, dmgAdvAny: e.dmgAdvAny } : null;
    });
    ok('그리모어(청)은 조건 없는 피해% 가 아니다 (표에 안 걸림)', table && !table.dmgAny && table.dmgAdvAny === 10, table);
    ok('스크립트 오류 없음', errs.length === 0, errs);
  } finally { await br.close(); }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
