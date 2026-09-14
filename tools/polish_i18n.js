// 막바지 다듬기 — 광범위 이상 탐지에서 나온 잔여 흔적을 없앤다.
//   node tools/polish_i18n.js [--dry]
// 숫자가 바뀌면 그 칸은 건너뛴다.
const fs = require('fs');
const path = require('path');
const dry = process.argv.includes('--dry');
const RULES = [
  // 「与ダメージ」가 공백 없이 붙어 「여 피해」 규칙을 비켜 갔다
  [/여대미지/g, '가한 대미지'], [/피대미지/g, '받는 대미지'],
  // MT 가 같은 말을 두 번 낸 자리
  [/대미지 대미지/g, '대미지'], [/종료 종료시/g, '종료시'],
  [/피해 피해/g, '피해'], [/공격 공격/g, '공격'], [/받는 받는/g, '받는'],
  [/이동 이동/g, '이동'], [/무장 무장/g, '무장'], [/스킬 스킬/g, '스킬'],
  // 改 는 개량형 — 무장명 빌더·공식(「헤비 어택 개량형」)과 같은 표기.
  // MT 가 「개」 한 글자로 남겨 둔 자리가 스킬 쪽에 남아 있었다.
  [/액티브 가드 카이/g, '액티브 가드 개량형'],

  // 위키 마크업 잔재
  [/br\(\)/g, ' / '],
  // 「軍配型ヒート・ホーク」 — 부채 모양 히트 호크
  [/軍配/g, '군배'],
  // 숫자와 % 사이 공백
  [/(\d) +%/g, '$1%'],
];
// 원문에 그 한자가 있을 때만 적용한다. 「改」→「개」는 조건 없이 바꾸면
// 「3 개」 같은 수량까지 「3 개량형」이 된다.
const KEYED = [
  [/改/, /([가-힣A-Za-z0-9\]\)]) 개(?=[^가-힣량]|$)/g, '$1 개량형'],
];
const num = s => (String(s).match(/\d+(?:\.\d+)?/g) || []).join(',');
const apply = (s, k) => {
  let t = RULES.reduce((a, [re, to]) => a.replace(re, to), s);
  for (const [jp, re, to] of KEYED) if (jp.test(k)) t = t.replace(re, to);
  return t;
};

let total = 0, skipped = 0;
for (const f of ['skill_text', 'weapon_note', 'weapons', 'parts', 'ms', 'misc']) {
  const p = path.join(__dirname, '..', 'data', 'i18n', f + '.json');
  let o; try { o = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  let n = 0;
  const one = (cur, set, k) => {
    const t = apply(cur, k);
    if (t === cur) return 0;
    if (num(t) !== num(cur)) { skipped++; return 0; }
    if (!dry) set(t); return 1;
  };
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') n += one(v, t => { o[k] = t; }, k);
    else if (v && typeof v === 'object')
      for (const fld of ['n', 'd'])
        if (typeof v[fld] === 'string') n += one(v[fld], t => { v[fld] = t; }, k);
  }
  if (n && !dry) fs.writeFileSync(p, JSON.stringify(o, null, 1) + '\n', 'utf8');
  console.log(`  ${f.padEnd(12)} ${n}칸`);
  total += n;
}
console.log(`다듬기 ${total}칸 · 숫자가 바뀌어 건너뛴 칸 ${skipped}`);
