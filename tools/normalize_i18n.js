// 사전 표기 통일 — 뜻은 같은데 적는 법이 갈린 자리를 한쪽으로 모은다.
//   node tools/normalize_i18n.js
// 숫자가 바뀌면 그 칸은 건드리지 않고 경고한다(안전 장치).
const fs = require('fs');
const path = require('path');
const UNITS = [['秒','초'],['倍','배'],['発','발'],['回','회'],['射','사'],['分','분'],
  ['等','등'],['最大','최대'],['ヒット','히트'],['腕','팔'],['門','문'],['丁','정'],['基','기'],['合計','합계'],['約','약'],['共鳴','공명']];
const RULES = [
  [/오버 히트/g, '오버히트'],          // 용어집은 붙여 쓴다
  [/제어기구/g, '제어 기구'],
  [/실드장 특수 완충재/g, '실드 병장 특수 완충재'],   // MT 가 「병」을 흘린 자리
  [/메커니즘/g, '기구'],
];
// 존댓말체 어미 → 평서체. 다른 항목이 전부 평서체라 섞이면 눈에 띈다.
// MT 가 고르는 문체라 재번역해도 안 고쳐진다 — 나온 어미만 열거해 바꾼다.
const POLITE = [
  [/가능합니다/g, '가능하다'], [/무효화합니다/g, '무효화한다'], [/있습니다/g, '있다'],
  [/없습니다/g, '없다'], [/않습니다/g, '않는다'], [/확장됩니다/g, '확장된다'],
  [/발생합니다/g, '발생한다'], [/비활성화합니다/g, '비활성화한다'], [/줄입니다/g, '줄인다'],
  [/소비합니다/g, '소비한다'], [/수행됩니다/g, '수행된다'], [/완화됩니다/g, '완화된다'],
  [/표시됩니다/g, '표시된다'], [/얻습니다/g, '얻는다'], [/상승합니다/g, '상승한다'],
  [/증가합니다/g, '증가한다'], [/회복됩니다/g, '회복된다'], [/변화합니다/g, '변화한다'],
  [/줄어 듭니다/g, '줄어든다'], [/됩니다/g, '된다'], [/합니다/g, '한다'],
];
// 「」'' "" 【】 안(스킬명·고유명사)은 건드리지 않는다.
const PROT = /(「[^」]*」|'[^']*'|"[^"]*"|【[^】]*】)/g;
const all = RULES.concat(POLITE);
const apply = s => s.split(PROT).map((seg, i) => i % 2 ? seg
  : all.reduce((a, [re, to]) => a.replace(re, to), UNITS.reduce((a, [ja, ko]) => a.split(ja).join(ko), seg))).join('');
const num = s => (String(s).match(/\d+(?:\.\d+)?/g) || []).join(',');

let total = 0, skipped = 0;
for (const f of ['skill_text', 'weapon_note', 'weapons', 'parts']) {
  const p = path.join(__dirname, '..', 'data', 'i18n', f + '.json');
  let o; try { o = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  let n = 0;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== 'string') continue;
    // 「兵装」은 병장, 「武装」은 무장 — 원문에 武装 이 없는데 무장이면 잘못 옮긴 것이다.
    const t0 = (/兵装/.test(k) && !/武装/.test(k)) ? v.split('무장').join('병장') : v;
    const t = apply(t0);
    if (t === v) continue;
    if (num(t) !== num(v)) { skipped++; console.log('  숫자가 바뀌어 건너뜀: ' + k.slice(0, 40)); continue; }
    o[k] = t; n++;
  }
  if (n) fs.writeFileSync(p, JSON.stringify(o, null, 1) + '\n', 'utf8');
  console.log(`  ${f.padEnd(12)} ${n}칸`);
  total += n;
}
console.log(`표기 통일 ${total}칸 · 숫자가 바뀌어 건너뛴 칸 ${skipped}`);
