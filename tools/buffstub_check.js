// 버프 스킬(data/skills.json)이 붙은 기체는 스킬 목록(data/ms_skills.json)에도 있어야 한다.
//
//   node tools/buffstub_check.js
//
// extract_ms_skills 는 위키가 스텁인 기체를 건너뛰는데, find_buff_skills 는 같은 스텁 페이지를 통째로 읽어
// 남의 스킬을 주웠다 — クロスボーン・ガンダムＸ-０(2026-10-30 신규)에 능력UP「바이오센서」 등 22개가 붙어
// 스탯 계산에 얹힐 뻔했다. 두 추출기가 같은 판단을 하는지 데이터로 지킨다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const buff = rd('skills.json'), list = rd('ms_skills.json');
const NFC = s => String(s).normalize('NFC');
const listed = new Set(Object.keys(list).map(NFC));
const orphan = Object.keys(buff).filter(k => !k.startsWith('_') && !listed.has(NFC(k)));
let fail = 0;
if (orphan.length) { fail++; console.log('  FAIL 버프 스킬이 스킬 목록에 없는 기체에 붙었다(스텁 페이지에서 주운 것)  ' + JSON.stringify(orphan)); }
else console.log('  PASS 버프 스킬이 붙은 기체 ' + Object.keys(buff).length + '기 모두 스킬 목록에 있다');
console.log('\n' + (fail ? 0 : 1) + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
