// 「〜カテゴリからの被ダメージ」 — 상대 병과에 따라 갈리는 피해 경감을 병과대로 거는가.
//   node tools/catcut_check.js        (먼저 node tools/build.js)
//
// ■ 왜 — ν건담［DFF装備］ 「サイコフレーム共振（A）」 (사용자 지적 2026-11-11):
//     ・汎用・支援カテゴリからの射撃属性被ダメージ －40%
//     ・強襲カテゴリからの被ダメージ －50%      (格闘属性による被ダメージも軽減対象)
//   경감 파서가 「カテゴリからの」 를 몰라 **사격 −40% 를 상대 가리지 않고** 걸고,
//   강습 −50% 는 앞에서 사격 경감을 하나 읽었다는 이유로 통째로 버렸다.
//   → 강습에게 맞으면 사격 −40%(원래 −50%) · 격투 0%(원래 −50%), 범용·지원은 맞았다.
//
// 상대가 없는 셈(내구 지표 · 자동 구성)은 병과를 모른다 — 「모르는 조건은 상시가 아니다」 로 그 몫을 빼고,
// 대결은 공격 쪽 병과를 알아 그에 맞는 쪽만 건다.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const GBO2Browser = require('./lib/browser.js');
const { findChrome } = require('./lib/wiki_fetch.js');
const DG = require('./lib/duelgate.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};
const DFF = 'νガンダム［DFF装備］', SKILL = 'サイコフレーム共振（A）';

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const pg = await br.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
    await pg.goto('file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20'),
      { waitUntil: 'load', timeout: 180000 });
    await new Promise(r => setTimeout(r, 4000));

    // ① 파서가 병과를 읽는가 — 방어 스킬 목록에 병과가 붙어 있어야 한다
    const sk = await pg.evaluate((dff, skill) => {
      const T = window.GBO2UiTest;
      const ms = T.msData().filter(m => m.MS名.startsWith(dff + '_')).pop();
      const s = T.staggerSkillsOf(ms, T.msLevel(ms), 'normal').find(x => x.name === skill);
      return s ? { cuts: s.cuts, cond: s.cond } : null;
    }, DFF, SKILL);
    ok('방어 스킬에 잡힌다', !!sk, sk);
    const cuts = (sk && sk.cuts) || [];
    const has = (scope, pct, cats) => cuts.some(c => c.scope === scope && c.pct === pct
      && JSON.stringify((c.foeCat || []).slice().sort()) === JSON.stringify(cats.slice().sort()));
    ok('범용·지원 상대 사격 −40%', has('shoot', 40, ['汎用', '支援']), cuts);
    ok('강습 상대 피해 −50% (격투 포함)', has('all', 50, ['強襲']), cuts);
    ok('병과 없는 경감으로 새지 않았다', cuts.every(c => c.foeCat && c.foeCat.length), cuts);

    // ② 대결 — 병과 · 속성 네 갈래를 스킬 켬/끔 비율로 잰다(다른 경감이 있어도 비율은 이 스킬 몫이다)
    const defs = [SKILL, SKILL + '#1'];
    const ratio = async (atk, melee) => {
      const q = { me: atk, foe: DFF, melee };
      const off = await DG.measure(pg, q);
      const on = await DG.measure(pg, { ...q, defs });
      if (off.오류 || on.오류) return { 오류: off.오류 || on.오류 };
      return { r: Math.round(on.경감배수 / off.경감배수 * 1000) / 1000, 무장: on.무장 };
    };
    const want = [
      ['강습(걍) 사격', 'ギャン', false, 0.5], ['강습(걍) 격투', 'ギャン', true, 0.5],
      ['범용(건담) 사격', 'ガンダム', false, 0.6], ['범용(건담) 격투', 'ガンダム', true, 1],
      ['지원(건캐논) 사격', 'ガンキャノン', false, 0.6]
    ];
    for (const [label, atk, melee, w] of want) {
      const r = await ratio(atk, melee);
      ok(label + ' → 피해 ×' + w, !r.오류 && r.r === w, r);
    }
    await DG.close(pg);
    ok('스크립트 오류 없음', errs.length === 0, errs);
  } finally { await br.close(); }
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
