// 화면 코드(ui) 원문을 한 덩어리로 읽는다 — 빌드와 검사 도구가 같이 쓴다.
//
// ■ 왜 — 2026-10-16 src/ui.js(10,818줄 · 함수 290개)를 화면 단위 파일(src/ui/NN-이름.js)로 나눴다.
//   빌드는 예전처럼 **한 IIFE** 로 이어 붙인다 — 파일끼리 변수를 그대로 나눠 쓴다(모듈로 쪼갠 게 아니다).
//   그래서 각 파일은 「IIFE 몸통의 한 토막」 이고, 바깥 감싸기 `(function () { 'use strict'; … })();` 는
//   여기서 둘러 준다. 덕분에 파일 하나만 열어도 문법 오류 없이 읽힌다.
// ■ 순서는 파일 이름 앞의 번호다(00 → 18). 새 파일은 번호를 붙여 끼운다 — 뒤 파일이 앞 파일의
//   const 를 쓰므로 순서가 곧 정의 순서다.
// ■ 검사 도구는 `src/ui.js` 를 읽지 말고 readUi() 를 쓴다 — 함수를 떼어 오는 자(stag2_check 등)는
//   이어 붙인 원문에서 찾는다.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'src', 'ui');
const OPEN = "(function () {\n  'use strict';\n";
const CLOSE = '})();\n';

/** 이어 붙일 파일들(번호 순). */
function uiParts() {
  return fs.readdirSync(DIR).filter(f => /^\d{2}-[\w-]+\.js$/.test(f)).sort().map(f => path.join(DIR, f));
}
/** IIFE 로 감싼 화면 코드 전체. */
function readUi() {
  return OPEN + uiParts().map(f => fs.readFileSync(f, 'utf8')).join('') + CLOSE;
}

module.exports = { readUi, uiParts, UI_DIR: DIR };
