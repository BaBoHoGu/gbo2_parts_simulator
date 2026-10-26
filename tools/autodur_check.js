// 자동 구성의 내구 점수가 **섞여 맞는 피해**와 **파츠 % 경감**을 제대로 재는가.
//
//   node tools/autodur_check.js
//
// 2026-10-26 실측 — 예전 점수는 속성별 실효 HP 의 **산술 평균**이라 한 내성을 끝까지 몰수록 점수가 커졌다.
// 「탱커 (범용 방어)」 로 40기를 돌리니 30기가 17/16/70 같은 몰아주기를 골랐고, 섞여 맞을 때 평균 5.7% ·
// 가장 약한 속성으로 14% 덜 버텼다. 또 점수가 % 경감을 아예 안 봐서 160번 돌려 경감 파츠를 **한 번도** 안 골랐다.
// 지금은 HP ÷ Σ 몫 × (1 − 내성) × 경감 배수(조화 평균, optimizer durMix) + 화면이 넘기는 파츠 경감 표(opts.partCuts).
// 값을 박지 않고 **관계**로 잰다(교훈: 값으로 재면 우연히 같은 자리에서 통과한다).
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));
const O = require(path.join(ROOT, 'src', 'optimizer.js'));
const { readUi } = require('./lib/uisrc.js');
const rd = f => require(path.join(ROOT, 'data', f));
const msData = rd('msData.json'), byCat = rd('parts.json'), fullst = rd('fullst.json');
const allParts = Object.values(byCat).flat();
const P = n => allParts.find(p => p.name.normalize('NFC') === n);
const MS = n => msData.find(m => m.MS名.normalize('NFC') === n);

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra != null ? '  ' + JSON.stringify(extra) : '')); }
};
const cutsMapOf = ms => {
  const lv = C.msLevel(ms.MS名), out = {};
  for (const p of allParts) { const c = C.partDamageCuts([p], lv); if (c.length) out[p.name] = c; }
  return out;
};

// ① 섞여 맞을 때 — 세 내성을 같은 무게로 보면 고르게가 몰아주기보다 낫다
const even = { armorRange: 1, armorBeam: 1, armorMelee: 1 };
const lopsided = ['耐実弾装甲_LV3', '耐実弾装甲_LV4', '耐実弾装甲_LV5'].map(P);
const balanced = ['耐実弾装甲_LV4', '耐ビーム装甲_LV4', '耐格闘装甲_LV4'].map(P);
ok('시험 파츠가 다 있다', lopsided.every(Boolean) && balanced.every(Boolean));
const rows = [];
for (const n of ['ガンダム_LV1', 'ザクⅡ改_LV1', 'ジム・コマンド_LV1', 'ドム_LV1']) {
  const ms = MS(n);
  if (!ms) continue;
  const sc = O.makeScorer(ms, { stage: 6, expansion: C.EXPANSION_NONE, expLevel: 1, weights: even }, byCat, fullst);
  rows.push({ n, lop: sc(lopsided).value, bal: sc(balanced).value });
}
ok('세 내성을 같은 무게로 보면 「고르게(30/30/30)」 가 「몰아주기(50/15/15)」 보다 점수가 높다 (4기 모두)',
  rows.length === 4 && rows.every(r => r.bal > r.lop), rows.map(r => r.n + ' 고르게 ' + r.bal.toFixed(2) + ' / 몰아 ' + r.lop.toFixed(2)));

// ② 파츠 % 경감 — 경감 표를 넘기면 그 파츠의 점수가 오른다(안 넘기면 내성만 본다)
const gd = MS('ガンダム_LV1');
const cutPart = P('教育型コンピューター[特防]_LV1');
const base = { stage: 6, expansion: C.EXPANSION_NONE, expLevel: 1, weights: even };
const s0 = O.makeScorer(gd, base, byCat, fullst)([cutPart]).value;
const s1 = O.makeScorer(gd, { ...base, partCuts: cutsMapOf(gd) }, byCat, fullst)([cutPart]).value;
ok('경감 표(partCuts)를 넘기면 경감 파츠(교육형[特防] −10%)의 점수가 오른다', cutPart && s1 > s0, { 표없음: s0, 표있음: s1 });

// ③ 실제로 돌리면 — 탱커 프리셋에서 경감 파츠를 하나라도 고른다(예전 0개)
const top = new Map();
for (const ms of msData) { const b = ms.MS名.replace(/_LV\d+$/, ''); const lv = C.msLevel(ms.MS名); if (!top.has(b) || C.msLevel(top.get(b).MS名) < lv) top.set(b, ms); }
const pool = [...top.values()].sort((a, b) => a.MS名.localeCompare(b.MS名));
const sample = pool.filter((_, i) => i % Math.floor(pool.length / 12) === 0).slice(0, 12);
let picked = 0, spread = [];
for (const ms of sample) {
  const r = O.optimize(ms, { stage: 6, expansion: C.EXPANSION_NONE, expLevel: 1, weights: { ...O.PRESETS['탱커 (범용 방어)'] }, restarts: 1, partCuts: cutsMapOf(ms) }, byCat, fullst);
  picked += C.partDamageCuts(r.parts || [], C.msLevel(ms.MS名)).length;
  const t = r.stats.total;
  spread.push(Math.max(t.armorRange, t.armorBeam, t.armorMelee) - Math.min(t.armorRange, t.armorBeam, t.armorMelee));
}
ok('탱커 프리셋 12기 — 경감 파츠를 하나라도 고른다 (예전 0개)', picked > 0, { 경감: picked });
/* 몰아주기 — 예전엔 최대·최소 내성 차가 50 을 넘는 기체가 흔했다(17/16/70). 바닥만 막는다: 절반을 넘지 않는다. */
ok('탱커 프리셋 12기 — 내성 차가 50 을 넘는 몰아주기가 절반을 넘지 않는다', spread.filter(d => d > 50).length <= 6, { 내성차: spread });

/* ④ 경감 표를 넘겨도 **더 좋은 구성을 놓치지 않는다** — 경감을 넣자 빔 탐색이 경감 파츠 쪽으로 끌려가
   격투 강습 5/40기가 나빠졌다(Ex-S 건담 실효 HP −19.9%). 같은 점수로 매겨 「경감 없이 찾은 구성」 보다 낮으면 놓친 것이다. */
const missed = [];
for (const ms of [MS('Ex-Sガンダム_LV3'), ...sample].filter(Boolean)) {
  const o = { stage: 6, expansion: C.EXPANSION_NONE, expLevel: 1, weights: { ...O.PRESETS['격투 강습'] }, restarts: 1 };
  const cuts = cutsMapOf(ms);
  const sc = O.makeScorer(ms, { ...o, partCuts: cuts }, byCat, fullst);
  const withCuts = sc(O.optimize(ms, { ...o, partCuts: cuts }, byCat, fullst).parts).value;
  const noCuts = sc(O.optimize(ms, o, byCat, fullst).parts).value;
  if (noCuts > withCuts + 1e-9) missed.push(ms.MS名 + ' ' + withCuts.toFixed(3) + ' < ' + noCuts.toFixed(3));
}
ok('격투 강습 13기 — 경감 표를 넘겨 찾은 구성이 경감 없이 찾은 구성보다 (같은 점수로) 낮지 않다', !missed.length, missed);

// ⑤ 화면이 경감 표를 넘긴다 — 자동 구성과 「왜 이 파츠?」 기여도 둘 다(같은 자로 재야 한다)
const ui = readUi(ROOT);
ok('화면의 자동 구성이 partCuts 를 넘긴다', /partCuts:\s*partCutsMap\(\)/.test(ui) && (ui.match(/partCuts:\s*partCutsMap\(\)/g) || []).length >= 2,
  { 횟수: (ui.match(/partCuts:\s*partCutsMap\(\)/g) || []).length });

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
