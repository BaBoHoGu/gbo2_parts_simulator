// 패치노트 초안이 **같은 날 다시 돌 때** 절을 또 만들지 않는가.
//   node tools/draft_check.js
//
// ■ 왜 — 하루에 세 번 배포한 날 「데이터 갱신 (덧붙임)」 절이 **세 개** 쌓였다(2026-10-12).
//   매번 사람이 손으로 합쳤다. 같은 제목이 이미 있으면 그 목록에 줄만 더해야 한다.
//
// ■ **수를 합치지 않는다.** 실행마다 비교 기준(HEAD)이 달라 「5기」와 「3기」가 같은 기체를
//   두 번 셀 수 있다. 더하면 지어내는 것이 된다 — 실제로 「8기」라고 적었다가 되돌렸다.
//
// ■ 이 자는 `patchnote_draft.js` 에서 **합치는 함수만 떼어** 재 본다. 그 파일은 git 과
//   패치노트.md 를 직접 읽는 스크립트라 require 하면 통째로 돌아 버린다. 글자로 베끼지 않고
//   떼어 오는 이유는 두 벌이 되면 갈라지기 때문이다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'tools', 'patchnote_draft.js');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

if (!fs.existsSync(SRC)) { console.log('SKIP  patchnote_draft.js 가 없다'); process.exit(0); }
const src = fs.readFileSync(SRC, 'utf8');
const i = src.indexOf('function mergeIntoToday');
if (i < 0) { ok('mergeIntoToday 가 있다', false, '함수를 못 찾았다'); console.log('\n' + pass + ' PASS / ' + (fail) + ' FAIL'); process.exit(1); }
/* 함수 끝 — 들여쓰기 없는 닫는 중괄호 */
const j = src.indexOf('\n}', i);
const body = src.slice(i, j + 2);

const TODAY = '2026-10-12';
/** 떼어 온 함수에 `today` 와 `facts` 를 끼워 넣는다 — 그 둘은 이 자가 정한다. */
const make = bullets => new Function('today', 'facts',
  body + '\nreturn mergeIntoToday;')(TODAY, () => bullets);

const nl = '\n';
const note = [
  '# 제목', '', '---', '',
  '_2026-10-12 업데이트_', '',
  '## 📰 사람이 쓴 절', '',
  '사람이 다듬은 문장이다. 건드리면 안 된다.', '',
  '## 🔄 데이터 갱신', '',
  '- **무장이 바뀐 기체 4기**', '',
  '---',
  '_2026-10-09 업데이트_', '',
  '## 옛 절', ''
].join(nl);

/* ── ① 같은 제목이 있으면 그 목록에 **줄만** 더한다 ───────────────── */
{
  const out = make(['- **무장이 바뀐 기체 3기** (수치·설명)'])(note, null, nl);
  ok('글을 돌려준다', typeof out === 'string', typeof out);
  const L = String(out).split(nl);
  ok('절을 또 만들지 않는다 (「(덧붙임)」 이 없다)', !/덧붙임/.test(out), out);
  ok('데이터 갱신 제목이 하나뿐이다',
    L.filter(x => /^## .*데이터 갱신/.test(x)).length === 1,
    L.filter(x => /^## /.test(x)));
  /* 새 줄은 **이미 있던 줄 바로 뒤**에 와야 한다 */
  const a = L.findIndex(x => /4기/.test(x)), b = L.findIndex(x => /3기/.test(x));
  ok('새 줄이 이미 있던 줄 바로 뒤에 붙는다', a >= 0 && b === a + 1, { 기존: a, 새것: b });
  ok('사람이 쓴 절을 건드리지 않는다',
    /사람이 다듬은 문장이다/.test(out) && /## 📰 사람이 쓴 절/.test(out));
  ok('옛 날짜 절을 건드리지 않는다', /_2026-10-09 업데이트_/.test(out) && /## 옛 절/.test(out));
  /* **수를 합치지 않는다** — 4기+3기 를 7기 로 적으면 같은 기체를 두 번 셀 수 있다 */
  ok('수를 합치지 않는다 (4기·3기 가 나란히 남는다)',
    /4기/.test(out) && /3기/.test(out) && !/7기/.test(out), out);
}

/* ── ② 글자가 같은 줄은 더하지 않는다 ───────────────────────────── */
{
  const out = make(['- **무장이 바뀐 기체 4기**'])(note, null, nl);
  ok('같은 줄이면 아무것도 하지 않는다 (same)', out === 'same', out);
}

/* ── ③ 오늘 절에 그 제목이 **없으면** 손대지 않는다 ────────────────
   그때는 예전처럼 절 끝에 덧붙이는 길로 가야 한다. 여기서 억지로 끼우면
   사람이 쓴 절 아무 데나 줄이 들어간다. */
{
  const only = note.replace('## 🔄 데이터 갱신', '## 🛠 다른 제목')
    .replace('- **무장이 바뀐 기체 4기**', '- 사람이 쓴 목록');
  const out = make(['- 새 줄'])(only, null, nl);
  ok('데이터 갱신 제목이 없으면 null 을 돌려준다 (덧붙임 길로 간다)', out === null, out);
}

/* ── ④ 오늘 절이 없으면 손대지 않는다 ───────────────────────────── */
{
  const other = note.replace('_2026-10-12 업데이트_', '_2026-10-11 업데이트_');
  ok('오늘 절이 없으면 null 을 돌려준다', make(['- 새 줄'])(other, null, nl) === null);
}

/* ── ⑤ 절 끝이 「---」 로 닫히지 않은 글(맨 마지막 절)도 된다 ──────── */
{
  const tail = [
    '# 제목', '', '---', '',
    '_2026-10-12 업데이트_', '',
    '## 🔄 데이터 갱신', '',
    '- **무장이 바뀐 기체 4기**', ''
  ].join(nl);
  const out = make(['- **스킬이 바뀐 기체 2기**'])(tail, null, nl);
  ok('마지막 절(「---」 없이 끝나는 글)에도 붙는다',
    typeof out === 'string' && /2기/.test(out) && !/덧붙임/.test(out), out);
}

/* ── ⑥ 「(덧붙임)」 이 이미 있는 옛 글도 받아 준다 ──────────────────
   오늘 자 절에 옛 방식으로 만들어진 절이 남아 있을 수 있다. 그 목록에 붙여야
   또 하나를 만들지 않는다. */
{
  const oldStyle = note.replace('## 🔄 데이터 갱신', '## 🔄 데이터 갱신 (덧붙임)');
  const out = make(['- **스킬이 바뀐 기체 2기**'])(oldStyle, null, nl);
  ok('「(덧붙임)」 제목에도 붙인다',
    typeof out === 'string' && /2기/.test(out)
    && String(out).split(nl).filter(x => /^## .*데이터 갱신/.test(x)).length === 1, out);
}

/* ── ⑦ 실제 패치노트.md 에 절이 **쌓여 있지 않은가** ───────────────── */
{
  const NOTE = path.join(ROOT, '패치노트.md');
  if (!fs.existsSync(NOTE)) console.log('  (건너뜀) 패치노트.md 가 없다');
  else {
    const t = fs.readFileSync(NOTE, 'utf8');
    const dup = [];
    const secs = t.split(/\r?\n(?=_\d{4}-\d{2}-\d{2} 업데이트_)/);
    for (const sec of secs) {
      const d = (sec.match(/^_(\d{4}-\d{2}-\d{2}) 업데이트_/) || [])[1];
      if (!d) continue;
      const n = (sec.match(/^## .*데이터 갱신/gm) || []).length;
      if (n > 1) dup.push(d + ': ' + n + '개');
    }
    ok('한 날짜에 「데이터 갱신」 제목이 둘 이상인 절이 없다', dup.length === 0, dup);
    ok('남아 있는 자동 초안 주석이 없다', !/자동 초안입니다/.test(t),
      (t.match(/[^\r\n]*자동 초안입니다[^\r\n]*/) || [''])[0]);
  }
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
