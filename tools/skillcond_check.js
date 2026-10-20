// 방어 스킬의 **발동 조건**을 제대로 읽는가.
//   node tools/skillcond_check.js
//
// ■ 왜 — 조건부 스킬이 '상시' 로 새면 **늘 걸리는 값**이 된다. 라벨만 잘못되는 게 아니라
//   내구 지표와 격파 발수가 통째로 달라진다. 2026-10-13 에 사용자가 짚었다:
//   「왜 보조 동력이 상시 스킬로 되어있는가 / 체력 조건부 스킬이니 고칠것」.
//   조건 판정이 「HP…以下」만 보고 있어서, 「機体HPが 1000 以上の時に…」로 적힌 것들이
//   전부 새어 나갔다 — 전수 10종. 그 중 나노라미네이트 아머의 피해 −30% 는 늘 걸려 있었다.
//
// ■ 자 — 앱의 판정을 다시 부르지 않는다. **원문(ms_skills.json)** 을 직접 읽어
//   「HP 문턱을 말하는 스킬」을 스스로 골라 내고, 앱이 그것을 상시로 부르는지 본다.
//   그리고 라벨만 보지 않는다 — 조건부가 된 뒤 **피해가 실제로 달라지는지**까지 잰다
//   (라벨만 보면 라벨은 고쳐졌고 계산은 그대로인 상태를 통과시킨다).
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let findChrome;
try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const URL = 'file:///' + FILE.split(path.sep).join('/').split(' ').join('%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* ── 원문에서 **스스로** 고른다 ───────────────────────────────────────────
   「機体HPが N%以下」「HPが N 以上の時」처럼 HP 문턱을 말하는 스킬. 단순 HP 언급
   (「機体HPへのダメージ」·「HP回復」)은 문턱이 아니므로 以下/以上 을 요구한다.
   앞선 조건(부위 피격·정지중·공중…)이 이기는 것은 그쪽이 더 좁은 조건이라 괜찮다 —
   여기서 보는 것은 **'상시' 로 떨어지지 않는가**뿐이다. */
const MSK = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ms_skills.json'), 'utf8'));
const HP_GATE = /機体HP[^。]{0,14}(以下|以上)|HPが[^。]{0,14}(以下|以上)/;
const wanted = new Map();   // 기체 base → Set(스킬명)
for (const [ms, forms] of Object.entries(MSK)) {
  for (const f of forms || []) for (const s of (f.skills || [])) {
    const blob = ((s.eff || '') + ' / ' + (s.desc || '')).replace(/\s+/g, ' ');
    if (!HP_GATE.test(blob)) continue;
    if (!wanted.has(ms)) wanted.set(ms, new Set());
    wanted.get(ms).add(s.name);
  }
}

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1400, height: 900 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(3200);

  const want = [...wanted.entries()].map(([ms, set]) => [ms, [...set]]);
  const got = await pg.evaluate(list => {
    const A = window.GBO2UiTest, all = A.msData();
    const out = [];
    for (const [base, names] of list) {
      const ms = all.filter(m => m.MS名.replace(/_LV\d+$/, '') === base).pop();
      if (!ms) continue;                        // 자료에만 있고 목록엔 없는 기체는 셀 수 없다
      const lv = A.msLevel(ms);
      const sk = A.staggerSkillsOf(ms, lv, 'normal');
      for (const n of names) {
        const hit = sk.find(x => x.name === n);
        if (hit) out.push({ base, name: n, cond: hit.cond });
      }
    }
    return out;
  }, want);

  const leaked = got.filter(x => x.cond === '상시');
  ok('원문이 HP 문턱을 말하는 스킬 ' + got.length + '개 가운데 상시로 새는 것이 없다'
    + '   (was 10종이 샜다)', leaked.length === 0, leaked.slice(0, 6));
  ok('그렇게 고른 스킬이 실제로 있다 (고르기가 비어 통과하지 않게)', got.length >= 10, got.length);

  /* ── 사용자가 짚은 자리를 글자로 못 박는다 ───────────────────────────── */
  const pin = (base, name, cond) => {
    const hit = got.find(x => x.base === base && x.name === name);
    ok(base + ' 의 ' + name + ' = ' + cond + '   (was 상시)', !!hit && hit.cond === cond,
      hit || '(목록에 없다)');
  };
  pin('グスタフ・カール', '補助動力', 'HP조건');
  pin('ガンダム・バルバトスルプス', 'ナノラミネートアーマー', 'HP조건');
  pin('クロスボーン・ガンダムX1FC', 'X1用フルクロス', 'HP조건');

  /* ── 라벨만이 아니라 **수가 달라지는가** ──────────────────────────────
     상시였을 때 나노라미네이트의 사격 피해 −30% 는 체크와 무관하게 늘 걸렸다.
     대결 화면에서 그 기체를 맞는 쪽에 두고, 방어 스킬을 **아무것도 안 켠** 채로
     사격 피해를 잰다 — 상시로 새면 여기서 이미 깎여 있다. */
  const num = await pg.evaluate(() => {
    const G = window.GBO2_DATA, S = window.GBO2Duel.state;
    const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
    const foe = by('ガンダム・バルバトスルプス');
    const me = by('サザビー');
    if (!foe || !me) return null;
    S.L.ms = me; S.R.ms = foe; S.L.stage = 6; S.R.stage = 6;
    S.L.parts = []; S.R.parts = []; S.L.wKey = null;
    S.L.buffs.clear(); S.R.buffs.clear(); S.R.defs.clear();
    S.L.exp = window.GBO2Core.EXPANSION_NONE;
    /* **먼저 열면 안 된다.** open 은 seed 로 왼쪽을 앱 구성으로 덮는다 — 여기서 세운
       공격 측이 통째로 바뀐다. 열고 난 뒤 세우고 use({}) 로 다시 그린다. */
    window.GBO2Duel.open();
    S.L.ms = me; S.R.ms = foe; S.L.parts = []; S.R.parts = []; S.L.wKey = null;
    S.R.defs.clear();
    window.GBO2Duel.use({});
    // 사격 무장 하나를 고른다
    const els = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-w')];
    let r = null;
    for (const e of els) {
      e.click();
      const a = window.GBO2Duel.attack(S.L, S.R);
      if (a && !a.wp.melee) { r = a; break; }
    }
    if (!r) return null;
    const chips = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip.def')]
      .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim());
    window.GBO2Duel.close();
    return { 무장: r.wp.w.name, 경감배수: r.factor, 상대경감: r.foeCut, 방어칩: chips };
  });
  ok('맞는 쪽 방어 스킬을 아무것도 안 켜면 경감이 없다 (×1)'
    + '   (was 나노라미네이트 −30% 가 늘 걸렸다)',
    !!num && num.경감배수 === 1, num);
  ok('그래도 그 스킬이 **고를 수 있게** 칩으로는 떠 있다 (조건부로 옮기며 사라지지 않게)',
    !!num && num.방어칩.some(t => /라미네이트|ナノラミネート/.test(t)), num && num.방어칩);

  /* ══ 직접 발동 · HP 미만 · 부위 피격(場合) · 아군 지원 포격 ══════════════════
     ■ 왜 — 2026-10-15 사용자: 「레지스트 무브는 사용자가 직접 발동하는 스킬… 보조동력과 같은 현상,
       전체적으로 확인」. 전수해 보니 값 있는 스킬 14종이 '상시' 였고 그중 9종이 조건부였다:
       レジストムーブ(動作中) · ビーム撹乱(集束中) · 耐ビーム・コーティング(HP 50%未満) ·
       胸部Iフィールド/多目的大型バインダー(「胸部に…攻撃を受けた際」) · 특수방어기구(「…部へ…場合」) ·
       シールド内Iフィールド · マーカー(아군 지원 포격에만).
     ■ 자 — 위와 같이 **원문에서 스스로** 고른다. 조건 낱말이 있는데 앱이 '상시' 라 부르면 운다. */
  {
    const GATED = [
      [/動作中|集束中|ボタンを/, '직접 발동'],
      [/HP[^。]{0,12}(未満|を下回)/, 'HP 미만'],
      [/(部|シールド|バインダー|ファンネル)(?:の[^、。/]{0,8})?[へに][^、。/]{0,14}攻撃を受け(?:た際|た場合)/, '부위 피격'],
    ];
    const VAL = /(ダメージ|被ダメージ)[^。]{0,30}\d+\s*[%％]\s*軽減|よろけ値を\s*\d+|蓄積よろけまでの値が\s*\d+/;
    const want2 = new Map(), support = new Map();
    for (const [ms, forms] of Object.entries(MSK)) {
      for (const f of forms || []) for (const s of (f.skills || [])) {
        const blob = ((s.eff || '') + ' / ' + (s.desc || '')).replace(/\s+/g, ' ');
        if (!VAL.test(blob)) continue;
        if (/支援砲撃を受けた/.test(blob)) { if (!support.has(ms)) support.set(ms, new Set()); support.get(ms).add(s.name); continue; }
        const g = GATED.find(([re]) => re.test(blob));
        if (!g) continue;
        if (!want2.has(ms)) want2.set(ms, new Map());
        want2.get(ms).set(s.name, g[1]);
      }
    }
    const res2 = await pg.evaluate((list, sup) => {
      const A = window.GBO2UiTest, all = A.msData();
      const pick = base => all.filter(m => m.MS名.replace(/_LV\d+$/, '') === base).pop();
      const out = [], sOut = [];
      for (const [base, names] of list) {
        const ms = pick(base); if (!ms) continue;
        const sk = A.staggerSkillsOf(ms, A.msLevel(ms), 'normal');
        for (const [n, why] of names) { const hit = sk.find(x => x.name === n); if (hit) out.push({ base, name: n, why, cond: hit.cond }); }
      }
      for (const [base, names] of sup) {
        const ms = pick(base); if (!ms) continue;
        const sk = A.staggerSkillsOf(ms, A.msLevel(ms), 'normal');
        for (const n of names) sOut.push({ base, name: n, listed: !!sk.find(x => x.name === n) });
      }
      return { out, sOut };
    }, [...want2.entries()].map(([k, m]) => [k, [...m.entries()]]), [...support.entries()].map(([k, s]) => [k, [...s]]));
    const leak2 = res2.out.filter(x => x.cond === '상시');
    ok('직접 발동 · HP 미만 · 부위 피격 스킬 ' + res2.out.length + '개 가운데 상시로 새는 것이 없다   (was 9종이 샜다)',
      leak2.length === 0 && res2.out.length >= 20, leak2.slice(0, 6));
    const listed = res2.sOut.filter(x => x.listed);
    ok('아군 지원 포격 전용 경감(マーカー)은 방어 스킬 목록에 없다 (' + res2.sOut.length + '기)   (was 상시 −45%)',
      res2.sOut.length > 0 && listed.length === 0, listed.slice(0, 4));
    const rm = res2.out.find(x => x.base === 'ゲルググJ' && x.name === 'レジストムーブ');
    ok('ゲルググJ 의 レジストムーブ = 발동중   (was 상시 — 사용자가 짚음)', !!rm && rm.cond === '발동중', rm || '(목록에 없다)');

    /* 2026-10-20 — 「끝난 뒤 · 생긴 뒤 일정 시간」 · 「무장을 든 동안」 이 조건 낱말 목록에 없어 상시로 샜다.
       カウンターブースト 는 사용자가 짚었고 나머지 둘은 같은 날 전수 검수에서 나왔다. */
    const after = await pg.evaluate(() => {
      const A = window.GBO2UiTest, G = window.GBO2_DATA;
      const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
      return [['ガンダム試作1号機', 'カウンターブースト'], ['ゴールドスモー', 'MFEガンディウムFGI複合材'],
        ['ガンダム・端白星', '白兵戦プログラム']].map(([b, n]) => {
        const ms = by(b); if (!ms) return { b, n, cond: '(기체 없음)' };
        const sk = A.staggerSkillsOf(ms, A.msLevel(ms), 'normal').find(x => x.name === n);
        return { b, n, cond: sk ? sk.cond : '(목록에 없음)' };
      });
    });
    const WANT = { 'カウンターブースト': '발동후', 'MFEガンディウムFGI複合材': '발동후', '白兵戦プログラム': '장비중' };
    for (const x of after)
      ok(x.b + ' 의 ' + x.n + ' = ' + WANT[x.n] + '   (was 상시)', x.cond === WANT[x.n], x);

    /* 수가 달라지는가 — 겔구그J 를 맞는 쪽에 두고 아무것도 안 켠다. 예전엔 −50% 가 늘 걸렸다 */
    const rnum = await pg.evaluate(() => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state;
      const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
      const foe = by('ゲルググJ'), me = by('サザビー');
      if (!foe || !me) return null;
      window.GBO2Duel.open();
      S.L.ms = me; S.R.ms = foe; S.L.parts = []; S.R.parts = []; S.L.wKey = null;
      S.L.buffs.clear(); S.R.defs.clear();
      window.GBO2Duel.use({});
      const els = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-w')];
      let r = null;
      for (const e of els) { e.click(); const a = window.GBO2Duel.attack(S.L, S.R); if (a && !a.wp.melee) { r = a; break; } }
      const chips = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip.def')].map(e => (e.textContent || '').replace(/\s+/g, ' ').trim());
      window.GBO2Duel.close();
      return r && { 경감배수: r.factor, 방어칩: chips };
    });
    ok('겔구그J 를 맞힐 때 아무것도 안 켜면 경감이 없다 (×1)   (was 레지스트 무브 −50% 가 늘 걸렸다)',
      !!rnum && rnum.경감배수 === 1, rnum);
    ok('레지스트 무브는 켤 수 있는 칩으로 남아 있다 (상시 표시가 아니다)',
      !!rnum && rnum.방어칩.some(t => /레지스트/.test(t) && !/상시/.test(t)), rnum && rnum.방어칩);
  }

  /* ══ 공중 격투 제어 LV2 의 「威力 +30%」 ═══════════════════════════════
     ■ 왜 — 올리는 축이 威力 인데 skills.json 에 위력 축이 없어, 그 스킬의 수치가
       전부 0 으로 담겨 **목록에서 통째로 버려졌다**(2026-10-13 사용자 지적:
       「공중 격투 2렙의 경우 공중에서 공격시 피해량 상승이 붙어있음」).
     ■ 자 — 원문(ms_skills.json)을 직접 읽어 「威力が N% 上昇」을 말하는 기체를
       스스로 세고, 앱의 판정(airMeleeOf)이 같은 수를 말하는지 본다.
       그리고 **피해가 실제로 달라지는지**까지 잰다 — 줄만 보면 줄은 있고 수는
       안 바뀐 상태를 통과시킨다. 기대값은 앱 식을 베끼지 않고 damage.js 로 따로 센다. */
  {
    const AIR = /威力が\s*(\d+)\s*[%％]\s*上昇/;
    const DOWN = /下格闘攻撃を行う/;
    const mine = new Map();          // base → {pct, dir}
    /* **통상 모드만** 본다. 앱은 form='normal' 일 때 변신 모드의 스킬 목록을 쓰지 않는다
       (각 모드는 그 상태의 완결된 목록이라 섞지 않는다 — skillModesFor).
       그래서 변신 중에만 이 스킬을 가진 기체(フェネクス【NT】)는 통상에서 없는 것이 맞다.
       모드는 자료에 적힌 값(f.mode)으로 가린다 — 앱의 고르기 함수를 베끼지 않는다. */
    for (const [ms, forms] of Object.entries(MSK)) {
      for (const f of forms || []) {
        if (f.mode && f.mode !== '通常時') continue;
        for (const k of (f.skills || [])) {
        if (k.name !== '空中格闘制御') continue;
        const blob = ((k.eff || '') + ' / ' + (k.desc || '')).replace(/\s+/g, ' ');
        const m = blob.match(AIR);
        if (!m) continue;
        /* 공중 격투는 입력 방향과 상관없이 늘 하격이다(사용자 확인 2026-10-16) — 원문이 「特定の格闘攻撃」
           라고만 적은 7기도 하격이다. 원문 꼴(down)은 따로 들고 가 두 갈래를 다 재는 데 쓴다. */
        mine.set(ms, { pct: Number(m[1]), dir: '下格', down: DOWN.test(blob) });
        }
      }
    }
    ok('원문에 「威力 +N% 上昇」을 말하는 기체가 있다 (고르기가 비어 통과하지 않게)',
      mine.size >= 50, mine.size);

    const asked = [...mine.entries()].map(([ms, v]) => [ms, v.pct, v.dir, v.down]);
    const res = await pg.evaluate(list => {
      const A = window.GBO2UiTest, all = A.msData();
      const out = [];
      for (const [base, pct, dir, down] of list) {
        // 그 스킬 구간에 드는 **가장 높은 LV** 으로 본다 (LV1 에는 위력 상승이 없다)
        const ms = all.filter(m => m.MS名.replace(/_LV\d+$/, '') === base).pop();
        if (!ms) continue;
        const a = A.airMeleeOf(ms, A.msLevel(ms), 'normal');
        out.push({ base, 원문: { pct, dir }, down, 앱: a });
      }
      return out;
    }, asked);
    const wrong = res.filter(x => !x.앱 || x.앱.pct !== x.원문.pct || x.앱.dir !== x.원문.dir);
    ok('앱의 판정이 원문과 같다 — 올리는 %, 그리고 방향을 아는가 (' + res.length + '기)'
      + '   (was 스킬이 통째로 없었다)', wrong.length === 0, wrong.slice(0, 5));

    /* 원문 두 갈래(「下格闘」 · 「特定の格闘攻撃」)가 **둘 다** 하격으로 잡혀야 한다.
       예전엔 「特定」 7기를 방향 모름(null)으로 두어 대결에 단추가 안 나왔다 — +30% 가 조용히 0 이었다. */
    const downN = res.filter(x => x.down && x.앱 && x.앱.dir === '下格').length;
    const specN = res.filter(x => !x.down && x.앱 && x.앱.dir === '下格').length;
    ok('원문이 「下格闘」 인 쪽(' + downN + ')과 「特定の格闘攻撃」 인 쪽(' + specN + ') 모두 하격으로 센다'
      + '   (was 「特定」 7기는 방향 모름이라 빠졌다)', downN > 0 && specN >= 7, { downN, specN });

    /* 「거베라 테트라」 — 사용자가 짚은 꼴을 글자로 못 박고, 피해를 따로 계산해 맞댄다. */
    const air = await pg.evaluate(() => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state;
      const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
      const me = by('ガーベラ・テトラ'), foe = by('ザクⅡ');
      if (!me || !foe) return null;
      window.GBO2Duel.open();            // open 이 seed 로 왼쪽을 덮으므로 먼저 연다
      S.L.ms = me; S.R.ms = foe; S.L.stage = 6; S.R.stage = 6;
      S.L.parts = []; S.R.parts = []; S.L.wKey = null; S.L.air = false;
      S.L.buffs.clear(); S.R.buffs.clear(); S.R.defs.clear();
      S.L.exp = window.GBO2Core.EXPANSION_NONE;
      window.GBO2Duel.use({});
      // 격투 무장을 골라 하격에 세운다
      const els = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-w')];
      let r = null;
      for (const e of els) { e.click(); const a = window.GBO2Duel.attack(S.L, S.R); if (a && a.wp.melee) { r = a; break; } }
      if (!r) return null;
      const dirs = r.wp.variants[0].direction;
      /* **N격에 세워 두고** 공중을 켠다. 하격에 세워 두고 재면 「방향을 고정한다」와
         「고른 방향에 그냥 +30% 를 얹는다」가 같은 수를 내서 구별이 안 된다
         (심어 보고 알았다 — 그 회귀가 통과했다). 땅 하격 값은 따로 재 둔다. */
      const iDown = dirs.findIndex(d => d.label === '下格');
      const iN = dirs.findIndex(d => d.label === 'N格');
      S.L.dir = iDown; window.GBO2Duel.use({});
      const g = window.GBO2Duel.attack(S.L, S.R);        // 땅 하격
      S.L.dir = iN; window.GBO2Duel.use({});
      const gN = window.GBO2Duel.attack(S.L, S.R);       // 땅 N격 (켜기 전 자리)
      const ab = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-cond .d-btn')]
        .find(b => /공중 격투/.test(b.textContent));
      const 단추 = !!ab;
      if (ab) ab.click();
      const a2 = window.GBO2Duel.attack(S.L, S.R);
      const 잠김 = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-cond .seg-btn')]
        .filter(b => b.disabled).length;
      window.GBO2Duel.close();
      return { 단추, 잠김, 땅: { 위력: g.power, 한발: g.per, ccd: dirs[iDown].hits },
        땅N: { 한발: gN.per, ccd: dirs[iN].hits },
        공중: { 위력: a2.power, 한발: a2.per, pct: a2.air && a2.air.pct, 방향: a2.dirTxt },
        보정: a2.corr, 상성: a2.att };
    });
    ok('대결에 🛩 공중 격투 단추가 나온다 (대응 무장일 때만)', !!air && air.단추 === true, air);
    ok('켜면 방향 세그먼트가 잠긴다 (원문이 가리키는 방향 하나로 고정되므로)',
      !!air && air.잠김 >= 2, air && air.잠김);
    if (air) {
      const Dmg = require(path.join(ROOT, 'src', 'damage.js'));
      ok('위력이 floor(위력 × 1.3) 로 오른다 (' + air.땅.위력 + ' → ' + air.공중.위력 + ')',
        air.공중.위력 === Math.floor(air.땅.위력 * 1.3), air);
      // 기대 피해를 damage.js 로 **따로** 센다 (앱 식을 베끼지 않는다)
      const expect = Dmg.meleeDamage(air.공중.위력, air.보정, { attr: air.상성, ccd: air.땅.ccd });
      ok('공중 하격 피해가 따로 센 값과 같다 (' + air.공중.한발 + ')',
        air.공중.한발 === expect, { 앱: air.공중.한발, 따로센것: expect, air });
      ok('땅 하격보다 크다 (수가 실제로 움직인다)', air.공중.한발 > air.땅.한발,
        { 땅: air.땅.한발, 공중: air.공중.한발 });
      ok('칩에 「공중」이 붙는다 (땅 하격과 구분된다)', /공중/.test(air.공중.방향 || ''), air.공중.방향);
      /* N격에 세워 두고 켰다 — 공중 격투는 원문이 가리키는 下格 로 **고정**되어야 한다.
         고정하지 않으면 N격 배율에 위력만 오른 값이 나온다. */
      const expN = Dmg.meleeDamage(air.공중.위력, air.보정, { attr: air.상성, ccd: air.땅N.ccd });
      ok('N격에 세워 두고 켜도 하격으로 고정된다 (고른 방향에 얹지 않는다)',
        air.공중.한발 !== expN && /하격/.test(air.공중.방향 || ''),
        { 공중: air.공중.한발, 만약N격에얹었다면: expN, 방향: air.공중.방향 });
    }
  }

  /* 공중 격투도 **LV 을 보는가.** 거베라 테트라는 스킬이 LV1 부터 붙어(msLv=LV1～)
     LV 을 1 로 박아도 똑같이 나온다 — 그것만 재면 LV 오용을 못 잡는다(심어 보고 알았다).
     ハンブラビ 는 공중 격투 제어 LV2 가 msLv=LV3～ 라, 최고 LV 에서는 단추가 나오고
     LV1 에서는 안 나와야 한다. 양쪽을 같이 잰다. */
  {
    const lvdep = await pg.evaluate(() => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state;
      const of = lv => G.msData.find(m => m.MS名 === 'ハンブラビ_LV' + lv);
      const foe = G.msData.find(m => m.MS名 === 'ザクⅡ_LV1');
      const out = {};
      window.GBO2Duel.open();
      for (const lv of [1, 4]) {
        const me = of(lv);
        if (!me) { out['LV' + lv] = null; continue; }
        S.L.ms = me; S.R.ms = foe; S.L.stage = 6; S.R.stage = 6;
        S.L.parts = []; S.R.parts = []; S.L.wKey = null; S.L.air = false;
        S.L.buffs.clear();
        window.GBO2Duel.use({});
        // 대응 무장(ビーム・サーベル)을 고른다
        const els = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-w')];
        const e = els.find(x => /ビーム・サーベル|빔 사벨|빔 사브르/.test(x.textContent || ''))
          || els.find(x => x.querySelector('.ty') && /격투/.test(x.textContent || ''));
        if (e) { e.click(); window.GBO2Duel.use({}); }
        const ab = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-cond .d-btn')]
          .find(b => /공중 격투/.test(b.textContent));
        out['LV' + lv] = { 무장: e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 30) : null, 단추: !!ab };
      }
      /* 備考가 대응한다고 **안 밝힌** 격투 무장에는 단추가 없어야 한다.
         이 검사가 없으면 「격투 무장 전부에 +30%」로 바꿔도 아무도 안 운다(심어 보고 알았다). */
      const me4 = of(4);
      if (me4) {
        S.L.ms = me4; S.L.wKey = null; S.L.air = false;
        window.GBO2Duel.use({});
        const rows = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-w')];
        const 비대응 = [];
        for (const e of rows) {
          e.click(); window.GBO2Duel.use({});
          const a = window.GBO2Duel.attack(S.L, S.R);
          if (!a || !a.wp.melee) continue;
          const note = String((a.wp.w.info || {})['備考'] || '');
          if (/スキル「空中格闘制御」対応/.test(note)) continue;
          const ab = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-cond .d-btn')]
            .find(b => /공중 격투/.test(b.textContent));
          비대응.push({ 무장: a.wp.w.name, 단추: !!ab });
        }
        out.비대응 = 비대응;
      }
      window.GBO2Duel.close();
      return out;
    });
    ok('備考가 대응이라 안 밝힌 격투 무장에는 단추가 없다 (' + ((lvdep.비대응 || []).length) + '개 확인)',
      (lvdep.비대응 || []).length >= 2 && lvdep.비대응.every(x => x.단추 === false), lvdep.비대응);
    ok('ハンブラビ LV4 에는 🛩 단추가 나온다 (공중 격투 제어 LV2 는 msLv LV3～)',
      !!lvdep.LV4 && lvdep.LV4.단추 === true, lvdep);
    ok('ハンブラビ LV1 에는 안 나온다 (LV 을 1 로 박으면 여기가 운다)',
      !!lvdep.LV1 && lvdep.LV1.단추 === false, lvdep);
  }

  /* 공중 격투의 방향 · 대응 — 2026-10-16 사용자:
       「공중 격투는 입력 방향과 상관없이 하격」 + 「일부 무장은 늘 하격이 아님」(스크류 웹은 N격만, 위키 해설)
       「대응 표기가 없는 무장만 반영하지 말 것」(클러스터 건담 단일 사벨 — 위키 「空中格闘制御には非対応」)
     판정은 앱의 airMeleeOf · airDirOf 한 곳 — 대결 단추가 그 답을 그대로 보이는지 잰다. */
  {
    const G = require('./lib/duelgate.js');
    const pg2 = await br.newPage();
    await pg2.setViewport({ width: 1500, height: 1300 });
    await pg2.goto(URL, { waitUntil: 'load', timeout: 180000 });
    await new Promise(r => setTimeout(r, 2400));
    const m = o => G.measure(pg2, { foe: 'ジム_LV1', dir: '下格', ...o });
    const web = await m({ me: 'クロスボーン・ガンダムX1改_LV1', weaponExact: 'X1改用スクリュー・ウェッブ', air: true });
    const zan = await m({ me: 'クロスボーン・ガンダムX1改_LV1', weaponExact: 'X1改用ビーム・ザンバー', air: true });
    ok('X1改 스크류 웹 — 공중 격투는 N격 (하격을 골라 둬도)', /공중 N격/.test(web.방향 || '') && web.공중 === 30, { 방향: web.방향, 공중: web.공중 });
    ok('X1改 빔 잔바 — 공중 격투는 하격 (예외는 무장 단위다)', /공중 하격/.test(zan.방향 || '') && zan.공중 === 30, { 방향: zan.방향, 공중: zan.공중 });
    const god = await m({ me: 'ゴッドガンダム_LV2', weaponExact: 'ゴッドスラッシュ', air: true });
    ok('갓 건담 갓 슬래시 — 원문이 「特定の格闘攻撃」 이어도 공중 하격 +30% (was 단추가 안 나왔다)',
      /공중 하격/.test(god.방향 || '') && god.공중 === 30, { 방향: god.방향, 공중: god.공중 });
    const cOne = await m({ me: 'クラスターガンダム_LV1', weaponExact: 'Cガンダム用ビーム・サーベル', air: true });
    const cTwo = await m({ me: 'クラスターガンダム_LV1', weaponExact: 'Cガンダム用ビーム・サーベルx2', air: true });
    ok('클러스터 건담 — 대응 표기 없는 단일 사벨은 공중 격투 없음 · x2 는 있음',
      !cOne.공중 && cTwo.공중 === 30, { 단일: cOne.공중, x2: cTwo.공중 });
    /* 델타 플러스 — 원문에 대응 표기가 빠졌지만 대응이다(사용자 확인 2026-10-16, AIR_TAG_EXTRA) */
    const dp = await m({ me: 'デルタプラス_LV3', weaponExact: 'デルタプラス用ビーム・サーベル', air: true });
    ok('델타 플러스 사벨 — 원문 표기는 없어도 공중 하격 +30% (사용자 확인)', /공중 하격/.test(dp.방향 || '') && dp.공중 === 30, { 방향: dp.방향, 공중: dp.공중, 오류: dp.오류 });

    /* 「実弾属性射撃被ダメージ－50%」 는 **실탄 사격 한정** 하나다 — 사격 전체로도 잡혀 빔에 걸리면 안 된다
       (밴디트 우지 아머, 사용자 지적 2026-10-16: 「사격 −50% / 실탄 −50% 로 나뉘어 있다」). */
    const bm = o => G.measure(pg2, { me: 'F91_LV1', foe: 'バンデット_LV1', ...o });
    const sOn = await bm({ weapon: '頭部バルカン', defs: ['ウージィ・アーマー'] });
    const bOff = await bm({ weapon: 'F91用ビーム・ライフル' });
    const bOn = await bm({ weapon: 'F91用ビーム・ライフル', defs: ['ウージィ・アーマー'] });
    ok('밴디트 우지 아머 — 실탄 사격에 −50% 한 번', JSON.stringify(sOn.경감이름) === '["우지 아머 −50%"]', sOn.경감이름);
    ok('밴디트 우지 아머 — 빔 사격에는 안 걸린다 (was 사격 전체 −50% 로도 잡혔다)', bOn.한발 === bOff.한발 && !(bOn.경감이름 || []).length, { off: bOff.한발, on: bOn.한발, 경감: bOn.경감이름 });
    await pg2.close();
  }

  /* ══ 방어 스킬을 **그 기체의 LV** 으로 읽는가 ═══════════════════════════
     ■ 왜 — 대결에 방어 스킬을 이어 줄 때 LV 을 넘기는 자리를 `msLevel(side.ms.MS名)`
       로 썼다. ui 의 msLevel 은 **기체 객체**를 받는데(core 쪽은 이름을 받는다) 이름을
       넘기면 m.MS名 이 undefined 가 되어 **조용히 1** 을 돌려준다. 그래서 대결의 방어
       스킬·공중 격투 판정이 전 기체 LV1 로 계산되고 있었다. 게이트가 잡았다.
     ■ 자 — LV 에 따라 경감이 달라지는 자리로 잰다. ゴッグ 의 액티브 가드는
       LV1～2 에서 70%, LV3～ 에서 80% 다(원문). 최고 LV 기체를 세우고 80 이 나오는지 본다.
       값은 코드에 박지 않고 **원문에서 읽어** 기대값을 만든다 — 박아 두면 조정 때 썩는다. */
  {
    const base = 'ゴッグ';
    const cands = [];
    for (const f of MSK[base] || []) {
      if (f.mode && f.mode !== '通常時') continue;
      for (const k of (f.skills || [])) if (k.name === 'アクティブガード') cands.push(k);
    }
    // 원문에서 「LV 하한 → 경감%」 를 뽑는다
    const rows = cands.map(k => {
      const blob = ((k.eff || '') + ' / ' + (k.desc || '')).replace(/\s+/g, ' ');
      const p = blob.match(/被ダメージ[をが]?\s*[-－−]?\s*(\d+)\s*[%％]/);
      const lo = String(k.msLv || '').match(/LV(\d+)/);
      return p && lo ? { from: Number(lo[1]), pct: Number(p[1]) } : null;
    }).filter(Boolean).sort((a, b) => a.from - b.from);
    ok('원문에서 ゴッグ 액티브 가드의 LV 별 경감을 두 단 이상 읽었다 (자가 비어 통과하지 않게)',
      rows.length >= 2 && new Set(rows.map(r => r.pct)).size >= 2, rows);

    const got = await pg.evaluate(b => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state, A = window.GBO2UiTest;
      const all = G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === b);
      const top = all[all.length - 1];
      if (!top) return null;
      const me = G.msData.find(m => m.MS名 === 'ザクⅡ_LV1') || G.msData[0];
      window.GBO2Duel.open();
      S.L.ms = me; S.R.ms = top; S.L.stage = 6; S.R.stage = 6;
      S.L.parts = []; S.R.parts = []; S.L.wKey = null; S.L.air = false;
      S.R.defs.clear();
      window.GBO2Duel.use({});
      const chips = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip.def')]
        .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim());
      window.GBO2Duel.close();
      return { 기체: top.MS名, LV: A.msLevel(top), 칩: chips };
    }, base);

    const want = rows.filter(r => got && r.from <= got.LV).pop();
    ok('대결의 방어 칩이 **그 기체 LV** 의 값이다 — LV' + (got && got.LV) + ' → −'
      + (want && want.pct) + '%   (was 전 기체 LV1 로 읽어 −' + rows[0].pct + '% 였다)',
      !!got && !!want && got.칩.some(c => c.includes('−' + want.pct + '%')),
      got);
  }

  ok('콘솔 오류가 없다', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
