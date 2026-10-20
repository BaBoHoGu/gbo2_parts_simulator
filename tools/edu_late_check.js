// 교육형 컴퓨터의 「4분 경과」 값이 계산에 실제로 들어가는가.
//   node tools/edu_late_check.js
//
// ■ 왜 — 원문 설명은 「4분 경과하면 효과가 상승」 이라고만 적고 상승 폭이 없다. 그래서 앱은
//   초반 수치만 셌다(2026-10-20 사용자 지적). 4분 뒤 값은 위키 상세 페이지 備考 의 실측값이고
//   core.MODE_PARTS 의 lateDesc 가 설명의 수치를 바꿔 넘긴다 — 파서(damage.js · partDamageCuts)는
//   설명을 읽으므로 그것만으로 4분 뒤 값이 된다.
// ■ 이 검사가 우는 때
//   · 원문 문구가 바뀌어 치환이 안 걸릴 때(조용히 초반 값으로 남는다)
//   · 시점 전환(partsAt)을 거치지 않는 계산 경로가 생겨 4분 뒤 값이 안 들어갈 때
//   · [特防] 의 「경직 중일 때만」 추가분이 상시 경감으로 새어 들어갈 때
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));
const D = require(path.join(ROOT, 'src', 'damage.js'));
const parts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'parts.json'), 'utf8'));
const all = Object.values(parts).filter(Array.isArray).flat();
const byName = n => all.find(p => p.name === n);

let pass = 0, fail = 0;
const ok = (l, g, x) => { console.log((g ? '  PASS ' : '  FAIL ') + l + (!g && x !== undefined ? '  — ' + JSON.stringify(x) : '')); g ? pass++ : fail++; };

const SOLID = { name: 'probe', type: 'shooting', attr: 'solid', info: {}, levels: {} };
const MELEE = { name: 'probe', type: 'melee', attr: 'melee', info: {}, levels: {} };
const pct = (p, w, kind) => D.damagePctFor(D.weaponModsOf([p], 1, '汎用', ''), w, kind) || 0;
const cut = (p, scope) => C.partDamageCuts([p], 1).filter(c => c.scope === scope).reduce((s, c) => s + c.pct, 0);

/* 기대값 — 위키 상세 페이지(4278 · 7348 · 7586 · 7504) 備考, [特射] 「둘 다 8%」 는 사용자 확인(2026-10-20) */
const CASES = [
  { name: '教育型コンピューター_LV1', early: { shoot: 3, melee: 3, cutAll: 3 }, late: { shoot: 8, melee: 8, cutAll: 8 } },
  { name: '教育型コンピューター[特射]_LV1', early: { shoot: 4, melee: 0, cutShoot: 4 }, late: { shoot: 8, melee: 0, cutShoot: 8 } },
  { name: '教育型コンピューター[特格]_LV1', early: { shoot: 0, melee: 5, cutMelee: 7 }, late: { shoot: 0, melee: 8, cutMelee: 13 } }
];

for (const c of CASES) {
  const p = byName(c.name);
  ok(c.name + ' — 파츠가 있다', !!p);
  if (!p) continue;
  const m = C.MODE_PARTS[c.name];
  ok(c.name + ' — 4분 전환표에 있다', !!(m && m.lateDesc));
  if (m && m.lateDesc) for (const [from] of m.lateDesc)
    ok(c.name + ' — 원문에 「' + from + '」 가 있다 (치환이 걸린다)', String(p.description).includes(from));
  for (const [when, want] of [['초반', c.early], ['4분 뒤', c.late]]) {
    const q = C.applyPartMode(p, when === '4분 뒤');
    const got = { shoot: pct(q, SOLID, 'shoot'), melee: pct(q, MELEE, 'melee') };
    if ('cutAll' in want) got.cutAll = cut(q, 'all');
    if ('cutShoot' in want) got.cutShoot = cut(q, 'shoot');
    if ('cutMelee' in want) got.cutMelee = cut(q, 'melee');
    ok(c.name + ' — ' + when + ' ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), got);
  }
  // 두 번 거쳐도 같다 — 여러 자리가 겹쳐 불러도 8% 가 또 오르지 않는다
  const twice = C.partsAt(C.partsAt([p], true), true)[0];
  ok(c.name + ' — 4분 전환을 두 번 거쳐도 같다', twice.description === C.applyPartMode(p, true).description);
}

/* [特防] — 4분 뒤 추가분은 「자기가 경직 중일 때만」. 상시 경감은 4분 전후 모두 10 이어야 한다 */
{
  const p = byName('教育型コンピューター[特防]_LV1');
  ok('[特防] — 파츠가 있다', !!p);
  if (p) {
    ok('[特防] — 초반 상시 경감 10%', cut(p, 'all') === 10, cut(p, 'all'));
    ok('[特防] — 4분 뒤에도 상시 경감은 10% (경직 중 추가분은 안 넣는다)',
      cut(C.partsAt([p], true)[0], 'all') === 10, cut(C.partsAt([p], true)[0], 'all'));
  }
}

/* 화면 · 대결 코드가 피해 % 를 읽을 때 시점 전환을 거치는가 — weaponModsOf 를 부르는 자리를 센다.
   새 자리가 생기면 여기서 걸린다(그 자리만 4분 뒤 값을 모르게 된다). */
{
  const uiDir = path.join(ROOT, 'src', 'ui');
  const files = fs.readdirSync(uiDir).filter(f => /\.js$/.test(f)).map(f => path.join(uiDir, f)).concat(path.join(ROOT, 'src', 'duel.js'));
  const raw = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((ln, i) => {
      if (!/weaponModsOf\(|partDamageCuts\(/.test(ln) || /function |\.weaponModsOf\(\)\./.test(ln)) return;
      if (/weaponModsOf\(\s*(equipped \|\| \[\])/.test(ln)) return;            // 실드 HP(교육형과 무관)
      if (/partsAt\(|applyPartMode\(/.test(ln)) return;
      raw.push(path.basename(f) + ':' + (i + 1) + '  ' + ln.trim().slice(0, 90));
    });
  }
  ok('피해 %·경감을 읽는 자리가 모두 「4분 경과」 시점을 거친다', raw.length === 0, raw);
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
