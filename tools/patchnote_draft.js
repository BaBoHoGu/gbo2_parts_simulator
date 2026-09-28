// 오늘 자 패치노트 **초안**을 이번 실행에서 실제로 바뀐 것으로 적는다.
//
//   node tools/patchnote_draft.js          없으면 넣는다
//   node tools/patchnote_draft.js --print   넣지 않고 무엇을 적을지만 보여 준다
//
// 왜 만드나 — 배포는 「패치노트에 오늘 항목이 없습니다」라고 **경고만** 하고 그대로
// ZIP 에 넣는다. 사람이 잊으면 새 버전에 낡은 안내문이 들어간다.
//
// **지어내지 않는다.** 적는 것은 수와 이름뿐이다 — 「좋아졌습니다」 같은 말은 사람이 쓴다.
// 이 저장소에서 「상승」처럼 요약해 지어낸 말이 원문의 값을 지운 적이 있다.
// 그래서 초안은 사실만 적고, 맨 위에 「다듬어 주세요」 표시를 남긴다.
//
// 바뀐 것은 git 이 이미 안다 — HEAD 의 data/ 와 지금 작업본을 견준다.
// 따로 기록을 만들지 않는 이유: 만들면 그 기록과 실제가 언젠가 어긋난다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NOTE = path.join(ROOT, '패치노트.md');
const PRINT = process.argv.includes('--print');
const today = new Date().toISOString().slice(0, 10);

const rd = p => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; } };
/** HEAD 시점의 파일. 없으면 null (새 파일이거나 git 밖). */
const head = p => {
  try {
    return JSON.parse(execFileSync('git', ['-C', ROOT, 'show', 'HEAD:' + p], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024
    }));
  } catch { return null; }
};

/* 이름은 **수동 사전이 자동 사전을 이긴다** — 앱과 같은 순서다.
   자동 사전을 안 보면 「カプル（ＣＮ）」처럼 사람이 손대지 않은 기체가 일본어로 남는다. */
const msKo = Object.assign({}, rd('data/i18n/ms.auto.json') || {}, rd('data/i18n/ms.json') || {});
const baseName = n => String(n).replace(/_LV\d+$/, '');
const koName = ja => msKo[ja] || ja;

function changes() {
  const out = { newMs: [], weap: [], skill: [], parts: 0 };

  // 기체 — 미러에 새로 들어온 것
  const msA = head('data/msData.json'), msB = rd('data/msData.json');
  if (msA && msB) {
    const had = new Set(msA.map(m => m.MS名));
    for (const m of msB) if (!had.has(m.MS名)) out.newMs.push(koName(baseName(m.MS名)) + ' ' + (m.MS名.match(/LV\d+/) || [''])[0]);
  }

  // 무장 — 페이지별 개수·내용
  const wA = head('data/weapons.json'), wB = rd('data/weapons.json');
  if (wA && wB) {
    for (const id of Object.keys(wB)) {
      const a = wA[id], b = wB[id];
      if (!b) continue;
      const na = a ? (a.weapons || []).length : 0;
      const nb = (b.weapons || []).length;
      const same = a && JSON.stringify(a) === JSON.stringify(b);
      if (same) continue;
      out.weap.push({ ms: koName(baseName((b.names || ['?'])[0])), from: na, to: nb });
    }
  }

  // 스킬
  const sA = head('data/ms_skills.json'), sB = rd('data/ms_skills.json');
  if (sA && sB) {
    for (const k of Object.keys(sB)) {
      if (sA[k] && JSON.stringify(sA[k]) === JSON.stringify(sB[k])) continue;
      out.skill.push(koName(k));
    }
  }

  // 파츠
  const pA = head('data/parts.json'), pB = rd('data/parts.json');
  if (pA && pB && JSON.stringify(pA) !== JSON.stringify(pB)) out.parts = 1;

  return out;
}

/** 바뀐 것을 항목으로 적는다 — 새 절과 덧붙임이 같은 사실을 쓰므로 한 곳에 둔다. */
function facts(c) {
  const L = [];
  if (c.newMs.length) {
    L.push(`- **새 기체 ${c.newMs.length}기** — ${c.newMs.slice(0, 12).join(' · ')}`
      + (c.newMs.length > 12 ? ` 외 ${c.newMs.length - 12}기` : ''));
  }
  if (c.weap.length) {
    const grew = c.weap.filter(x => x.to !== x.from);
    L.push(`- **무장이 바뀐 기체 ${c.weap.length}기**`
      + (grew.length ? ` — 개수가 바뀐 것: ${grew.slice(0, 8).map(x => `${x.ms}(${x.from}→${x.to})`).join(' · ')}` : ' (수치·설명)'));
  }
  if (c.skill.length) {
    L.push(`- **스킬이 바뀐 기체 ${c.skill.length}기** — ${c.skill.slice(0, 8).join(' · ')}`
      + (c.skill.length > 8 ? ` 외 ${c.skill.length - 8}기` : ''));
  }
  if (c.parts) L.push('- **파츠 데이터**가 갱신됐습니다');
  return L;
}

const DRAFT_MARK = ['<!-- 자동 초안입니다. 아래는 **이번에 실제로 바뀐 것**만 적혀 있습니다.',
  '     문구를 다듬고 이 주석을 지워 주세요. 지어낸 말은 넣지 않았습니다. -->'];

/** 오늘 절이 아직 없을 때 — 절을 통째로 만든다. */
function draft(c, nl) {
  return [`_${today} 업데이트_`, '', ...DRAFT_MARK, '', '## 🔄 데이터 갱신', '',
    ...facts(c), '', '---', ''].join(nl);
}

/** 오늘 절이 이미 있을 때 — 그 절 **끝에** 사실만 덧붙인다.
 *  여태 「이미 있습니다」라며 아무것도 넣지 않았다. 사람 글을 덮지 않으려는 뜻은 맞지만,
 *  하루에 두 번 배포하면 **두 번째 실행의 변경이 조용히 사라졌다** — 실제로 2026-09-28
 *  두 번째 배포에서 위키 수치 수정(214→212발/분 등)이 한 줄도 남지 않았다.
 *  사람이 쓴 절을 건드리지 않으면서 기록은 남기려면, 끝에 붙이는 것이 답이다. */
function addendum(c, nl) {
  return ['## 🔄 데이터 갱신 (덧붙임)', '', ...DRAFT_MARK, '', ...facts(c), ''].join(nl);
}

const c = changes();
const total = c.newMs.length + c.weap.length + c.skill.length + c.parts;
if (!total) {
  console.log('패치노트 초안: 이번에 바뀐 데이터가 없어 적을 것이 없습니다.');
  process.exit(0);
}

let note;
try { note = fs.readFileSync(NOTE, 'utf8'); } catch { console.log('패치노트.md 가 없어 건너뜁니다.'); process.exit(0); }
/* **이 파일의 줄끝을 따른다.** 여태 '\n' 으로 박아 넣어, CRLF 파일 안에 LF 절이
   끼어들었다 — 다음에 그 절을 찾는 쪽이 줄끝을 헛짚게 되는 씨앗이다. */
const nl = /\r\n/.test(note) ? '\r\n' : '\n';

if (PRINT) { console.log(draft(c, nl)); process.exit(0); }

// 사람이 이미 오늘 자 절을 써 뒀으면 그 글은 **건드리지 않고**, 절 끝에 덧붙인다.
const todaySec = new RegExp('(^|\\r?\\n)_' + today + ' 업데이트[^\\r\\n]*(\\r?\\n)').exec(note);
if (todaySec) {
  const from = todaySec.index + todaySec[0].length;
  const end = /\r?\n---\r?\n/.exec(note.slice(from));
  const at = end ? from + end.index + (end[0].startsWith('\r') ? 2 : 1) : note.length;
  fs.writeFileSync(NOTE, note.slice(0, at) + addendum(c, nl) + nl + note.slice(at));
  console.log(`패치노트 오늘(${today}) 절 끝에 덧붙였습니다 — `
    + `기체 ${c.newMs.length} · 무장 ${c.weap.length} · 스킬 ${c.skill.length}`);
  console.log('  (사람이 쓴 글은 건드리지 않았습니다. 사실만 적혀 있습니다.)');
  process.exit(0);
}
const body = draft(c, nl);
/* 첫 번째 「---」 구분선 **뒤**가 절이 쌓이는 자리다(위쪽은 내려받기 안내).
   줄끝을 '\n' 으로 박아 찾으면 안 된다 — 이 파일은 CRLF 라 한 번도 못 찾고
   「넣을 자리를 못 찾아 건너뜁니다」만 찍었다(2026-09-23 배포에서 확인). */
const m = /\r?\n---\r?\n/.exec(note);
if (!m) { console.log('패치노트에서 넣을 자리를 못 찾아 건너뜁니다.'); process.exit(0); }
const at = m.index;
const cut = at + m[0].length;
fs.writeFileSync(NOTE, note.slice(0, cut) + nl + body + note.slice(cut).replace(/^(\r?\n)+/, ''));
console.log(`패치노트에 ${today} 초안을 넣었습니다 — 기체 ${c.newMs.length} · 무장 ${c.weap.length} · 스킬 ${c.skill.length}`);
console.log('  (사실만 적혀 있습니다. 문구는 다듬어 주세요.)');
