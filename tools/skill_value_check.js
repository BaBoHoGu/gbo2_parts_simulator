// 버프 스킬 표(data/skills.json)의 수치가 **원문에 실제로 적힌 값인가**를 본다.
//
//   node tools/skill_value_check.js
//
// 왜 필요한가 — 원문을 읽는 정규식이 값을 **조용히 잘라** 넣고 있었다.
// 숫자 뒤에 「% 가 아닐 것」만 붙이면 정규식이 되돌아가며 자릿수를 줄여 조건을 맞춘다:
//   「旋回 ＋100%」 → 旋回 ＋10   「高速移動 －50%」 → －5   「射撃補正 ＋30%」 → ＋3
// 그래서 Ζ 계열·건탱크 11기에 없는 선회 +10 이 붙었고, 그리모어(白·青)는
// **적에게 거는** 「高速移動 －50%」를 내 고속이동 −5 로 옮겨 놓았다.
// 값이 잘리면 원문 어디에도 없는 수가 표에 남는다 — 그것을 전수로 찾는 검사다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));

const skills = J('skills.json');
const msSkills = J('ms_skills.json');

// 기체 → 스킬명 → 원문(설명+효과) 통짜
const orig = {};
for (const [ms, forms] of Object.entries(msSkills)) {
  orig[ms] = orig[ms] || {};
  for (const f of forms) for (const s of (f.skills || [])) {
    orig[ms][s.name] = (orig[ms][s.name] || '') + ' / ' + (s.desc || '') + ' / ' + (s.eff || '');
  }
}

// 정수로 들어가는 축만 본다. % 축(dmgAny 등)은 원문에도 % 와 함께 적혀 있어 같은 방식으로 센다.
const AX = ['shoot', 'melee', 'turn', 'speed', 'hispeed', 'thruster',
  'armorRange', 'armorBeam', 'armorMelee', 'hpUp',
  'dmgAny', 'dmgShoot', 'dmgMelee', 'shootPct', 'meleePct', 'crouchPct', 'limitUp'];

/* 「…付与」로 받는 스킬은 다른 기체에서 빌려 온 수치라 그 기체 원문에는 없다.
   이것은 의도한 동작이므로(skills.override.json·부여 자동 반영) 검사에서 뺀다. */
const GRANTED = new Set(['対空射撃補助プログラム', 'サイコフレーム展開']);

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra, null, 1) : '')); }
};

// ── ① 표의 값이 원문에 있는가 (전수) ────────────────────────────
const ghosts = [];
for (const [ms, list] of Object.entries(skills)) {
  const src = orig[ms] || {};
  for (const sk of list) {
    if (GRANTED.has(sk.name)) continue;
    const txt = src[sk.name];
    if (txt == null) continue;                     // 원문에 없는 스킬(override)은 위에서 걸렀다
    const nums = new Set((txt.match(/\d+/g) || []).map(Number));
    for (const lv of (sk.levels || [])) {
      for (const ax of AX) {
        const v = lv[ax] || 0;
        if (v && !nums.has(Math.abs(v))) ghosts.push({ ms, sk: sk.name, ax, v });
      }
    }
  }
}
console.log('스킬 표 검수 — 기체 ' + Object.keys(skills).length + '기\n');
ok('표의 모든 수치가 원문에 있는 값이다', ghosts.length === 0, ghosts.slice(0, 8));

// ── ② 잘라 읽던 자리를 이름으로 못 박는다 ───────────────────────
/* 「旋回 ＋100%」는 **비율**이라 담을 축이 없다. 지어내느니 안 읽는 것이 맞다.
   예전에는 +10 이라는, 원문 어디에도 없는 수가 들어가 있었다. */
const turnPct = [];
for (const [ms, list] of Object.entries(skills)) {
  for (const sk of list) {
    const txt = (orig[ms] || {})[sk.name];
    if (!txt || !/旋回(?:性能)?\s*[＋+]\s*\d+\s*[%％]/.test(txt)) continue;
    for (const lv of (sk.levels || [])) if (lv.turn) turnPct.push({ ms, sk: sk.name, turn: lv.turn });
  }
}
ok('「선회 ＋N%」를 정수 선회로 읽지 않는다', turnPct.length === 0, turnPct.slice(0, 6));

/* 그리모어는 「範囲…の敵機へ以下の効果を付与 ・高速移動 －50%」 — **적에게** 거는 디버프다.
   내 기동 축에 들어가면 안 된다. 값이 잘려 −5 로 들어가 있었다. */
const grimoire = [];
for (const [ms, list] of Object.entries(skills)) {
  for (const sk of list) {
    if (!/^グリモア/.test(sk.name)) continue;
    for (const lv of (sk.levels || [])) if ((lv.hispeed || 0) < 0) grimoire.push({ ms, sk: sk.name, hispeed: lv.hispeed });
  }
}
ok('적에게 거는 디버프를 내 기동 축에 넣지 않는다', grimoire.length === 0, grimoire);

// ── ③ 정규식 자체를 직접 눌러 본다 ──────────────────────────────
/* 위 둘은 「지금 데이터에 그런 문구가 있어서」 걸린다. 문구가 사라지면 검사도 함께 잠든다.
   그래서 생성기가 쓰는 꼴을 그대로 가져와 **직접** 눌러 본다 — 데이터와 무관하게 남는다. */
// 손으로 베껴 두면 생성기가 바뀌어도 여기는 옛 모양을 계속 통과시킨다.
// 그래서 **생성기 파일에서 그 줄을 직접 꺼내** 눌러 본다.
const GEN = fs.readFileSync(path.join(ROOT, 'tools', 'find_buff_skills.js'), 'utf8');
const turnSrc = (GEN.match(/const turn = sgn\((\/.+?\/)\);/) || [])[1];
if (!turnSrc) { console.log('  FAIL 생성기에서 旋回 정규식을 못 찾았습니다'); process.exit(1); }
const RE = new RegExp(turnSrc.slice(1, -1));
const SAMPLES = [
  ['旋回 ＋100%', null], ['旋回性能 ＋50%', null], ['旋回 －20%', null],
  ['旋回 ＋20', '旋回 ＋20'], ['旋回性能 ＋100', '旋回性能 ＋100'], ['旋回 －5', '旋回 －5']
];
const bad = SAMPLES.filter(([t, want]) => {
  const m = RE.exec(t);
  return (m ? m[0] : null) !== want;
});
ok('％가 붙은 값은 자릿수를 줄여서라도 읽지 않는다', bad.length === 0,
  bad.map(([t]) => t + ' → ' + JSON.stringify((RE.exec(t) || [])[0] || null)));

/* ── 기체가 **통째로 빠지지 않았는가** ──────────────────────────────
   값이 맞는지만 보고 있었다. 그런데 2026-10-13 사용자가 「캐논 건담의 웨폰퍼지가
   스킬 적용에 안 뜬다」고 짚었다 — 값이 틀린 게 아니라 **그 기체가 표에 아예 없었다.**

   까닭: `find_buff_skills.js` 가 `msData.json` 만 읽었는데, 갓 나온 기체는 미러가
   `wiki_url` 을 비워 보내고 **`msData.override.json` 에만** 적힌다. 페이지 ID 가 안 잡히면
   그 기체의 위키를 아예 안 읽어 스킬이 0개가 되고, 앱은 목록이 비면 스킬 칸을 **숨긴다.**
   보정해 주는 공용 함수(`lib/msdata.js` 의 applyWikiOverride)가 이미 있었는데 안 불렀다.

   그래서 **들어왔는지**를 따로 센다: 오버라이드에만 wiki_url 이 있고, 그 위키 페이지가
   받아져 있으며, 거기 「射撃補正 ＋n」·「格闘補正 ＋n」이 적힌 기체는 skills.json 에 있어야 한다. */
{
  const ov = (() => { try { return J('msData.override.json'); } catch { return {}; } })();
  const ms = J('msData.json');
  const base = n => String(n).replace(/_LV\d+$/, '');
  const WIKI = path.join(ROOT, 'raw', 'wiki');
  const missing = [];
  const seenMs = new Set();
  for (const m of ms) {
    const o = ov[m.MS名];
    /* 오버라이드에만 있는 경우만 본다 — 미러에 이미 있으면 이 함정과 무관하다 */
    if (!o || !o.wiki_url || m.wiki_url) continue;
    const b = base(m.MS名);
    if (seenMs.has(b)) continue;
    seenMs.add(b);
    const id = (String(o.wiki_url).match(/pages\/(\d+)/) || [])[1];
    const f = id && path.join(WIKI, id + '.html');
    if (!f || !fs.existsSync(f)) continue;              // 안 받아 둔 페이지는 셀 수 없다
    const html = fs.readFileSync(f, 'utf8');
    /* 보정 수치가 적힌 스킬이 있는가 — 있으면 표에 있어야 한다 */
    if (!/(射撃補正|格闘補正)\s*[＋+]\s*\d/.test(html)) continue;
    if (!skills[b] || !skills[b].length) missing.push(b + ' (page ' + id + ')');
  }
  ok('오버라이드에만 wiki_url 이 있는 기체도 스킬 표에 들어온다', missing.length === 0,
    missing.slice(0, 5).join(' · '));
}

/* 사용자가 짚은 그 기체를 **글자로 못 박는다** — 되돌아가면 여기서 운다. */
{
  const cg = skills['キャノンガンダム'] || [];
  const wp = cg.find(x => x.name === 'ウェポンパージ');
  ok('캐논 건담에 웨폰 퍼지가 있다 (2026-10-13 사용자가 짚은 자리)', !!wp,
    cg.map(x => x.name).join(' · ') || '(스킬 없음)');
  ok('그 수치가 원문대로다 (사격 +10 · 격투 +35 · HP 60% 이하)',
    !!(wp && wp.levels && wp.levels[0] && wp.levels[0].shoot === 10
      && wp.levels[0].melee === 35 && wp.hp === 60),
    wp ? JSON.stringify({ shoot: wp.levels[0].shoot, melee: wp.levels[0].melee, hp: wp.hp }) : '(없음)');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
