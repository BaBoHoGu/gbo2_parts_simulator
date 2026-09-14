// 번역 대조 검사 — 원문의 핵심어가 번역에 대응어로 살아 있는가.
//   node tools/check_glossary.js
//
// 「비틀」 같은 금지어를 찾는 검사로는 오역이 안 걸린다. gtx 가 「よろけ」를
// 「쑥쑥」·「잡음」으로 옮기거나 아예 빼 버리면 금지어가 없어 통과하기 때문이다
// (2026-09-12 에 그렇게 271칸을 놓쳤다). 그래서 대응어가 있는지를 본다.
const fs = require('fs');
const path = require('path');
const { missing } = require('./lib/glossary.js');

const FILES = ['skill_text', 'weapon_note', 'weapons', 'parts'];
let fail = 0;
for (const f of FILES) {
  const p = path.join(__dirname, '..', 'data', 'i18n', f + '.json');
  let o; try { o = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  const hit = [];
  for (const [k, v] of Object.entries(o)) {
    const t = typeof v === 'string' ? v : (v && (v.d || v.n)) || '';
    if (!t) continue;
    // 칸 전체로만 보면 놓친다 — 같은 칸의 다른 불릿에 대응어가 하나만 있어도
    // 통과해 버려서, 「よろけ値」가 「요로케값」·「사격비」로 흘러간 13칸을 못 봤다.
    // 備考는 ' / ' 로 나뉜 불릿 목록이고 원문과 번역의 불릿 수가 같을 때가 대부분이니,
    // 수가 맞으면 불릿끼리 짝지어 본다. 안 맞으면 종전대로 칸 전체로 본다.
    const ks = k.split(' / '), ts = t.split(' / ');
    let m;
    if (ks.length > 1 && ks.length === ts.length) {
      const set = new Set();
      ks.forEach((kk, i) => missing(kk, ts[i]).forEach(x => set.add(x)));
      m = [...set];
    } else {
      m = missing(k, t);
    }
    if (m.length) hit.push([k, t, m]);
  }
  console.log(`  ${f.padEnd(12)} ${hit.length ? hit.length + '칸 대응어 없음' : '이상 없음'}`);
  for (const [k, t, m] of hit.slice(0, 5)) {
    console.log(`     ${m.join(' ')}  ${k.slice(0, 40)}\n        → ${t.slice(0, 60)}`);
  }
  fail += hit.length;
}
console.log(fail ? `\n번역 대조 실패 — ${fail}칸` : '\n번역 대조 통과 — 핵심어가 모두 대응어로 살아 있음');
process.exit(fail ? 1 : 0);
