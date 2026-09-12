// 원문의 핵심어가 번역에 대응어로 없는 칸을 사전에서 비운다.
//   node tools/prune_mistranslated.js [--dry]
// 비운 칸은 translate_skills.js / translate_notes.js 가 다음 실행에 다시 번역한다.
// 이번엔 용어 보호(lib/glossary.js)를 거치므로 같은 오역이 다시 나오지 않는다.
const fs = require('fs');
const path = require('path');
const { missing } = require('./lib/glossary.js');
const { hasJa } = require('./lib/mt.js');
const dry = process.argv.includes('--dry');
for (const f of ['skill_text', 'weapon_note']) {
  const p = path.join(__dirname, '..', 'data', 'i18n', f + '.json');
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  // (1) 핵심어가 대응어로 안 살아남은 칸 (2) 번역에 일본어가 남은 칸.
  // (2) 는 번역기가 실패했거나 스킬명이 사전에 없어 일본어로 떨어진 자리다.
  // 캐시에 남아 있으면 다시 시도되지 않으므로 비워야 재번역된다.
  const hit = Object.entries(o).filter(([k, v]) =>
    typeof v === 'string' && (missing(k, v).length || hasJa(v)));
  if (!dry) {
    for (const [k] of hit) delete o[k];
    fs.writeFileSync(p, JSON.stringify(o, null, 1) + '\n', 'utf8');
  }
  console.log(`${f}: 대응어 빠진 ${hit.length}칸${dry ? '' : ' 비움'} (남은 ${Object.keys(o).length})`);
}
