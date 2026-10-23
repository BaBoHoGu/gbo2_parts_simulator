// 옛 Safari 에서 **파싱부터 죽는** 문법이 빌드에 들어가지 않았는가.
//
//   node tools/compat_check.js        (먼저 node tools/build.js)
//
// 왜 — 정규식 뒷보기 (?<! … ) / (?<= … ) 는 iOS 16.4 미만 Safari 가 모른다. 리터럴로 쓰면 그 <script> 전체가
// SyntaxError 로 죽어 앱이 **통째로 안 뜬다**(iPhone 7·6s 는 iOS 15 가 마지막이다). new RegExp 로 만들면
// 그 줄에서 예외가 나 파일이 멈춘다. 둘 다 화면에 아무 말도 없이 빈 페이지가 된다(2026-10-24 버그 탐색 —
// ui/00-base.js 의 리터럴과 i18n.js 의 new RegExp 둘이 있었다).
// 빌드본을 보는 이유: 빌드가 주석을 지우므로 주석 속 설명은 걸리지 않고, 실제로 실리는 코드만 본다.
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('FAIL  빌드본이 없습니다 — node tools/build.js 먼저'); process.exit(1); }
const html = fs.readFileSync(FILE, 'utf8');
// 데이터(JSON.parse('…'))는 빼고 코드만 — 큰 데이터 문자열 안의 글자로 거짓 경보가 나지 않게
const code = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1])
  .map(s => s.replace(/JSON\.parse\('(?:[^'\\]|\\.)*'\)/g, 'null')).join('\n');
let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra) : '')); }
};
const hits = [...code.matchAll(/\(\?<[!=]/g)].map(m => code.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' '));
ok('스크립트를 실제로 읽었다 (코드 200KB 이상)', code.length > 200000, { 길이: code.length });
ok('정규식 뒷보기 (?<! (?<= 가 없다 — iOS 16.4 미만 Safari 에서 앱이 통째로 죽는다', hits.length === 0, hits.slice(0, 5));
console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
