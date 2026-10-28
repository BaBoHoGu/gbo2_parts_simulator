// 위키 이력 반영(data/history.reflect.json) — 사람이 아직 확인 안 한 칸이 있으면 배포 요약에 알린다(실패시키지 않는다).
//
//   node tools/history_reflect_check.js
//
// 생성기(extract_history_reflect)는 배포 때마다 다시 돌아 새 칸을 찾는다. 새 칸은 approved:false 로 들어가고
// 빌드는 approved 인 칸만 얹는다(dataset.js applyHistoryReflect). 확인 전 칸을 여기서 「NOTICE」 로 내면
// gates.js 가 마지막 요약 위 「⚠ 알림」 에 모은다. 확인했으면 node tools/extract_history_reflect.js --approve.
// 오판 사례(유니콘 빔 매그넘 5→6, 실제는 2024 에 6→5 로 되돌림)가 알림 없이 나갈 뻔해서 생겼다(2026-10-28).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = require('./lib/dataset.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra != null ? '  ' + JSON.stringify(extra) : '')); }
};
const h = D.historyReflectOf(ROOT);
const pins = h.pins || [];
const pending = pins.filter(p => p.approved !== true);
const show = p => p.date + ' ' + p.ms + ' · ' + (p.weapon ? p.weapon + ' ' + p.path : p.field) + ' : '
  + JSON.stringify(p.sub ? p.sub.from : p.was) + ' → ' + JSON.stringify(p.sub ? p.sub.to : p.value);
for (const p of pending) console.log('NOTICE 위키 이력 반영 · 확인 전(빌드에 안 얹음) · ' + show(p) + ' — 확인 뒤 extract_history_reflect.js --approve');

// 확인한 칸이 지금 데이터에 실제로 얹히는가 — 위키가 그 칸을 다른 값으로 바꿨으면 알린다(다음 배포 때 생성기가 다시 고른다)
if (h.enabled) {
  const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
  const msData = require('./lib/msdata.js').applyWikiOverride(rd('msData.json'), ROOT);
  D.mergeMsAdditions(ROOT, msData); D.applyMsOverride(ROOT, msData); D.applyMsManual(ROOT, msData);
  const data = { weapons: rd('weapons.json'), msSkills: rd('ms_skills.json'), msData };
  D.applyOfficialPins(ROOT, data);
  const r = D.applyPins(pins.filter(p => p.approved === true), data);
  for (const p of r.moved) console.log('NOTICE 위키 이력 반영 · 표가 박을 때와 달라 건너뜀 · ' + show(p));
  for (const p of r.missing) console.log('NOTICE 위키 이력 반영 · 대상을 못 찾음 · ' + show(p));
  ok('확인한 칸 ' + (pins.length - pending.length) + '개를 셌다 (켜져 있는데 0 이면 파일이 비었다)', pins.length - pending.length > 0 || !pins.length);
}
ok('모든 칸에 확인 여부(approved)가 적혀 있다', pins.every(p => typeof p.approved === 'boolean'), pins.filter(p => typeof p.approved !== 'boolean').length);
console.log('\n' + pass + ' PASS / ' + fail + ' FAIL  (확인 전 ' + pending.length + ')');
process.exit(fail ? 1 : 0);
