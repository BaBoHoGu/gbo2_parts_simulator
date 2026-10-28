// 탄약 강화 키트의 동시 장착 금지가 위키 그대로인가 — 두 순서 모두.
//
//   node tools/equipexcl_check.js
//
// 위키 7888(弾薬強化キット) 備考: 「同時装備不可は、クイックローダー、大容量補給パック、イレギュラーDBL、
// 試験型イレギュラーDBL、コネクティングシステム［支援Ⅱ型］。特殊燃焼剤とは、あちらが焼夷効果限定のため同時装備可能。」
// 키트 설명의 「同一効果またはリロード時間を短縮できるパーツとは同時装備不可」 중 리로드 쪽만 규칙으로 읽어
// DBL 둘이 함께 달렸다(사용자 보고 2026-10-28). 금지는 한쪽 순서만 막히기 쉬워 두 순서를 따로 잰다.
// 앱이 쓰는 판정(core.js checkEquip)을 실제 파츠 데이터로 부른다.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));
const P = Object.values(require(path.join(ROOT, 'data', 'parts.json'))).flat();
const ms = require(path.join(ROOT, 'data', 'msData.json')).find(m => String(m.MS名).normalize('NFC') === 'ガンダム_LV1');
const SLOTS = { close: 99, mid: 99, long: 99 };

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra != null ? '  ' + JSON.stringify(extra) : '')); }
};
const byName = re => P.filter(p => re.test(String(p.name).normalize('NFC')));
const blocked = (a, b) => !C.checkEquip(a, ms, [b], SLOTS).ok;

const kit = byName(/^弾薬強化キット/)[0];
ok('시험 기체 · 탄약 강화 키트가 데이터에 있다', !!ms && !!kit);
const banned = [
  ['クイックローダー', byName(/^クイックローダー/)],
  ['大容量補給パック', byName(/^大容量補給パック/)],
  ['イレギュラーDBL', byName(/^イレギュラーDBL/)],
  ['試験型イレギュラーDBL', byName(/^試験型イレギュラーDBL/)],
  ['コネクティングシステム［支援Ⅱ型］', byName(/支援Ⅱ型/)],
];
for (const [label, list] of banned) {
  const bad = list.filter(o => !blocked(kit, o) || !blocked(o, kit)).map(o => o.name);
  ok('키트 ↔ ' + label + ' — 두 순서 모두 막힌다 (' + list.length + '종)', list.length > 0 && !bad.length, bad);
}
const burn = byName(/^特殊燃焼剤/)[0];
ok('키트 ↔ 特殊燃焼剤 — 함께 낄 수 있다(焼夷効果限定)', !!burn && !blocked(kit, burn) && !blocked(burn, kit));

// 한쪽 순서만 막히는 쌍이 없다 — 효과 중복 판정(effectConflict) 전수
let one = [];
for (const a of P) for (const b of P) if (a !== b && !!C.effectConflict(a, [b]) !== !!C.effectConflict(b, [a])) one.push(a.name + ' / ' + b.name);
ok('효과 중복 금지가 한쪽 순서로만 걸리는 쌍이 없다', !one.length, one.slice(0, 5));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
