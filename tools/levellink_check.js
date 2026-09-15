// 「レベルリンクシステム」 세 파츠의 값을 **위키 주석과 직접 대조**한다.
//
//   node tools/levellink_check.js
//
// 이 파츠는 「機体と主兵装のLVが一致すると効果量が上昇し」 — 기체 LV 와 주무장 LV 가
// 같을 때만 보너스가 붙는다. 어긋나면 파츠 기본값뿐이다.
//
// 코드를 읽어서는 맞는지 알 수 없는 이유가 둘 있다:
//   · 격투·사격은 기본값(+5)이 파츠 데이터에 있는데 **장갑만 없다**(+2 가 표에 접혀 있었다).
//     일치할 때만 보면 합이 같아 드러나지 않는다 — 어긋났을 때만 갈라진다.
//   · 기대값의 출처가 data/i18n/parts.json 의 위키 주석이라, 사람이 눈으로 맞춰 보지 않으면
//     표를 고칠 때 주석과 조용히 어긋난다.
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const C = require(path.join(R, 'src/core.js'));

const parts = JSON.parse(fs.readFileSync(path.join(R, 'data/parts.json'), 'utf8'));
const ms = JSON.parse(fs.readFileSync(path.join(R, 'data/msData.json'), 'utf8'));

const partsByCat = parts;
const allParts = Object.values(parts).flat();
const byName = new Map(allParts.map(p => [p.name, p]));

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  if (got === want) { pass++; console.log('  PASS ' + label + ' = ' + got); }
  else { fail++; console.log('  FAIL ' + label + ' = ' + got + ' (기대 ' + want + ')'); }
};

/* 위키 주석(data/i18n/parts.json)이 말하는 값.
     격투·사격 — 기본 +5, 일치하면 LV1 은 +3 더(합 8), LV2 부터 상승량이 2씩 는다.
     장갑     — 기본 +2, 일치하면 LV1 은 +2 더(합 4), LV2 부터 상승량이 1씩 는다. */
const WANT = {
  '格闘': { base: 5, linked: [8, 10, 12, 14, 16] },
  '射撃': { base: 5, linked: [8, 10, 12, 14, 16] },
  '装甲': { base: 2, linked: [4, 5, 6, 7, 8] }
};
const STAT_OF = { '格闘': 'meleeCorrection', '射撃': 'shoot', '装甲': 'armorBeam' };

/** 그 LV 의 기체를 하나 찾는다. 상한에 걸리지 않게 해당 스탯이 낮은 기체를 고른다. */
function msAtLv(lv, statKey) {
  const cands = ms.filter(m => new RegExp('_LV' + lv + '$').test(m.MS名));
  let best = null, bestV = Infinity;
  for (const m of cands) {
    const bare = C.calcStats(m, [], 0, C.EXPANSION_NONE, partsByCat, [], 1).total[statKey];
    if (bare < bestV) { bestV = bare; best = m; }
  }
  return best;
}

console.log('레벨링크 시스템 — 위키 주석과 대조\n');
for (const kind of ['格闘', '射撃', '装甲']) {
  const part = byName.get('レベルリンクシステム[' + kind + ']_LV1');
  if (!part) { console.log('  FAIL 파츠 없음: ' + kind); fail++; continue; }
  const statKey = STAT_OF[kind];
  console.log('[' + kind + ']');
  for (let lv = 1; lv <= 5; lv++) {
    const m = msAtLv(lv, statKey);
    if (!m) { console.log('  건너뜀 LV' + lv + ' — 기체 없음'); continue; }
    const bare = C.calcStats(m, [], 0, C.EXPANSION_NONE, partsByCat, [], 1).total[statKey];
    const at = wlv => C.calcStats(m, [part], 0, C.EXPANSION_NONE, partsByCat, [], 1, null, null, wlv)
      .total[statKey] - bare;
    // 일치 — 무장 LV 를 안 넘긴 예전 호출도 같은 값이어야 한다(원본 대조가 여기 묶여 있다)
    ok('LV' + lv + ' 일치',       at(lv), WANT[kind].linked[lv - 1]);
    ok('LV' + lv + ' 일치(무지정)', at(undefined), WANT[kind].linked[lv - 1]);
    // 어긋남 — 어느 쪽으로 어긋나든 기본값뿐
    if (lv > 1) ok('LV' + lv + ' 무장 LV1', at(1), WANT[kind].base);
    if (lv > 2) ok('LV' + lv + ' 무장 LV' + (lv - 1), at(lv - 1), WANT[kind].base);
  }
  console.log('');
}

console.log(pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
