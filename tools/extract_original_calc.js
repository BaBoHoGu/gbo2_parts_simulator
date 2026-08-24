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
    // 파라미터 목록을 먼저 건너뛴다. 구조분해 파라미터(function nL(n,{relative:e}))의
    // 중괄호를 본문 시작으로 오해하면 그 괄호가 닫히는 곳에서 함수가 잘려 버린다.
    let j = SRC.indexOf('(', fn), pd = 0, pStr = null, pPrev = '';
    for (; j < SRC.length; j++) {
      const ch = SRC[j];
      if (pStr) { if (ch === pStr && pPrev !== '\\') pStr = null; }
      else if (ch === '"' || ch === "'" || ch === '`') pStr = ch;
      else if (ch === '(') pd++;
      else if (ch === ')') { pd--; if (pd === 0) { j++; break; } }
      pPrev = ch;
    }
    const open = SRC.indexOf('{', j);
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

// 의존성 → 사용처 순 (rL: 소체 스탯, AL: 상한 초기화, iL: 기본 상한, uf: 스탯, Tw: 슬롯)
// 예전 목록에 있던 nL 은 번들 재빌드로 그 난독화 이름이 다른 함수(React Router)에 재배정됐다.
// uf·Tw 어느 쪽도 참조하지 않으므로 뺀다 — 두면 엉뚱한 함수를 끌어와 추출본이 깨진다.
// 뿌리 두 개만 지정하고 나머지 의존성은 자동으로 끌어온다.
// 번들이 재빌드되면 난독화 이름과 의존 관계가 통째로 바뀌므로, 이름 목록을 손으로
// 관리하면 매번 깨진다. 실제로 한 번 호출해 보고 "X is not defined" 가 나면 그 X 를
// 앞에 붙여 다시 만드는 식으로, 성공할 때까지 반복해 스스로 목록을 완성한다.
const dest = path.join(__dirname, '_original_calc.js');
const render = names => `/* 자동 생성 — raw/app.js 에서 추출한 원본 계산 로직. 직접 수정하지 말 것.
 * 재생성: node tools/extract_original_calc.js
 */
${names.map(declText).join('\n')}

module.exports = { calcStatsOriginal: uf, calcSlotsOriginal: Tw };
`;

/** 추출본이 실제로 계산을 해내는지 — 기체 하나로 스탯·슬롯을 한 번씩 돌려 본다. */
function smoke(mod) {
  const d = f => JSON.parse(fs.readFileSync(path.join(ROOT_DATA, f), 'utf8'));
  const msData = d('msData.json'), partsByCat = d('parts.json'), fullst = d('fullst.json');
  const ms = msData[0];
  mod.calcStatsOriginal(ms, [], 6, 'none', partsByCat, fullst);
  mod.calcSlotsOriginal(ms, [], 6, fullst);
}
const ROOT_DATA = path.join(__dirname, '..', 'data');

let names = ['rL', 'AL', 'iL', 'uf', 'Tw'];
let ok = false, added = [];
for (let i = 0; i < 40 && !ok; i++) {
  fs.writeFileSync(dest, render(names));
  delete require.cache[require.resolve(dest)];
  try { smoke(require(dest)); ok = true; }
  catch (e) {
    const m = /^(\w+) is not defined$/.exec(e.message);
    if (!m || names.includes(m[1])) throw e;
    names.unshift(m[1]);          // 의존성은 사용처보다 앞에 와야 한다(const 는 호이스팅 안 됨)
    added.push(m[1]);
  }
}
if (!ok) throw new Error('의존성을 다 못 채웠습니다 — 번들 구조가 크게 바뀐 듯합니다');

const out = fs.readFileSync(dest, 'utf8');
console.log('추출:', names.join(', '), '→', path.relative(process.cwd(), dest), (out.length / 1024).toFixed(1) + 'KB');
if (added.length) console.log('  자동 추가된 의존성:', added.join(', '));
