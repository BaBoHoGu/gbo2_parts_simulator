// 번역 사전을 **데이터만 보고** 검수한다 — 브라우저 없이 몇 초에 끝난다.
//
//   node tools/dict_check.js
//
// 왜 따로 두나 — 이 검사들은 원래 weapon_value_check 안에 있었는데, 그 파일은 첫머리에서
// Chrome 이 없으면 `process.exit(0)` 으로 빠진다. 그래서 **Chrome 없는 자리에서는
// 아예 안 돌았다** — 하필 배포본(update.bat → gates --fast)이 바로 그 자리다.
// 사전이 깨지는 사고는 전부 거기서 났는데, 정작 거기서 검사가 안 돌고 있었다.
//
// 여기서 보는 것 셋:
//   ① 사전에 「null」이 박히지 않았는가 — MT 실패를 문자열로 감싸면 "null" 이 된다
//   ② 무장 이름이 전부 한글인가 — 빌더는 말만 하고 배포를 안 막는다
//   ③ 무장 설명(備考)이 전부 한글인가 — 사전은 **문장 전체**가 열쇠라 원문이 한 글자만
//      바뀌어도 그 무장만 조용히 일본어로 돌아간다
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const rdSafe = (...p) => { try { return rd(...p); } catch { return null; } };

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra, null, 1) : '')); }
};

const KANA = /[ぁ-ゖァ-ヺ]/;

/* ── ① 「null」이 박히지 않았는가 ──
   MT 가 실패하면 null 을 돌려주는데, 그걸 String() 으로 감싸면 문자열 "null" 이 된다.
   일본어가 없으니 **번역 성공으로 통과**해 사전 19칸에 「null」이 박혔다(2026-09-23).
   화면에는 설명 한 줄이 통째로 「null」로 나온다. 눈으로만 잡히는 부류라 여기서 센다.
   *.auto.json 도 본다 — 거기가 실제 MT 출력 캐시다. */
const DICTS = ['weapon_note.json', 'skill_text.json', 'skills.json', 'parts.json', 'ms.json',
  'ms.auto.json', 'parts.auto.json', 'weapons.json'];
function nullCells() {
  const hit = [];
  for (const f of DICTS) {
    const d = rdSafe('data', 'i18n', f);
    if (!d) continue;
    for (const [k, v] of Object.entries(d)) {
      // 값이 객체면 이름(n)·설명(d)을 **둘 다** 본다. `v.d || v.n` 은 d 가 있으면 n 을 영영 안 본다.
      const texts = typeof v === 'string' ? [v]
        : (v && typeof v === 'object' ? [v.n, v.d].filter(x => typeof x === 'string') : []);
      for (const t of texts) if (/(^|[\s/])null([\s/]|$)/.test(t)) hit.push(f + ' : ' + k.slice(0, 30));
    }
  }
  return hit;
}

/* ── ③ 무장 설명이 전부 한글인가 ── */
function noteCoverage() {
  const dict = rd('data', 'i18n', 'weapon_note.json');
  const weapons = rd('data', 'weapons.json');
  let tot = 0;
  const miss = [], ja = [];
  for (const v of Object.values(weapons)) {
    for (const w of (v.weapons || [])) {
      const note = String(((w.info || {})['備考']) || '');
      if (!note) continue;
      tot++;
      const ko = dict[note];
      const who = (v.names || ['?'])[0] + ' / ' + w.name;
      if (ko == null) miss.push(who);
      else if (KANA.test(ko)) ja.push(who);
    }
  }
  return { tot, miss, ja };
}

/* ── ④ 번역이 **중간에 잘리지 않았는가** ──
   MT 는 반각 ? 를 문장 끝으로 읽고 뒤를 버린다. 위키는 값이 불확실할 때 ? 를 붙이므로
   「よろけ値を 80%?かつ小数点以下切り捨て で計算する」가 「경직치를 80%?」에서 끊겨
   **뒷문장이 통째로 사라졌다**(2026-09-24, 2칸). 일본어도 null 도 안 남아 아무 검사에 안 걸렸다.
   판정: 원문의 ? 뒤에 글자가 더 있는데 번역이 ? 로 끝났으면 잘린 것이다. */
function truncated() {
  const hit = [];
  for (const f of ['skill_text.json', 'weapon_note.json']) {
    const d = rdSafe('data', 'i18n', f);
    if (!d) continue;
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== 'string') continue;
      const a = k.split(' / '), b = v.split(' / ');
      if (a.length !== b.length) continue;
      for (let i = 0; i < a.length; i++) {
        const m = /[?？](.+)/.exec(a[i]);
        if (m && m[1].trim().length >= 4 && /[?？]\s*$/.test(b[i])) {
          hit.push(f + ' : ' + a[i].slice(0, 40));
          break;
        }
      }
    }
  }
  return hit;
}

const cut = truncated();
ok('번역이 중간에 잘리지 않았다', cut.length === 0,
  { 잘린것: cut.slice(0, 5), 원인: 'MT 가 반각 ? 를 문장 끝으로 읽는다 — glossary.js protect() 가 전각으로 보낸다' });

const nulls = nullCells();
console.log('번역 사전 ' + DICTS.length + '개를 봅니다\n');
ok('사전에 「null」이 박히지 않았다', nulls.length === 0,
  { 걸린것: nulls.slice(0, 5), 원인: 'MT 실패를 문자열로 감싸면 "null" 이 된다 — glossary.js post()' });

const wdict = rd('data', 'i18n', 'weapons.json');
const jaName = Object.entries(wdict)
  .filter(([, ko]) => KANA.test(String(ko)))
  .map(([ja, ko]) => ja + ' → ' + ko);
console.log('무장 이름 — ' + Object.keys(wdict).length + '종 · 일본어가 남은 것 ' + jaName.length);
ok('무장 이름이 전부 한글로 나온다', jaName.length === 0,
  { 남은것: jaName.slice(0, 5), 고치는법: 'weapon_terms.json 에 용어를 더하거나 규칙을 고칠 것' });

const nc = noteCoverage();
console.log('무장 설명 — 備考 있는 무장 ' + nc.tot + '종 · 번역 없음 ' + nc.miss.length
  + ' · 번역에 일본어 남음 ' + nc.ja.length);
ok('무장 설명이 전부 한글로 나온다', nc.miss.length === 0 && nc.ja.length === 0,
  { 번역없음: nc.miss.slice(0, 5), 일본어: nc.ja.slice(0, 5), 메꾸는법: 'node tools/translate_notes.js' });
// 0 이면 「아무것도 안 쟀다」로도 통과한다 — 실제로 쟀는지 개수로 확인한다
ok('설명을 실제로 셌다 (3000종 이상)', nc.tot > 3000, { 센것: nc.tot });

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
