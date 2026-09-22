// 새 기체의 위키 페이지가 **덜 채워진 채 굳는 것**을 막는다.
//
// 무엇이 문제였나 — update.js 의 재수신 판정은 「무장이 있냐 없냐」였다:
//     return !weapNow[id] || !(weapNow[id].weapons || []).length || !sklNow[b];
// 위키는 새 기체가 나오면 **틀만 먼저 만들고 며칠에 걸쳐 채운다.** 그 사이에 한 번 긁히면
// 무장이 1개라도 들어오므로 그 뒤로는 「완성」으로 취급되어 **영영 다시 안 본다.**
// 실제로 카풀 두 기체가 그랬다 — 09-17 에 4종만 받았고, 위키가 7종·6종으로 채워진 뒤에도
// 배포를 두 번 돌리는 동안 계속 「✔ 이미 최신 상태입니다」가 나왔다(무장 5종 누락).
// 미러(gbo2.jp)는 멀쩡하니 미러 대조로도 안 잡힌다.
//
// 어떻게 고치나 — 「있냐 없냐」 대신 **「더 이상 안 바뀌는가」**로 본다.
//   · 처음 받은 페이지는 **감시 목록**에 올린다.
//   · 감시 중인 페이지는 캐시가 REFETCH_DAYS 보다 오래되면 다시 받는다.
//   · 받아 본 값이 직전과 같으면 same++, **STABLE_HITS 번 연속 같으면 감시를 뗀다.**
//     값이 바뀌면 same 을 0 으로 돌린다 — 아직 채워지는 중이라는 뜻이다.
//   · 안전장치로 MAX_DAYS 가 지나면 무조건 뗀다(위키가 영영 안 바뀌는 페이지도 있다).
// 끝나는 조건이 있어야 한다 — 「새 기체는 늘 다시 받는다」로 두면 영원히 받는다.
const fs = require('fs');
const path = require('path');

const REFETCH_DAYS = 2;    // 감시 중인 페이지를 다시 받는 간격
const STABLE_HITS = 2;     // 몇 번 연속 같아야 「다 채워졌다」로 볼 것인가
const MAX_DAYS = 60;       // 이만큼 지나면 무조건 감시 해제
const SEED_NEWEST = 30;    // 목록이 없을 때 처음 감시할 최신 페이지 수

const FILE = ROOT => path.join(ROOT, 'data', 'wiki_watch.json');
const DAY = 24 * 3600 * 1000;
const today = () => new Date().toISOString().slice(0, 10);

function load(ROOT) {
  try { return JSON.parse(fs.readFileSync(FILE(ROOT), 'utf8')); } catch { return {}; }
}
function save(ROOT, watch) {
  fs.writeFileSync(FILE(ROOT), JSON.stringify(watch, null, 1) + '\n');
}

/** 페이지에서 뽑아낸 값의 지문. 이게 안 바뀌면 위키가 더 채울 게 없다는 뜻이다.
 *  무장 이름만 보면 「이름은 그대로인데 위력이 채워진」 경우를 놓치므로 레벨값까지 넣는다. */
function sigOf(weapons, skills, id, base) {
  const ws = ((weapons[id] || {}).weapons || [])
    .map(x => x.name + ':' + JSON.stringify(x.levels || {}))
    .sort().join('|');
  const sk = (skills[base] || []).length;
  let h = 5381;
  for (let i = 0; i < ws.length; i++) h = ((h * 33) ^ ws.charCodeAt(i)) >>> 0;
  return ((weapons[id] || {}).weapons || []).length + '/' + sk + '/' + h.toString(16);
}

/** 감시 목록이 비어 있을 때(처음 도입할 때) 최신 페이지부터 채워 넣는다.
 *  기체가 **언제 추가됐는지**를 따로 기록해 두지 않아서, atwiki 페이지 번호를 대신 쓴다 —
 *  번호는 새로 만들수록 커지므로 큰 쪽이 최근 기체다. */
function seed(ids) {
  const watch = {};
  const newest = ids.filter(i => /^\d+$/.test(i)).sort((a, b) => Number(b) - Number(a)).slice(0, SEED_NEWEST);
  for (const id of newest) watch[id] = { since: today(), sig: '', same: 0 };
  return watch;
}

/** 이번에 다시 받을 페이지. 캐시가 REFETCH_DAYS 보다 오래된 감시 대상만 고른다. */
function due(ROOT, watch) {
  const now = Date.now();
  const out = [];
  for (const [id, w] of Object.entries(watch)) {
    const f = path.join(ROOT, 'raw', 'wiki', id + '.html');
    let mt = 0;
    try { mt = fs.statSync(f).mtimeMs; } catch { mt = 0; }
    if (!mt || now - mt >= REFETCH_DAYS * DAY) out.push(id);
  }
  return out;
}

/** 새로 받은 페이지를 감시 목록에 올린다(이미 있으면 그대로 둔다). */
function add(watch, ids) {
  for (const id of ids) if (!watch[id]) watch[id] = { since: today(), sig: '', same: 0 };
  return watch;
}

/** 받아 본 뒤 — 값이 그대로면 같은 횟수를 올리고, 다 찼다고 판단되면 감시를 뗀다.
 *  반환: 이번에 감시에서 뗀 페이지와, 값이 바뀐(=아직 채워지는 중인) 페이지. */
function settle(ROOT, watch, ids, weapons, skills, baseByPage) {
  const done = [], moved = [];
  const now = Date.now();
  for (const id of ids) {
    const w = watch[id];
    if (!w) continue;
    const sig = sigOf(weapons, skills, id, baseByPage.get(id) || '');
    if (w.sig && sig === w.sig) w.same = (w.same || 0) + 1;
    else { if (w.sig) moved.push(id); w.same = 0; }
    w.sig = sig;
    w.last = today();
    const aged = w.since && (now - Date.parse(w.since + 'T00:00:00Z')) >= MAX_DAYS * DAY;
    if (w.same >= STABLE_HITS || aged) { delete watch[id]; done.push(id); }
  }
  save(ROOT, watch);
  return { done, moved };
}

module.exports = { load, save, seed, due, add, settle, sigOf, REFETCH_DAYS, STABLE_HITS, MAX_DAYS, SEED_NEWEST };
