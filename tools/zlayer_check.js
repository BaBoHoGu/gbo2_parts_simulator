// z-index 가 **다섯 층 변수**로만 쓰이는가 — 파일만 읽는다(Chrome 없음).
//   node tools/zlayer_check.js
//
// ■ 왜 — z-index 가 1~90 사이 열여덟 가지 수로 흩어져 있었다(CSS 8단계 전). 새 창을 띄울 때마다
//   「몇이면 저 위로 가나」를 파일 전체에서 찾아야 했고, 그렇게 고른 수가 서로 엉켰다
//   (폰 행동 바 47 이 서랍 41 위라 「실행」 이 가려졌던 일). 층을 이름으로 묶었다:
//     --z-bar 20 · --z-sheet 40 · --z-modal 50 · --z-pop 60 · --z-drag 90
//   이 자는 **새 맨숫자가 다시 들어오는 것**을 막는다. 패널 안 sticky 머리처럼 제 쌓임
//   맥락 안에서만 겨루는 작은 수(1~9)는 허용한다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = ['src/style.css', 'src/duel.css', 'src/token.css'];
const LAYERS = { 'z-bar': 20, 'z-sheet': 40, 'z-modal': 50, 'z-pop': 60, 'z-drag': 90 };

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const bad = [];
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/z-index\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (/^-?\d+$/.test(v) && Math.abs(Number(v)) < 10) continue;            // 국소 쌓임
      if (/^var\(--z-(bar|sheet|modal|pop|drag)\)$/.test(v)) continue;
      if (/^calc\(var\(--z-(bar|sheet|modal|pop|drag)\)\s*[+-]\s*\d+\)$/.test(v)) continue;
      bad.push(f + ':' + (i + 1) + '  ' + v);
    }
  });
}
ok('z-index 가 층 변수(또는 9 이하 국소 값)로만 쓰인다 (' + bad.length + '곳 어긋남)', bad.length === 0, bad.slice(0, 8));

const css = fs.readFileSync(path.join(ROOT, 'src/style.css'), 'utf8');
for (const [k, v] of Object.entries(LAYERS)) {
  const m = css.match(new RegExp('--' + k + ':\\s*(\\d+)'));
  ok('층 --' + k + ' 이 ' + v + ' 로 정의되어 있다', !!m && Number(m[1]) === v, m && m[1]);
}
/* 층 순서 — 이름이 뜻하는 위아래가 지켜지는가 (값을 바꾸다 뒤집는 실수) */
const val = k => Number((css.match(new RegExp('--' + k + ':\\s*(\\d+)')) || [])[1]);
const order = ['z-bar', 'z-sheet', 'z-modal', 'z-pop', 'z-drag'];
ok('층이 상단바 < 서랍 < 모달 < 팝업 < 끌기 순이다',
  order.every((k, i) => i === 0 || val(order[i - 1]) < val(k)), order.map(val));
/* 층 안 + n 이 다음 층을 넘지 않는가 — 넘으면 층 이름이 거짓이 된다 */
const over = [];
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/calc\(var\(--(z-[a-z]+)\)\s*\+\s*(\d+)\)/g)) {
    const i = order.indexOf(m[1]);
    const next = order[i + 1];
    if (next && val(m[1]) + Number(m[2]) >= val(next) && m[1] !== 'z-pop') over.push(m[0]);
  }
}
ok('층 안 덧셈(+n)이 다음 층을 넘지 않는다', over.length === 0, over);

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
