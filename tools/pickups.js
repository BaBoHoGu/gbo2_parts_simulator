// 토큰 계산기의 픽업 일정을 data/pickups.json 으로 받아 온다.
//
//   node tools/pickups.js            갱신기까지 돌리고 받아 온다
//   node tools/pickups.js --extract  이미 갱신된 HTML 에서 뽑아오기만 한다
//
// 왜 이렇게 나눴나 — 픽업을 긁어 오는 갱신기(update_pickups.ps1)는 토큰 저장소에 있고,
// 거기서 KR/JP/EN 세 벌이 check_sync.ps1 로 로직 동일성을 강제받는다. 파츠로 옮겨 놓으면
// 네 번째 사본이 생겨 조용히 어긋난다. 그래서 **갱신기는 그대로 두고 산출물만 받는다.**
//
// 토큰 저장소가 없는 사람(이 저장소만 클론한 경우)에서는 그냥 건너뛴다 —
// data/pickups.json 은 커밋돼 있으므로 빌드는 그대로 된다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'pickups.json');
// 기본은 형제 폴더. 다른 데 두었으면 GBO2_TOKEN_REPO 로 알린다.
const REPO = process.env.GBO2_TOKEN_REPO || path.join(ROOT, '..', 'token');
const HTML = path.join(REPO, 'token_calculator.html');
const SCRIPT = path.join(REPO, 'update_pickups.ps1');

const skip = msg => { console.log('  건너뜀 — ' + msg); process.exit(0); };

if (!fs.existsSync(HTML)) skip('토큰 계산기 원본이 없습니다 (' + HTML + ')');

// ── 1) 갱신기를 돌린다 ──────────────────────────────────────────────
// 실패해도 멈추지 않는다. 갱신기 자신이 「둘 다 실패하면 기존 저장본 유지」로 만들어져 있어,
// 못 긁어 온 날은 어제 것이 그대로 남는다. 배포를 막을 이유가 없다.
if (!process.argv.includes('--extract')) {
  if (!fs.existsSync(SCRIPT)) skip('갱신기가 없습니다 (' + SCRIPT + ')');
  try {
    console.log('  픽업 일정 수신 중…');
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { cwd: REPO, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
    const last = out.trim().split(/\r?\n/).slice(-1)[0];
    if (last) console.log('  ' + last.trim());
  } catch (e) {
    console.log('  수신 실패 — 마지막으로 받아 둔 일정을 그대로 씁니다. (' +
      String(e.message).split('\n')[0].slice(0, 80) + ')');
  }
}

// ── 2) HTML 에서 데이터 블록을 뽑는다 ───────────────────────────────
const src = fs.readFileSync(HTML, 'utf8');

// JS 객체 리터럴 → JSON. 갱신기가 찍는 형태(홑따옴표 문자열, 따옴표 없는 키, null)만 다룬다.
// 마음대로 쓴 JS 를 삼키려 들지 않는다 — 형태가 달라지면 여기서 터지는 편이 낫다.
function toJson(block, name) {
  const m = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\n  \\];').exec(block);
  if (!m) throw new Error(name + ' 배열을 못 찾았습니다');
  let raw = '[' + m[1] + ']';
  raw = raw.replace(/'((?:[^'\\]|\\.)*)'/g, (_, s) => JSON.stringify(s.replace(/\\'/g, "'")));
  raw = raw.replace(/([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  raw = raw.replace(/,\s*\]/g, ']');
  return JSON.parse(raw);
}

function grab(startMark, endMark) {
  const i = src.indexOf(startMark), k = src.indexOf(endMark);
  if (i < 0 || k < 0 || k < i) throw new Error(startMark + ' 마커가 없습니다');
  return src.slice(i, k + endMark.length);
}

const dateOf = (block, name) =>
  (new RegExp("const " + name + " = '([^']*)'").exec(block) || ['', ''])[1];

/* 픽업은 **목요일에 갈린다.** 받아 온 32건 중 31건이 목→목인데, 딱 하나가 일요일이었다.
 * 원문을 보니 갱신기가 **공지 게시일**을 개최일로 읽은 것이었다 —
 * 「2026.07.19 (게시) … 2026년 7월 23일(목) 14:00부터 실시」 인데 07-19 를 집었다.
 * 그래서 추정 출현일이 09-20(일)이 되어 플린트(09-17목~09-24목) **한가운데서 시작**했다.
 * 공지는 개최보다 먼저 나오므로 어긋난 날짜는 **다음 목요일로** 민다 — 07-23 → 09-24 가 되어
 * 원문과 정확히 맞고 겹침도 사라진다. 이미 목요일인 31건은 그대로다.
 * 원래 값은 startRaw 로 남긴다(고친 사실을 지우지 않는다). */
const DAY = 86400000;
function snapToThursday(list) {
  let fixed = 0;
  for (const p of list) {
    if (!p.start) continue;
    const [y, m, d] = p.start.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getDay() === 4) continue;                  // 이미 목요일
    const span = p.end ? Math.round((new Date(...p.end.split('-').map((v, i) => i === 1 ? +v - 1 : +v)) - dt) / DAY) : 7;
    const add = (4 - dt.getDay() + 7) % 7;            // 다음 목요일까지
    const ns = new Date(+dt + add * DAY);
    const ne = new Date(+ns + (span > 0 ? span : 7) * DAY);
    const f = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0')
      + '-' + String(x.getDate()).padStart(2, '0');
    p.startRaw = p.start; p.endRaw = p.end;
    p.start = f(ns); p.end = f(ne);
    fixed++;
  }
  if (fixed) console.log('  시작 요일을 목요일로 맞춘 항목 ' + fixed + '건');
  return list;
}

const pk = grab('// PICKUPS_START', '// PICKUPS_END');
const sn = grab('// STEAMNEWS_START', '// STEAMNEWS_END');
const data = {
  pickupsUpdated: dateOf(pk, 'PICKUPS_UPDATED'),
  pickups: snapToThursday(toJson(pk, 'PICKUPS')),
  steamUpdated: dateOf(sn, 'STEAM_NEWS_UPDATED'),
  steamNews: toJson(sn, 'STEAM_NEWS')
};

// 빈 걸로 덮어써서 화면을 비우는 일은 없어야 한다.
if (!data.pickups.length && !data.steamNews.length)
  skip('뽑아낸 일정이 비어 있습니다 — 기존 저장본을 지키고 넘어갑니다');

// ── 이력 ── 「예상 날짜가 지났는데 스팀에 안 나온 것」은 지금 스냅샷만으로는 못 본다.
// 갱신기가 지난 항목을 예보에서 지우기 때문이다 — 기라 줄루(CM) 가 그렇게 사라졌다
// (8/29 에는 09-10 예정으로 있었고, 9/17 에는 예보에도 스팀에도 없다).
// 그래서 **본 적 있는 예보**를 여기 쌓아 둔다. 한 번 본 것은 날짜를 덮어쓰지 않는다 —
// 나중 갱신에서 날짜가 밀리면 「처음 약속」이 무엇이었는지가 판단의 기준이라서다.
const HIST = path.join(ROOT, 'data', 'pickups.history.json');
const hist = fs.existsSync(HIST) ? JSON.parse(fs.readFileSync(HIST, 'utf8')) : { seen: {} };
if (!hist.seen) hist.seen = {};
let added = 0;
for (const p of data.pickups) {
  const key = String(p.name || '').trim();
  if (!key || !p.start) continue;
  if (!hist.seen[key]) {
    hist.seen[key] = { firstSeen: data.pickupsUpdated, start: p.start, end: p.end,
      consoleStart: p.consoleStart || '', tokens: p.tokens == null ? null : p.tokens };
    added++;
  }
}
hist.updated = data.pickupsUpdated;
fs.writeFileSync(HIST, JSON.stringify(hist, null, 1), 'utf8');
console.log('  이력 ' + Object.keys(hist.seen).length + '건' + (added ? ' (새로 ' + added + '건)' : ''));

const next = JSON.stringify(data, null, 1);
// 줄바꿈(CRLF/LF)까지 비교하면 git 이 체크아웃한 파일은 늘 「갱신」으로 뜬다. 내용만 본다.
const prev = fs.existsSync(OUT)
  ? JSON.stringify(JSON.parse(fs.readFileSync(OUT, 'utf8')), null, 1) : '';
fs.writeFileSync(OUT, next, 'utf8');
console.log('  픽업 ' + data.pickups.length + '건(' + data.pickupsUpdated + ') · 스팀 ' +
  data.steamNews.length + '건(' + data.steamUpdated + ')' + (next === prev ? ' — 변화 없음' : ' — 갱신'));

// 갱신기는 **남의 저장소**(토큰)의 파일을 고친다. 그대로 두면 배포할 때마다 그쪽에
// 커밋 안 된 변경이 쌓이고, 본인은 파츠만 보고 있어 눈치채지 못한다. 알려만 준다.
// jp/·en/ 은 각자 갱신기가 따로라 여기서 건드리지 않는다 — check_sync 는 로직만 보고
// 데이터 차이는 안 잡으므로, 세 벌을 맞추려면 그쪽 run.bat 을 따로 돌려야 한다.
try {
  const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain'],
    { encoding: 'utf8', timeout: 20000 }).trim();
  if (dirty) {
    console.log('  ⚠ 토큰 저장소에 커밋되지 않은 변경이 있습니다:');
    for (const l of dirty.split(String.fromCharCode(10)).slice(0, 4)) console.log('      ' + l.trim());
    console.log('      (jp·en 은 각자 run.bat 을 돌려야 같은 일정이 됩니다)');
  }
} catch { /* git 이 없거나 저장소가 아니면 넘어간다 */ }
