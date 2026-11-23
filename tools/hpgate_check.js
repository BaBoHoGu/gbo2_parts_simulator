// HP 조건 스킬 — 「HP 가 근원, 스킬은 HP 를 따른다」 (대결, 2026-11-18)
//   node tools/hpgate_check.js
//
// ■ 왜 — 대결은 양쪽 HP 100% 에서 시작하며 「HP 50% 이하」 스킬(폭주 · 바이오센서 …)을 손으로 켜게 해,
//   「HP 100% 인데 50% 이하 스킬이 켜진」 있을 수 없는 상태를 셌다. 맞는 쪽은 100→0 내내 스킬이 걸린 것으로,
//   「HP 80% 미만이면 무효」(쵸밤 아머)는 0 까지 걸린 것으로 셌다.
// ■ 자 — 쪽마다 현재 HP(%). HP 조건 스킬은 그 HP 로 저절로 켜진다(칩을 누르면 HP 를 문턱으로 옮긴다).
//   맞는 쪽은 현재 HP 에서 0 까지 따라가며 그때 켜진 스킬로 깎는다(core.hpPhaseSteps).
//   HP 말고 한 방 크기(나노라미네이트) · 다른 동작(램 어택 · 레이즈 카운터) · 절대값(보조 동력) 조건이 붙은 것은 손으로 켠다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};
const done = () => { console.log('\n' + (fail ? 'FAIL' : 'OK') + '  HP 조건 ' + pass + '/' + (pass + fail)); process.exit(fail ? 1 : 0); };

/* ── ① core ── */
const has = typeof C.hpGateOf === 'function' && typeof C.hpPhaseSteps === 'function';
ok('core 가 hpGateOf · hpGateOn · hpGateTarget · hpPhaseSteps · HP_AND_RE 를 내놓는다', has && !!C.HP_AND_RE);
if (has) {
  const g = t => JSON.stringify(C.hpGateOf(t));
  ok('「機体HPが 50%以下 になった際」 → 이하 50', g('機体HPが 50%以下 になった際、自動で発動') === '{"op":"le","pct":50}');
  ok('「機体HPが80%未満になると…無効」(쵸밤) → 80% 이상에서 켜짐 (뒤집힘)',
    g('ただし、機体HPが80%未満になると / ダメージ軽減およびリアクションに関する効果が無効となる。') === '{"op":"ge","pct":80}');
  ok('「機体HPが 1000 以上の時に」(보조 동력) → 절대값', g('機体HPが 1000 以上の時に撃破される') === '{"op":"ge","abs":1000}');
  ok('HP 와 다른 조건이 함께 — 「HP50%以下かつ高速移動」 · 「HPが 50% 以下でカウンターが成立した場合」',
    C.HP_AND_RE.test('HP50%以下かつ高速移動を約1秒使用後に発動') && C.HP_AND_RE.test('機体HPが 50% 以下でカウンターが成立した場合')
    && !C.HP_AND_RE.test('機体HPが 50%以下 になった際、自動で発動'));
  ok('문턱 판정 — 이하 50: 50 켜짐 · 51 꺼짐 / 미만 50 → 옮길 HP 49',
    C.hpGateOn({ op: 'le', pct: 50 }, 50) && !C.hpGateOn({ op: 'le', pct: 50 }, 51) && C.hpGateTarget({ op: 'lt', pct: 50 }) === 49);
  const r = C.hpPhaseSteps({ startFrac: 1, dmgFracAt: f => (f > 0.5 ? 0.1 : 0.135), keyAt: f => (f <= 0.5 ? 'X' : '') });
  ok('구간 셈 — 10% 씩 5발로 50% → 그 뒤 13.5% 씩 ⌈0.5/0.135⌉=4발 = 9발 (소수 끝 0.5000…1 로 한 발 늦지 않게)',
    r.n === 9 && r.segs.length === 2 && r.segs[0].n === 5 && r.segs[1].n === 4, r.segs);
  ok('시작 HP 50% 에서 — 4발', C.hpPhaseSteps({ startFrac: 0.5, dmgFracAt: f => (f > 0.5 ? 0.1 : 0.135) }).n === 4);
}

(async () => {
  let findChrome;
  try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
  catch { console.log('  SKIP 화면 — puppeteer-core 없음'); return done(); }
  const CHROME = findChrome();
  const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  if (!CHROME || !fs.existsSync(FILE)) { console.log('  SKIP 화면 — Chrome/dist 없음'); return done(); }
  const br = await require('./lib/browser.js').launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const pg = await br.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
    await pg.setViewport({ width: 1400, height: 900 });
    await pg.goto('file:///' + FILE.split(path.sep).join('/').split(' ').join('%20'), { waitUntil: 'load', timeout: 180000 });
    await new Promise(r => setTimeout(r, 3200));
    const setup = (foe, me, hpR, hpL) => pg.evaluate((foe, me, hpR, hpL) => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state, D = window.GBO2Duel;
      const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
      const byLv = n => G.msData.find(m => m.MS名 === n);
      D.open();
      S.L.ms = byLv(me) || by(me); S.R.ms = byLv(foe) || by(foe);
      for (const s of [S.L, S.R]) { s.parts = []; s.buffs.clear(); s.defs.clear(); s.form = 'normal'; s.barrierOn = false; s.shieldOn = false; }
      S.L.wKey = D.weaponsOf(S.L).find(w => !w.melee && w.power > 0).key;
      const rw = D.weaponsOf(S.R).find(w => !w.melee && w.power > 0); if (rw) S.R.wKey = rw.key;
      S.R.hp = hpR; S.L.hp = hpL;
      D.use({});
      return true;
    }, foe, me, hpR, hpL);
    const atk = () => pg.evaluate(() => {
      const S = window.GBO2Duel.state, a = window.GBO2Duel.attack(S.L, S.R);
      return a && { shots: a.shots, eff: a.eff, per: a.per, factor: a.factor, phases: a.phases, hpStart: a.hpStart, corr: a.corr, trail: (a.trail || []).length };
    });

    /* ② 폭주 — 맞는 쪽 100% 에서: 50% 까지 스킬 없이, 그 뒤 ×1.35 */
    await setup('プロトタイプ・サイコ・ガンダム', 'ガンダム', 100, 100);
    const p100 = await atk();
    await setup('プロトタイプ・サイコ・ガンダム', 'ガンダム', 50, 100);
    const p50 = await atk();
    // 손 계산 — 만피일 때(스킬 꺼짐)와 50% 일 때(켜짐) 한 발 비율로 직접 따라간다
    let f = 1, n = 0;
    while (f > 1e-9 && n < 500) { f = Math.round((f - (f > 0.5 ? p100.per / p100.eff : p50.per / p50.eff)) * 1e9) / 1e9; n++; }
    ok('폭주 — 만피에서는 스킬이 꺼진 셈(×1)으로 시작한다  (was 처음부터 켤 수 있었다)', p100 && Math.abs(p100.factor - 1) < 1e-9, p100);
    ok('폭주 — HP 50% 에서는 저절로 켜진다(×1.35)', p50 && Math.abs(p50.factor - 1.35) < 1e-9, p50);
    ok('폭주 — 만피에서 격파까지 = 손 계산(50% 까지 스킬 없이, 그 뒤 ×1.35) ' + n + '발', p100.shots === n && p100.phases.length === 2
      && p100.phases[1].on.length > 0, { got: p100.shots, n, phases: p100.phases });
    ok('HP 50% 에서 시작하면 그 HP 부터 센다(구간 하나 · 폭주)', p50.hpStart === 50 && p50.phases.length === 1 && p50.shots < p100.shots, p50);

    /* ③ 칩을 누르면 HP 가 문턱으로 — 진짜 마우스 */
    await setup('プロトタイプ・サイコ・ガンダム', 'ガンダム', 100, 100);
    const chipAt = await pg.evaluate(() => {
      const c = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip.auto')].find(x => /폭주|暴走/.test(x.textContent));
      if (!c) return null;
      c.scrollIntoView({ block: 'center' });
      const r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, hit: !!top && (top === c || c.contains(top)), on: c.classList.contains('on'), text: c.textContent };
    });
    ok('폭주 칩은 「자동」 칩이고 만피에서는 꺼져 있다', !!chipAt && chipAt.hit && !chipAt.on && /HP 50% 이하에서 자동/.test(chipAt.text), chipAt);
    if (chipAt) await pg.mouse.click(chipAt.x, chipAt.y);
    await new Promise(r => setTimeout(r, 300));
    const after = await pg.evaluate(() => {
      const S = window.GBO2Duel.state;
      const c = [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip.auto')].find(x => /폭주|暴走/.test(x.textContent));
      const inp = document.querySelector('.duel-side[data-side="R"] .ds-hp-in');
      return { hp: S.R.hp, on: !!c && c.classList.contains('on'), inp: inp && inp.value,
        btns: [...document.querySelectorAll('.duel-side[data-side="R"] .ds-hp-b')].map(b => b.textContent),
        phase: [...document.querySelectorAll('.dc-phase')].map(e => e.textContent).join(' | '),
        verdict: (document.querySelector('.dc-verdict') || {}).textContent || '' };
    });
    ok('누르면 HP 가 50% 로 옮겨지고 칩이 켜진다', after.hp === 50 && after.on && after.inp === '50', after);
    ok('HP 줄에 100% 와 이 기체 문턱(50%) 단추만 나온다', after.btns.join(',') === '100%,50%', after.btns);
    ok('카드에 「상대 HP 50% 부터」 와 구간이 적힌다', /상대 HP 50% 부터/.test(after.phase), after.phase);
    ok('승패 줄이 어느 HP 에서 견줬는지 적는다', /나 HP 100% · 상대 HP 50%/.test(after.verdict), after.verdict);

    /* ④ 「HP 80% 미만이면 무효」(쵸밤 아머, 짐 캐논Ⅱ LV1) — 만피에선 켜져 있다가 80% 아래에서 꺼진다 */
    await setup('ジム・キャノンⅡ_LV1', 'ザク・キャノン', 100, 100);
    const ch = await atk();
    ok('쵸밤 아머 — 80% 이상 구간은 실탄 −50%, 그 아래는 꺼진 셈(구간 둘)', !!ch && ch.phases && ch.phases.length === 2
      && ch.factor < 1 && !ch.phases[1].on, ch);

    /* ⑤ 손으로 켜는 것 — 한 방 크기 조건 · 다른 동작 조건 */
    await setup('ガンダム・バルバトスルプス', 'ガンダム', 100, 100);
    const nano = await pg.evaluate(() => [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip')].map(c => ({ t: c.textContent, auto: c.classList.contains('auto') })).find(x => /나노|ナノ/.test(x.t)));
    ok('나노라미네이트(한 방 2000 이하 조건)는 저절로 안 켜지고 까닭을 적는다', !!nano && !nano.auto && /한 방 2000 이하 조건 — 직접 켬/.test(nano.t), nano);
    await setup('Ξガンダム', 'ガンダム', 50, 100);
    // 방어 칩(.def) 을 본다 — 같은 이름의 버프 칩(피해 +20%)도 있다(그쪽은 HP 문턱이 없어 원래 손으로 켠다)
    const raise = await pg.evaluate(() => [...document.querySelectorAll('.duel-side[data-side="R"] .ds-chip.def')].map(c => ({ t: c.textContent, auto: c.classList.contains('auto'), on: c.classList.contains('on') })).find(x => /레이즈|レイズ/.test(x.t)));
    ok('레이즈 카운터(카운터 성립 조건)는 HP 50% 에서도 저절로 안 켜진다', !!raise && !raise.auto && !raise.on && /다른 동작 조건/.test(raise.t), raise);

    /* ⑥ 때리는 쪽 — 자기 HP 에서 켜진 공격 버프 (ν건담 사이코 프레임 공진(A) · HP 50% 이하) */
    await setup('ガンダム', 'νガンダム', 100, 100);
    const n100 = await atk();
    await setup('ガンダム', 'νガンダム', 100, 50);
    const n50 = await atk();
    ok('때리는 쪽 HP 50% 면 자기 공격 버프가 켜져 보정이 오른다(100% 에선 안 켜짐)', !!n100 && !!n50 && n50.corr > n100.corr, { n100: n100 && n100.corr, n50: n50 && n50.corr });

    /* ⑥-2 버프 스킬 문턱은 **기체 LV 마다** — 원문이 LV 로 문턱을 바꾼다(2026-11-24 버그 탐색: 버프 표가 스킬당 한 값만 들고 있었다).
       유니콘 PF LV2 는 효과 값이 「?」 라 버프 표에 줄이 없는데도 원문 줄의 80% 를 읽어야 한다. */
    const LVCASES = [
      ['デスティニーガンダム_LV1', '最大稼働', 50], ['デスティニーガンダム_LV2', '最大稼働', 80],
      ['キュベレイ_LV2', '共振', 30], ['キュベレイ_LV3', '共振', 50],
      // 사자비 LV1 은 그 스킬에 셈에 닿는 값이 없어(사격 피해 −20% 는 LV2～) 칩이 안 나온다 — LV2 만 본다
      ['サザビー_LV2', '共振', 50],
      ['ユニコーンガンダムPF_LV1', '共鳴', 50], ['ユニコーンガンダムPF_LV2', '共鳴', 80],
    ];
    for (const [ms, sk, want] of LVCASES) {
      await setup('ガンダム', ms, 100, 100);   // 왼쪽(때리는 쪽)에 앉혀 그 쪽 칩을 읽는다
      const chip = await pg.evaluate(re => {
        const c = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-chip.auto')].find(x => new RegExp(re).test(x.textContent)
          || [...x.childNodes].some(n => n.nodeType === 3 && new RegExp(re).test(n.textContent)));
        return c ? c.textContent : null;
      }, sk === '最大稼働' ? '최대 가동|最大稼働' : sk === '共鳴' ? '공명|共鳴' : '공진|共振');
      ok(ms + ' — 버프 「' + sk + '」 은 HP ' + want + '% 이하에서 자동', !!chip && chip.includes('HP ' + want + '% 이하에서 자동'), chip);
    }

    /* ⑦ 전 기체 — 양쪽 HP 50% 로 셈이 깨지지 않는다 */
    const sweep = await pg.evaluate(() => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state, D = window.GBO2Duel;
      const byBase = new Map(); for (const m of G.msData) byBase.set(m.MS名.replace(/_LV\d+$/, ''), m);
      const bad = [];
      const foe = [...byBase.values()][0];
      for (const me of byBase.values()) {
        S.L.ms = foe; S.R.ms = me; S.L.parts = []; S.R.parts = []; S.L.buffs.clear(); S.R.buffs.clear(); S.R.defs.clear();
        S.L.wKey = D.weaponsOf(S.L)[0].key; S.L.hp = 50; S.R.hp = 50;
        try {
          const a = D.attack(S.L, S.R);
          if (a && (a.shots != null && (!isFinite(a.shots) || a.shots < 0))) bad.push(me.MS名 + ' shots=' + a.shots);
        } catch (e) { bad.push(me.MS名 + ' ' + e.message); }
      }
      S.L.hp = 100; S.R.hp = 100;
      return { n: byBase.size, bad };
    });
    ok('전 기체(' + sweep.n + ')를 HP 50% 로 맞혀도 오류·이상한 발수가 없다', !sweep.bad.length, sweep.bad.slice(0, 5));
    await pg.evaluate(() => window.GBO2Duel.close());
    ok('화면 오류 없음', !errs.length, errs);
  } finally { await br.close(); }
  done();
})();
