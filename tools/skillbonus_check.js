// 버프 스킬 → 스탯 가산분이 **한 자**인가 (core.skillStatBonusOf).
//   node tools/skillbonus_check.js
//
// ■ 왜 — 2026-11-17 코드 정리 점검: 앱(파츠 화면 00-base)과 대결(duel.js)에 같은 셈이 두 벌 있었고 이미 갈렸다.
//   상한 상승(limitUp) 버프 둘을 켜면 앱은 더하고 대결은 큰 것 하나만 썼다. 보정 % 도 앱은 % 를 더한 뒤 한 번
//   반올림, 대결은 스킬마다 반올림해 1 씩 어긋날 수 있었다. 앱의 규칙으로 하나로 모았다.
// ■ 자 — ① 손 계산과 대조 ② 두 화면 소스가 core 함수를 부르고 자기 셈을 들고 있지 않은가.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));
const { readUi } = require('./lib/uisrc.js');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const f = C.skillStatBonusOf;
ok('core 가 skillStatBonusOf 를 내놓는다', typeof f === 'function');
if (typeof f === 'function') {
  ok('켠 스킬이 없으면 null', f([], {}) === null && f([null], {}) === null);
  let r = f([{ limitUp: 10, shoot: 5 }, { limitUp: 5, melee: 3 }], {});
  ok('상한 상승은 스킬끼리 더한다 (10 + 5 = 15) — was 대결은 큰 것 하나(10)', r && r.limit && r.limit.shoot === 15 && r.limit.meleeCorrection === 15, r);
  let called = 0;
  r = f([{ shootPct: 10 }, { shootPct: 15 }], () => { called++; return { shoot: 33, meleeCorrection: 0 }; });
  ok('보정 % 는 더한 뒤 한 번 반올림 — 33 × 25% = 8.25 → 8 (스킬마다 반올림하면 3 + 5 = 8, 여기선 같다)', r && r.shoot === 8, r);
  r = f([{ shootPct: 10 }, { shootPct: 10 }], () => ({ shoot: 35 }));
  ok('…스킬마다 반올림과 갈리는 경우 — 35 × 20% = 7 (스킬마다면 4 + 4 = 8)', r && r.shoot === 7, r);
  ok('% 스킬이 없으면 bare 를 계산하지 않는다', (f([{ shoot: 5 }], () => { called = -99; return {}; }), called !== -99));
  r = f([{ armorBeam: 5, hpUp: 1000, hispeed: 3, turn: 2 }], {});
  ok('방어·HP·기동 버프도 옮긴다(hispeed → highSpeedMovement · turn → 지상/우주)', r && r.armorBeam === 5 && r.hp === 1000
    && r.highSpeedMovement === 3 && r.turnPerformanceGround === 2 && r.turnPerformanceSpace === 2, r);
  ok('상한만 오르고 스탯 가산이 없으면 null (앱의 예전 규칙 그대로)', f([{ limitUp: 10 }], {}) === null);
}

const ui = readUi(ROOT);
const duel = fs.readFileSync(path.join(ROOT, 'src', 'duel.js'), 'utf8');
const body = (src, name) => { const i = src.indexOf('function ' + name + '('); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }', i)); };
ok('앱 skillStatBonus 는 core.skillStatBonusOf 를 부른다', /C\.skillStatBonusOf\(/.test(body(ui, 'skillStatBonus')));
ok('대결 skillStatBonus 도 core.skillStatBonusOf 를 부른다', /C\.skillStatBonusOf\(/.test(body(duel, 'skillStatBonus')));
ok('대결에 자기 셈(limitUp = Math.max …)이 남아 있지 않다', !/limitUp\s*=\s*Math\.max/.test(duel));

console.log('\n' + (fail ? 'FAIL' : 'OK') + '  스킬 가산 ' + pass + '/' + (pass + fail));
process.exit(fail ? 1 : 0);
