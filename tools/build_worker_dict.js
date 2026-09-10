// 갤러리 서버(Cloudflare Pages Functions)가 쓸 화이트리스트를 만든다.
//
// Firebase 시절에는 사전을 DB(dict 노드)에 올려 두고 규칙이 대조했다. Worker 는
// 코드에 그냥 넣을 수 있으므로 DB 왕복이 사라진다 — 대신 **앱과 같은 목록**이어야
// 하는 규칙은 그대로다(미러에 없는 기체를 앱이 additions 로 보태 넣기 때문).
//
//   node tools/build_worker_dict.js  →  worker/functions/lib/dict.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const D = require('./lib/dataset.js');

const msData = rd('data', 'msData.json');
D.mergeMsAdditions(ROOT, msData);
const partsByCat = rd('data', 'parts.json');
D.mergePartAdditions(ROOT, partsByCat);
const parts = [].concat(...Object.values(partsByCat));

const exp = [];
const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');
const block = core.match(/const EXPANSION_SKILLS = \[([\s\S]*?)\];/);
if (!block) throw new Error('core.js 에서 EXPANSION_SKILLS 를 못 찾았습니다');
for (const m of block[1].matchAll(/'([^']+)'/g)) exp.push(m[1]);
exp.push('拡張スキル無し');   // EXPANSION_NONE

// 무과금 판정도 서버가 한다 — Firebase 는 파츠 표가 없어 못 하던 일이다.
const ticket = (rd('data', 'parts.recycle.json') || {}).ticket || {};
const paid = parts.map(p => p.name).filter(n => ticket[n] == null);

const out = `// 자동 생성 — tools/build_worker_dict.js. 손으로 고치지 말 것.
// 기체 ${msData.length} · 파츠 ${parts.length} · 확장 ${exp.length} · 과금 파츠 ${paid.length}
export const MS = new Set(${JSON.stringify(msData.map(m => m.MS名))});
export const PARTS = new Set(${JSON.stringify(parts.map(p => p.name))});
export const EXP = new Set(${JSON.stringify(exp)});
/** 리사이클 티켓으로 살 수 없는 파츠 — 하나라도 있으면 무과금 구성이 아니다. */
export const PAID = new Set(${JSON.stringify(paid)});
`;
const dst = path.join(ROOT, 'worker', 'functions', 'lib', 'dict.js');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, out, 'utf8');
console.log(`사전 생성 — 기체 ${msData.length} · 파츠 ${parts.length} · 확장 ${exp.length} · 과금 ${paid.length}`);
console.log('→ ' + path.relative(ROOT, dst));
