// 위키 감시 — 밸런스 패치로 조정된 기체 페이지는 위키가 따라올 때까지(until) 값이 같아도 떼지 않는가.
//
//   node tools/wikiwatch_check.js
//
// 「두 번 연속 같으면 다 채워졌다」 는 새 기체용 규칙이라, 패치 조정 페이지는 위키가 아직 안 고친 채
// 같은 값이 두 번 나와 이틀 만에 떼일 뻔했다(2026-10-30). 떼이면 위키가 고친 뒤에도 순회로만 다시 본다.
// 실제 파일을 건드리지 않으려고 임시 폴더에 감시 파일을 두고 잰다.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const WW = require('./lib/wikiwatch.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra != null ? '  ' + JSON.stringify(extra) : '')); }
};
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-'));
fs.mkdirSync(path.join(TMP, 'data'));
const weapons = { 100: { weapons: [{ name: 'A', levels: { 1: { power: 10 } } }] }, 200: { weapons: [{ name: 'B', levels: { 1: { power: 20 } } }] } };
const skills = { X: [1], Y: [1] };
const base = new Map([['100', 'X'], ['200', 'Y']]);
const far = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);

ok('hold 가 있다', typeof WW.hold === 'function');
const watch = {};
WW.add(watch, ['100', '200']);
if (typeof WW.hold === 'function') WW.hold(watch, ['100'], far);   // 100 = 패치 조정 페이지
for (let i = 0; i < 4; i++) WW.settle(TMP, watch, ['100', '200'], weapons, skills, base);   // 값이 계속 같다
ok('붙잡은(패치 조정) 페이지는 값이 같아도 until 전에는 감시에 남는다', !!watch['100'], watch['100']);
ok('붙잡지 않은 페이지는 예전처럼 두 번 같으면 뗀다', !watch['200'], watch['200']);
// until 이 지나면 뗀다
if (watch['100']) watch['100'].until = '2000-01-01';
WW.settle(TMP, watch, ['100'], weapons, skills, base);
ok('until 이 지나면 값이 같을 때 뗀다', !watch['100'], watch['100']);
fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
