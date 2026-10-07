// 갤러리 서버(Cloudflare Pages Functions)가 쓸 화이트리스트를 만든다.
//
// Firebase 시절에는 사전을 DB(dict 노드)에 올려 두고 규칙이 대조했다. Worker 는
// 코드에 그냥 넣을 수 있으므로 DB 왕복이 사라진다 — 대신 **앱과 같은 목록**이어야
// 하는 규칙은 그대로다(미러에 없는 기체를 앱이 additions 로 보태 넣기 때문).
//
//   node tools/build_worker_dict.js  →  functions/lib/dict.js
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

/* **보험 대상 기체.** 추천 영상이 쓴다 — 새 영상이 아직 조회수를 못 모은 기체는
   조회수로만 뽑으면 그 영상이 영영 안 올라온다. 이 목록에 있으면 최신 영상 자리를 더 준다.
   세 갈래를 합친다(사용자 요청):
     · 밸런스 패치로 조정된 기체 (patch.mechs — 패치마다 갈린다)
     · LV 이 새로 붙은 기체   (events why=newLv — 샤아 즈고크 LV2~4 같은 경우)
     · 새로 나온 기체         (events why=new)
   data/patch.json 은 update.js 가 적는다. 비어 있으면 보험이 없을 뿐 나머지는 그대로
   돈다 — 그래서 없을 때도 터지지 않게 둔다. */
let patch = { date: '', mechs: [], events: [] };
try { patch = rd('data', 'patch.json') || patch; } catch { /* 없을 수 있다 */ }
/* 누가 보험을 받는가는 tools/lib/insured.js 한 군데서 정한다 — 검사도 같은 것을 쓴다.
   지금 자료에 없는 이름은 버린다(표기가 바뀐 옛 이름이 섞여 들어온 적이 있다). */
const { insuredFrom } = require('./lib/insured.js');
const ins = insuredFrom(patch, { live: new Set(msData.map(m => String(m.MS名).replace(/_LV\d+$/, ''))) });
const patched = ins.list;
const nLv = ins.newLv, nNew = ins.new;

const out = `// 자동 생성 — tools/build_worker_dict.js. 손으로 고치지 말 것.
// 기체 ${msData.length} · 파츠 ${parts.length} · 확장 ${exp.length} · 과금 파츠 ${paid.length}
export const MS = new Set(${JSON.stringify(msData.map(m => m.MS名))});
/** 추천 영상 보험 대상 ${patched.length}기 — LV 을 뗀 이름.
 *  밸런스 패치(${patch.date || '없음'}) ${(patch.mechs || []).length}기 + LV 추가 ${nLv}기 + 신규 ${nNew}기. */
export const PATCHED = new Set(${JSON.stringify(patched)});
export const PATCH_DATE = ${JSON.stringify(String(patch.date || ''))};
export const PARTS = new Set(${JSON.stringify(parts.map(p => p.name))});
export const EXP = new Set(${JSON.stringify(exp)});
/** 리사이클 티켓으로 살 수 없는 파츠 — 하나라도 있으면 무과금 구성이 아니다. */
export const PAID = new Set(${JSON.stringify(paid)});
`;
const dst = path.join(ROOT, 'functions', 'lib', 'dict.js');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, out, 'utf8');
console.log(`사전 생성 — 기체 ${msData.length} · 파츠 ${parts.length} · 확장 ${exp.length} · 과금 ${paid.length}`);
console.log('→ ' + path.relative(ROOT, dst));
