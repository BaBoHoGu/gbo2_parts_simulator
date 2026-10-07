// 최근 **새로 들어온 기체·LV** 을 git 이력에서 찾아 data/patch.json 에 채운다.
//   node tools/patch_recent.js [일수]        (기본 90일)
//
// 왜 따로 두는가 — update.js 는 **그 실행에서 새로 받은 것**만 안다. 이미 들어와 있는
// 「며칠 전에 추가된 LV」은 알 길이 없어, 보험 목록이 처음에는 비어 있다.
// 여기서는 저장소에 남은 msData.json 의 옛 모습과 지금을 견줘 그 사이에 늘어난 것을 찾는다.
// (다음부터는 update.js 가 알아서 적는다)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const DAYS = Number(process.argv[2] || 90);
const baseOf = n => String(n).replace(/_LV\d+$/, '');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** 그 시점의 msData.json 이름 목록. 못 읽으면 null. */
function namesAt(rev) {
  try { return JSON.parse(git('show', rev + ':data/msData.json')).map(m => String(m.MS名)); }
  catch { return null; }
}

/* 커밋을 **차례로 훑는다.** 처음에는 「DAYS 일 전과 지금」만 견줬는데, 그러면 추가된
   날짜를 알 수 없어 전부 오늘 들어온 것처럼 적히고, 석 달 전에 늘어난 LV 이 앞으로
   석 달 더 보험을 받는다. 보험은 「언제 바뀌었나」가 전부라 그 날짜가 틀리면 뜻이 없다. */
const revs = git('log', '--reverse', '--format=%H %ad', '--date=short', '--', 'data/msData.json')
  .trim().split('\n').filter(Boolean).map(l => {
    const i = l.indexOf(' ');
    return { rev: l.slice(0, i), at: l.slice(i + 1).trim() };
  });
if (!revs.length) { console.error('msData.json 의 기록이 없습니다.'); process.exit(1); }

const cutAt = new Date(Date.now() - DAYS * 86400e3).toISOString().slice(0, 10);
const events = [];
let prevNames = null;
for (const r of revs) {
  const names = namesAt(r.rev);
  if (!names) continue;
  if (prevNames) {
    const hadName = new Set(prevNames);
    const hadBase = new Set(prevNames.map(baseOf));
    for (const b of [...new Set(names.filter(n => !hadName.has(n)).map(baseOf))]) {
      // 날짜는 **그 커밋의 날짜**다. 오래된 것은 아래에서 걸러낸다.
      events.push({ ms: b, why: hadBase.has(b) ? 'newLv' : 'new', at: r.at });
    }
  }
  prevNames = names;
}
// 같은 기체가 여러 번 걸리면 **가장 최근**만 남긴다 (LV 이 여러 번 붙을 수 있다)
const last = new Map();
for (const e of events) {
  const o = last.get(e.ms);
  if (!o || e.at >= o.at) last.set(e.ms, e);
}
const now = prevNames || [];
/* 지금 자료에 없는 이름은 버린다. 표기가 바뀌면 옛 이름이 「새로 생긴 것」으로 한 번,
   새 이름이 또 한 번 잡힌다 — 실제로 ゲルググＲ(전각)·ゲルググR(반각),
   カプル（ＣＮ）·カプル（CN） 가 그렇게 둘씩 들어왔다. 옛 이름은 어떤 영상과도 안 맞아
   아무 일도 못 하면서 목록만 흐린다. */
const live = new Set(now.map(baseOf));
const fresh = [...last.values()].filter(e => e.at >= cutAt && live.has(e.ms));
events.length = 0; events.push(...fresh);

const P = path.join(ROOT, 'data', 'patch.json');
const pj = JSON.parse(fs.readFileSync(P, 'utf8'));
const prev = Array.isArray(pj.events) ? pj.events : [];
const seen = new Set(prev.map(e => e && e.ms));
pj.events = [...prev, ...events.filter(e => !seen.has(e.ms))]
  .sort((a, b) => String(a.ms).localeCompare(String(b.ms)));
fs.writeFileSync(P, JSON.stringify(pj, null, 1) + '\n');

const lv = events.filter(e => e.why === 'newLv'), nw = events.filter(e => e.why === 'new');
console.log(`커밋 ${revs.length}개를 훑었습니다 · 지금 ${now.length}항목 · ${cutAt} 이후만 셉니다`);
console.log(`LV 추가 ${lv.length}기: ` + (lv.map(e => e.ms + '(' + e.at + ')').join(' / ') || '없음'));
console.log(`신규 기체 ${nw.length}기: ` + (nw.map(e => e.ms + '(' + e.at + ')').join(' / ') || '없음'));
console.log(`→ data/patch.json (보험 대상 ${pj.events.length}기)`);
