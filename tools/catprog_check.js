// 카테고리 특공 프로그램(파츠) — 유리 상성 배율 130% → 140% 가 대결에 걸리는가.
//   node tools/catprog_check.js
//
// ■ 왜 — 2026-11-17 코드 정리 점검: 이 셈(attrBonusOf)이 앱 03-weapons 에 있었지만 **아무도 부르지 않아**
//   대결에서 효과가 통째로 빠져 있었다. 파츠를 달아도 유리 상성이 ×1.3 이었다.
//   셈을 damage.partCatAdvOf 한 곳으로 옮기고 대결이 부르게 했다.
// ■ 자 — 위키 7000 「カテゴリ補正の130%に＋10%され、140%になる」. 유리일 때만, 불리·동일은 그대로.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'src', 'damage.js'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};
const done = () => { console.log('\n' + (fail ? 'FAIL' : 'OK') + '  카테고리 특공 ' + pass + '/' + (pass + fail)); process.exit(fail ? 1 : 0); };

ok('damage 가 partCatAdvOf 를 내놓는다', typeof D.partCatAdvOf === 'function');
if (typeof D.partCatAdvOf === 'function') {
  const P = { description: '強襲カテゴリのみ装備可能。射撃補正と格闘補正を7増加。有利カテゴリの敵機に与えるダメージを増加。' };
  ok('특공 파츠가 있으면 +0.1', D.partCatAdvOf([P]) === 0.1);
  ok('둘 달아도 겹치지 않는다(+0.1)', D.partCatAdvOf([P, P]) === 0.1);
  ok('없으면 0', D.partCatAdvOf([{ description: '射撃補正を7増加。' }]) === 0 && D.partCatAdvOf([]) === 0);
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
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
    await pg.goto('file:///' + FILE.split(path.sep).join('/').split(' ').join('%20'), { waitUntil: 'load', timeout: 180000 });
    await new Promise(r => setTimeout(r, 3200));
    const r = await pg.evaluate(() => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state, Dl = window.GBO2Duel;
      const allParts = Object.values(G.parts).flat();
      const prog = allParts.find(p => /^カテゴリ特攻プログラム_強襲/.test(p.name));
      const me = G.msData.find(m => m.属性 === '強襲');
      if (!prog || !me) return { err: 'no data', prog: !!prog, me: !!me };
      Dl.open();
      const out = {};
      // 상대를 훑어 유리·불리·동일을 하나씩 찾는다(상성표를 여기 다시 적지 않는다 — 앱에 묻는다)
      for (const foe of G.msData) {
        S.L.ms = me; S.R.ms = foe; S.L.parts = []; S.R.parts = []; S.L.buffs.clear(); S.L.wKey = null;
        const wp = Dl.weaponsOf(S.L).find(w => !w.melee);
        if (!wp) return { err: 'no weapon' };
        S.L.wKey = wp.key;
        const a0 = Dl.attack(S.L, S.R);
        if (!a0 || out[a0.att]) continue;
        S.L.parts = [prog];
        const a1 = Dl.attack(S.L, S.R);
        out[a0.att] = { pr0: a0.pr, pr1: a1.pr, raw0: a0.raw, raw1: a1.raw, cat: a1.catPart };
        if (out.advantage && out.disadvantage && out.same) break;
      }
      // 화면의 칩 — 유리 상대로 다시 세우고 그려 본다
      for (const foe of G.msData) {
        S.L.ms = me; S.R.ms = foe; S.L.parts = [prog]; S.L.wKey = Dl.weaponsOf(S.L).find(w => !w.melee).key;
        const a = Dl.attack(S.L, S.R);
        if (a && a.att === 'advantage') { Dl.use({}); break; }
      }
      out.chips = [...document.querySelectorAll('.dc-chips span')].map(e => e.textContent).filter(t => /상성/.test(t));
      Dl.close();
      return out;
    });
    ok('대결 준비 — 강습 기체 · 카테고리 특공 프로그램[강습]', !r.err, r);
    if (!r.err) {
      const A = r.advantage, S = r.same, X = r.disadvantage;
      ok('유리 상대 — 파츠 없이 ×1.3 (0.3)', !!A && Math.abs(A.pr0 - 0.3) < 1e-9, A);
      ok('유리 상대 — 파츠를 달면 ×1.4 (0.4) · catPart 0.1  (was 0.3 그대로)', !!A && Math.abs(A.pr1 - 0.4) < 1e-9 && A.cat === 0.1, A);
      ok('유리 상대 — 피해가 실제로 커진다', !!A && A.raw1 > A.raw0, A);
      ok('불리 상대 — 파츠를 달아도 ×0.8 그대로', !!X && Math.abs(X.pr1 - X.pr0) < 1e-9, X);
      ok('동일 상대 — 파츠를 달아도 ×1.0 그대로', !!S && Math.abs(S.pr1 - S.pr0) < 1e-9, S);
      ok('계산식 칩이 실제 배율 ×1.4 와 출처를 적는다', (r.chips || []).some(t => /×1\.4/.test(t) && /카테고리 특공/.test(t)), r.chips);
    }
    ok('화면 오류 없음', !errs.length, errs);
  } finally { await br.close(); }
  done();
})();
