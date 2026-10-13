// 위키 페이지↔기체를 잇는 도구가 **오버라이드 보정을 하는가.**
//   node tools/override_check.js
//
// ■ 왜 — gbo2.jp 미러는 갓 나온 기체의 `wiki_url` 을 **비워 보낸다.** 그 값은
//   `data/msData.override.json` 에만 있다. 보정을 안 하면 페이지 ID 가 안 잡혀
//   그 기체의 위키를 **아예 안 읽는다** — 무장도 스킬도 통째로 비는데, 아무도 안 운다.
//
// ■ 실제로 그랬다(2026-10-13): 캐논 건담의 「웨폰 퍼지」가 스킬 적용에 안 떴다.
//   `find_buff_skills.js` 가 `msData.json` 만 읽어 그 기체 스킬이 0개가 됐고,
//   앱은 목록이 비면 스킬 칸을 **통째로 숨긴다**. 보정해 주는 공용 함수
//   (`lib/msdata.js` 의 `applyWikiOverride`)가 이미 있었는데 거기만 안 불렀다.
//
// ■ **자료로는 이 회귀를 못 잡는다.** 추출기의 `--merge` 는 페이지를 못 읽으면
//   기존 항목을 **그대로 둔다** — 한 번 들어온 자료는 버그를 되돌려도 살아남는다.
//   (심어 보고 알았다: 보정을 되돌렸는데 skills.json 검사가 통과했다.)
//   그래서 **도구가 보정을 부르는지**를 본다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* 보정을 안 해도 되는 곳 — **까닭을 함께 적는다.** 이름만 적힌 목록은 썩는다. */
const ALLOW = {
  'tools/extract_burn.js': '위키 한 페이지(5891 특수 연소제 실측표)만 읽는다 — 기체↔페이지 매핑을 안 쓴다',
  'tools/patch_mechs.js': '「パラメータ調整」 목록 쪽을 읽는다 — 기체별 wiki_url 로 페이지를 찾지 않는다',
  'tools/hpcond_check.js': '검사다. 보정이 없으면 갓 나온 기체를 덜 볼 뿐, 제품이 틀리지는 않는다',
  'tools/stag2_check.js': '검사다. 같은 까닭'
};

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (f.endsWith('.js')) files.push(p);
  }
})(path.join(ROOT, 'tools'));

const blind = [], okd = [];
for (const p of files) {
  const t = fs.readFileSync(p, 'utf8');
  /* msData 를 읽고 **페이지 ID 를 뽑는** 도구만 본다 */
  if (!t.includes('msData.json')) continue;
  if (!/wiki_url/.test(t) || !/pages/.test(t)) continue;
  const rel = path.relative(ROOT, p).split(path.sep).join('/');
  /* **부르는지**를 본다 — 이름만 찾으면 `const { applyWikiOverride } = require(...)` 가
     남아 있는 것만으로 통과한다(심어 보고 알았다: 호출을 지웠는데 안 울었다). */
  if (/applyWikiOverride\s*\(/.test(t) || /msData\.override/.test(t)) okd.push(rel);
  else blind.push(rel);
}

ok('기체↔페이지를 잇는 도구를 찾았다', okd.length + blind.length >= 10,
  { 보정함: okd.length, 눈멈: blind.length });

/* ■ 새로 눈먼 도구가 생기면 운다. 목록에 **없는** 것만 잡는다 —
   목록에 있는 것을 고쳐도 울지 않는다(고치는 것은 언제나 환영이다). */
const unexpected = blind.filter(f => !ALLOW[f]);
ok('오버라이드 보정을 빠뜨린 새 도구가 없다', unexpected.length === 0,
  unexpected.map(f => f + ' — lib/msdata.js 의 applyWikiOverride 를 쓰세요'));

/* 사용자가 짚은 그 도구는 **반드시** 보정해야 한다 — 되돌아가면 여기서 운다.
   자료 검사로는 못 잡는 자리라(위 머리글 참고) 여기서 못 박는다. */
for (const f of ['tools/find_buff_skills.js', 'tools/extract_ms_skills.js', 'tools/extract_weapons.js'])
  ok('보정한다 — ' + f, okd.includes(f), { 눈멈: blind.includes(f) });

/* 공용 함수가 **살아 있는가** — 지워 놓고 호출만 남으면 전부 터진다 */
{
  let mod = null;
  try { mod = require(path.join(ROOT, 'tools', 'lib', 'msdata.js')); } catch (e) { /* 아래에서 운다 */ }
  ok('lib/msdata.js 의 applyWikiOverride 가 있다', !!(mod && typeof mod.applyWikiOverride === 'function'));
  if (mod && mod.applyWikiOverride) {
    /* 실제로 보정하는가 — 꾸민 자료로 잰다(진짜 자료가 바뀌어도 이 검사는 안 흔들린다) */
    const ovPath = path.join(ROOT, 'data', 'msData.override.json');
    const ov = fs.existsSync(ovPath) ? JSON.parse(fs.readFileSync(ovPath, 'utf8')) : {};
    const name = Object.keys(ov).find(k => ov[k] && ov[k].wiki_url);
    if (!name) console.log('  (건너뜀) override 에 wiki_url 이 하나도 없다');
    else {
      const fake = [{ MS名: name, wiki_url: '' }];
      mod.applyWikiOverride(fake, ROOT);
      ok('빈 wiki_url 을 override 값으로 채운다', fake[0].wiki_url === ov[name].wiki_url,
        { 넣은값: fake[0].wiki_url });
    }
  }
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
