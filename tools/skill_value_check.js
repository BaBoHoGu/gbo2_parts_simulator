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

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
