// raw/app.js(원본 번들)에서 스탯 계산 함수와 그 의존성만 잘라내
// Node 에서 실행 가능한 모듈(tools/_original_calc.js)로 만든다.
//
// 우리 calcStats 가 원본과 같은 값을 내는지 대조하기 위한 것이라,
// 추출한 코드는 원본 그대로 두고 절대 손대지 않는다.
//   uf … 스탯 계산 (우리 calcStats)
//   nL … 소체 스탯   iL … 상한 초기화   AL … 기체 LV 추출
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'raw', 'app.js'), 'utf8');

/** `from` 부터 값이 끝나는 지점(최상위 `,` `;` 또는 닫는 괄호)까지. */
function endOfValue(from) {
  let i = from, depth = 0, inStr = null, prev = '';
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; }
    else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
    else if ((ch === ',' || ch === ';') && depth === 0) break;
    prev = ch;
  }
  return i;
}

/** 번들의 세 가지 선언 형태(function / const / 콤마 연결)를 모두 처리한다. */
function declText(name) {
  const fn = SRC.indexOf('function ' + name + '(');
  if (fn >= 0) {
    const open = SRC.indexOf('{', fn);
    let i = open, depth = 0, inStr = null, prev = '';
    for (; i < SRC.length; i++) {
      const ch = SRC[i];
      if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; }
      else if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
      prev = ch;
    }
    return SRC.slice(fn, i);
  }
  for (const lead of ['const ' + name + '=', ',' + name + '=', ';' + name + '=']) {
    const at = SRC.indexOf(lead);
    if (at < 0) continue;
    const eq = at + lead.length;
    return 'const ' + name + '=' + SRC.slice(eq, endOfValue(eq)) + ';';
  }
  throw new Error('번들에서 ' + name + ' 를 찾지 못했습니다');
}

// 의존성 → 사용처 순 (rL: 기본 상한, AL: 기체 LV, nL: 소체, iL: 상한 초기화, Tw: 슬롯)
const NAMES = ['rL', 'AL', 'nL', 'iL', 'uf', 'Tw'];
const body = NAMES.map(declText).join('\n');

const out = `/* 자동 생성 — raw/app.js 에서 추출한 원본 계산 로직. 직접 수정하지 말 것.
 * 재생성: node tools/extract_original_calc.js
 */
${body}

module.exports = { calcStatsOriginal: uf, calcSlotsOriginal: Tw, baseStatsOriginal: nL, limitsOriginal: iL, msLevelOriginal: AL };
`;
const dest = path.join(__dirname, '_original_calc.js');
fs.writeFileSync(dest, out);
console.log('추출:', NAMES.join(', '), '→', path.relative(process.cwd(), dest), (out.length / 1024).toFixed(1) + 'KB');
