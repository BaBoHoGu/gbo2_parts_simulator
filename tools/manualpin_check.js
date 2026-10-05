// msData.manual.json 의 손고정값이 **아직 유효한가**.
//   node tools/manualpin_check.js
//
// 이 파일은 「위키 표가 조정 뒤에도 안 바뀌어 원본이 낡았을 때」 손으로 박아 두는 값이다.
// 그래서 **원본이 따라잡으면 거꾸로 낡은 값이 된다** — 새 값을 옛 값으로 되돌려 놓는다.
//
// 실제로 그랬다(2026-10-05, 사용자 보고): 헤이즐 아우슬라 HP 를 2025/05/29 이력 기준
// 19000 으로 박아 뒀는데, 2026/09/24 조정으로 원본이 23000 이 됐다. 고정값이 이겨서
// 앱은 계속 19,100 을 보여 주고 있었다. 공지·위키·gbo2 가 전부 맞는데 앱만 틀린 모양이라
// 「어디가 안 맞는가」를 찾는 데 오래 걸렸다.
//
// 판정은 pin 이 들고 있는 was(박을 당시의 원본값)로 한다:
//   원본 == value  → 원본이 이미 같다. 고정이 쓸모없어졌다(지워도 된다).
//   원본 == was    → 아직 필요하다. 정상.
//   그 밖         → **원본이 움직였다.** 그 뒤에 조정이 또 있었다는 뜻이라 사람이 봐야 한다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra != null ? '  — ' + JSON.stringify(extra, null, 1) : ''));
  good ? pass++ : fail++;
};

const ms = rd('data', 'msData.json');
const byName = new Map(ms.map(m => [m.MS名, m]));
const manual = rd('data', 'msData.manual.json') || {};
const fix = manual.fix || {};

const same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);

const moved = [], useless = [], missing = [];
let cells = 0;
for (const [name, fields] of Object.entries(fix)) {
  const m = byName.get(name);
  if (!m) { missing.push(name); continue; }
  for (const [k, d] of Object.entries(fields)) {
    cells++;
    if (same(m[k], d.value)) useless.push({ 기체: name, 칸: k, 값: d.value });
    else if (!same(m[k], d.was)) moved.push({ 기체: name, 칸: k, 원본: m[k], 고정값: d.value, 박을당시: d.was, 날짜: d.date });
  }
}

ok('손고정 칸을 실제로 셌다 (검사가 헛돌지 않게)', cells > 0, { 칸: cells });
ok('고정값이 가리키는 기체가 모두 원본에 있다', missing.length === 0, missing);

/* 가장 중요한 줄. 원본이 was 도 value 도 아니면 **그 뒤에 조정이 또 있었다**는 뜻이다.
   고정값을 그대로 두면 새 값을 덮어 되돌린다. 사람이 보고 _제거 로 옮기거나 값을 고쳐야 한다. */
ok('원본이 움직인 고정값이 없다 (있으면 새 조정을 되돌리고 있다)', moved.length === 0, moved);

/* 원본이 이미 같아진 칸 — 당장 해롭지는 않지만 파일이 커지고 「왜 박아 뒀지」가 흐려진다.
   실패로 치지 않고 알리기만 한다. */
if (useless.length) {
  console.log('  (알림) 원본이 이미 같아져 지워도 되는 칸 ' + useless.length + '개');
  useless.slice(0, 5).forEach(u => console.log('     · ' + u.기체 + ' ' + u.칸 + ' = ' + u.값));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
