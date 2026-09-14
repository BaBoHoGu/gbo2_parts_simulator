// 저장된 무장 데이터의 누적치(よろけ値) 표기를 備考에서 다시 뽑아 바로잡는다.
//   node tools/fix_stagger.js [--dry]
//
// 예전 파서가 값을 \S+ 로 끊어, 「よろけ値：30%（65% x2）」가 공백에서 멎고
// 닫는 괄호를 잃었다 — 화면에 「30%(65% x2」로 나왔다.
// extract_weapons.js 는 고쳤지만 다시 수집하려면 위키가 필요하므로,
// 이미 받아 둔 備考 로 여기서 다시 계산한다.
const fs = require('fs');
const path = require('path');
const dry = process.argv.includes('--dry');
const P = path.join(__dirname, '..', 'data', 'weapons.json');

// extract_weapons.js 의 parseStagger 와 같은 규칙이다. 둘이 갈리면 안 된다.
function parseStagger(note) {
  const non = /非集束よろけ値：([^/\n]+?)(?=\s*(?:\/|$))/.exec(note);
  const chg = /(?:^|[^非])集束よろけ値：([^/\n]+?)(?=\s*(?:\/|$))/.exec(note);
  if (non && chg) return non[1].trim() + ' (' + chg[1].trim() + ')';
  if (non) return non[1].trim();
  if (chg) return chg[1].trim();
  const rest = note.replace(/(?:非)?集束よろけ値：[^/\n]+/g, '');
  const plain = /よろけ値：([^/\n]+?)(?=\s*(?:\/|$))/.exec(rest);
  return plain ? plain[1].trim() : null;
}
const bal = s => (String(s).match(/[(（]/g) || []).length === (String(s).match(/[)）]/g) || []).length;

const W = JSON.parse(fs.readFileSync(P, 'utf8'));
let fixed = 0, skipped = 0;
for (const id of Object.keys(W)) {
  for (const w of W[id].weapons || []) {
    const note = (w.info && w.info['備考']) || '';
    if (!note || !w.mods) continue;
    const cur = w.mods.stagger;
    if (cur == null || bal(cur)) continue;          // 멀쩡한 것은 건드리지 않는다
    const next = parseStagger(note);
    if (!next || !bal(next)) { skipped++; continue; }
    if (next === cur) continue;
    if (!dry) w.mods.stagger = next;
    if (fixed < 5) console.log(`  ${w.name}\n    ${cur}  →  ${next}`);
    fixed++;
  }
}
if (!dry && fixed) fs.writeFileSync(P, JSON.stringify(W, null, 1) + '\n', 'utf8');
console.log(`누적치 교정 ${fixed}건${dry ? ' (미적용)' : ''} · 고치지 못한 것 ${skipped}`);
