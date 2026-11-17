// 좋은 쪽만 읽고 나쁜 쪽을 버리던 효과들이 대결에 걸리는가 (2026-11-17 버그 탐색 — 원문을 문장 단위로 대조해 찾음).
//   node tools/selfpenalty_check.js
//
//   ① 사이코 패키지(파츠) 「サイコミュ兵装から受けるダメージを10%短縮」 — 사이코뮤 무장에 맞을 때만 −10%
//   ② 사이코뮤 시스템 폭주 「被ダメージ＋35%」 — 켜면 받는 피해 ×1.35 (보정 +35 만 걸렸다)
//   ③ 토성 엔진 최대 출력 「高速移動中被ダメージ＋30%」 — 고속 이동 중인지 몰라 셈에 안 넣고 **밝힌다**
//   ④ 사이코 재머 제어 장치 「有利カテゴリー与ダメージ －10%」 — 유리 상대에게 주는 피해 −10% (속도 −5 만 걸렸다)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};
const done = () => { console.log('\n' + (fail ? 'FAIL' : 'OK') + '  자기 불이익 ' + pass + '/' + (pass + fail)); process.exit(fail ? 1 : 0); };

/* ── 데이터 — 추출기가 불이익을 싣는가 ── */
const SK = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'skills.json'), 'utf8'));
const lv = (ms, name) => ((SK[ms] || []).find(s => s.name === name) || { levels: [] }).levels;
ok('폭주 — dmgTaken 35', lv('プロトタイプ・サイコ・ガンダム', 'サイコミュシステム暴走').some(l => l.dmgTaken === 35));
ok('토성 엔진 — dmgTakenBoost 30/25/20 (LV 구간별)', ['30', '25', '20'].every(v =>
  lv('ヅダ', '土星エンジン最大出力').some(l => String(l.dmgTakenBoost) === v)));
ok('사이코 재머 — dmgAdvAny −10 (음수)', lv('ローゼン・ズール', 'サイコ・ジャマー制御装置').some(l => l.dmgAdvAny === -10));

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
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
    await pg.goto('file:///' + FILE.split(path.sep).join('/').split(' ').join('%20'), { waitUntil: 'load', timeout: 180000 });
    await new Promise(r => setTimeout(r, 3200));
    const r = await pg.evaluate(() => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state, D = window.GBO2Duel;
      const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
      const parts = Object.values(G.parts).flat();
      const reset = () => { for (const s of [S.L, S.R]) { s.parts = []; s.buffs.clear(); s.defs.clear(); s.form = 'normal'; s.wKey = null; s.barrierOn = false; s.shieldOn = false; } };
      const pick = (side, test) => { const w = D.weaponsOf(side).find(test); if (w) side.wKey = w.key; return w; };
      D.open();
      const out = {};
      // ① 사이코 패키지 — 사이코뮤 무장(ν 핀 판넬) vs 아닌 무장
      reset();
      S.L.ms = by('νガンダム'); S.R.ms = by('ガンダム');
      S.R.parts = [parts.find(p => /^サイコ・パッケージ_LV1$/.test(p.name))];
      pick(S.L, w => w.w.psycommu && w.power > 0);
      const a1 = D.attack(S.L, S.R);
      pick(S.L, w => !w.w.psycommu && !w.melee && w.power > 0);
      const a2 = D.attack(S.L, S.R);
      out.pkg = { psy: a1 && a1.factor, psyLabels: a1 && a1.cutList.map(c => c.label), non: a2 && a2.factor };
      // ② 폭주 — 맞는 쪽이 켜면 ×1.35
      reset();
      S.L.ms = by('ガンダム'); S.R.ms = by('プロトタイプ・サイコ・ガンダム');
      pick(S.L, w => !w.melee && w.power > 0);
      const b0 = D.attack(S.L, S.R);
      S.R.buffs.add('サイコミュシステム暴走');
      const b1 = D.attack(S.L, S.R);
      D.use({});
      const chipTxt = [...document.querySelectorAll('.dc-chips span')].map(e => e.textContent).join(' | ');
      out.boso = { f0: b0.factor, f1: b1.factor, s0: b0.shots, s1: b1.shots, chip: chipTxt };
      // ③ 토성 엔진 — 셈은 그대로, 카드에 밝힌다
      reset();
      S.L.ms = by('ガンダム'); S.R.ms = by('ヅダ');
      pick(S.L, w => !w.melee && w.power > 0);
      const c0 = D.attack(S.L, S.R);
      S.R.buffs.add('土星エンジン最大出力');
      const c1 = D.attack(S.L, S.R);
      D.use({});
      out.dosei = { f0: c0.factor, f1: c1.factor, boost: c1.takenBoost,
        note: [...document.querySelectorAll('.fx-cond')].map(e => e.textContent).join(' | ') };
      // ④ 사이코 재머 — 유리 상대에게 주는 피해 −10%
      reset();
      S.L.ms = by('ローゼン・ズール');
      pick(S.L, w => !w.melee && w.power > 0);
      for (const m of G.msData) {
        S.R.ms = m;
        const a = D.attack(S.L, S.R);
        if (a && a.att === 'advantage') break;
      }
      const d0 = D.attack(S.L, S.R);
      S.L.buffs.add('サイコ・ジャマー制御装置');
      const d1 = D.attack(S.L, S.R);
      D.use({});
      out.jammer = { att: d1.att, sk: d1.skPcts, b0: d0.boosted, b1: d1.boosted,
        chip: [...document.querySelectorAll('.ds-chip')].map(e => e.textContent).find(t => /재머|ジャマー/.test(t)) || '' };
      D.close();
      return out;
    });
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    ok('① 사이코 패키지 — 사이코뮤 무장에 맞으면 ×0.9 · 「사이코뮤 경감」  (was ×1)', near(r.pkg.psy, 0.9) && r.pkg.psyLabels.includes('사이코뮤 경감'), r.pkg);
    ok('① …사이코뮤가 아닌 무장에는 안 걸린다', near(r.pkg.non, 1), r.pkg);
    ok('② 폭주를 켜면 받는 피해 ×1.35 · 격파 발수가 준다  (was ×1)', near(r.boso.f0, 1) && near(r.boso.f1, 1.35) && r.boso.s1 <= r.boso.s0, r.boso);
    ok('② 계산식 칩이 「상대 받는 피해 ×1.35」 를 적는다', /상대 받는 피해 ×1\.35/.test(r.boso.chip), r.boso.chip);
    ok('③ 토성 엔진 — 셈은 그대로(고속 이동 중인지 모름)', near(r.dosei.f0, r.dosei.f1), r.dosei);
    ok('③ …대신 카드에 「고속 이동 중 받는 피해 +N%」 · 「셈에 안 넣음」 을 적는다',
      (r.dosei.boost || []).length === 1 && /고속 이동 중 받는 피해 \+\d+%/.test(r.dosei.note) && /셈에 안 넣음/.test(r.dosei.note), r.dosei);
    ok('④ 사이코 재머 — 유리 상대에게 주는 피해 −10%  (was 속도 −5 만)', r.jammer.att === 'advantage'
      && r.jammer.sk.includes(-10) && r.jammer.b1 < r.jammer.b0, r.jammer);
    ok('④ 칩 문구가 「유리 상대 피해−10%」 (「+-10%」 아님)', /유리 상대 피해−10%/.test(r.jammer.chip) && !/\+-/.test(r.jammer.chip), r.jammer.chip);
    ok('화면 오류 없음', !errs.length, errs);
  } finally { await br.close(); }
  done();
})();
