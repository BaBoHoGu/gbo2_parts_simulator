// 대상 HP 에 따라 달라지는 추가 피해 — 피탄 시뮬 실측.
//   node tools/hpcond_check.js
//
// 데이터에 11개 무장이 있고 **수치가 다 적힌 것은 둘**이다. 그 둘은 구간을 따라가며 세고,
// 나머지 아홉은 값이 원문에 없거나 스킬 발동이 조건이라 **셀 수 없다** — 셈하지 않고 밝힌다.
// 발수는 앱의 식을 베끼지 않고 **備考에서 직접 읽은 구간**으로 따로 세어 맞대 본다.
const GBO2Browser = require('./lib/browser.js');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const D = require(path.join(ROOT, 'src', 'damage.js'));

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const URL = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra != null ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

const weapons = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'weapons.json'), 'utf8'));
const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const dict = {
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'ms.auto.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'ms.json'), 'utf8'))
};

// 備考 를 훑어 두 갈래로 나눈다 — 이름을 코드에 박지 않는다
const counted = [], unknown = [];
for (const [key, v] of Object.entries(weapons)) {
  for (const w of (v.weapons || [])) {
    const r = D.hpBonusOf(String((w.info || {})['備考'] || ''));
    if (!r) continue;
    (r.unknown ? unknown : counted).push({ key, name: w.name, r });
  }
}
/* **개수를 박지 않는다.** 처음엔 11 / 2 / 9 로 적었는데, 데이터가 갱신되며
   ギャン改用大型B・S［連続突き］ 가 들어오자마자 깨졌다(못셈 9 → 10).
   무장은 계속 는다 — 묶는 **성질**을 재고 개수는 적어서 보여만 준다. */
console.log('  (지금: 셀 수 있음 ' + counted.length + ' · 못 셈 ' + unknown.length + ')');
ok('HP 비례 추가 피해 무장이 양쪽 다 있다', counted.length > 0 && unknown.length > 0,
  { 셀수있음: counted.length, 못셈: unknown.length });
ok('셀 수 있다고 가른 것은 구간이 실제로 읽힌다',
  counted.every(c => Array.isArray(c.r.bands) && c.r.bands.length > 0
    && c.r.bands.every(b => b.lo > 0 && (b.pct > 0 || b.flat > 0))),
  counted.map(c => c.name + ': ' + JSON.stringify(c.r.bands)));
ok('못 세는 무장마다 이유가 있다', unknown.every(u => u.r.why && u.r.why.length > 4),
  unknown.slice(0, 2).map(u => u.name + ': ' + u.r.why));

/* 구간 읽기 자체를 못 박는다 — 원문 그대로. 데이터가 바뀌면 여기서 걸린다. */
const rail = counted.find(c => /レールガン［最大出力］/.test(c.name));
ok('레일건[최대출력] 구간이 원문대로다', !!rail
  && JSON.stringify(rail.r.bands) === JSON.stringify([
    { lo: 100, pct: 100, flat: 0 }, { lo: 70, pct: 50, flat: 0 }, { lo: 40, pct: 20, flat: 0 }]),
rail && rail.r.bands);
const web = counted.find(c => /スクリュー・ウェッブ/.test(c.name));
ok('스크류 웨브 구간이 원문대로다', !!web
  && JSON.stringify(web.r.bands) === JSON.stringify([
    { lo: 50, pct: 0, flat: 400 }, { lo: 25, pct: 0, flat: 200 }]),
web && web.r.bands);

// HP 비율이 내려가며 구간이 바뀌는지 (정의상 참이 아니라 실제 경계를 본다)
const at = r => { const b = D.hpBandAt(rail.r.bands, r); return b ? b.pct : 0; };
ok('구간 경계가 맞는다 (100→100 · 99.9→50 · 70→50 · 69→20 · 39→0)',
  at(100) === 100 && at(99.9) === 50 && at(70) === 50 && at(69) === 20 && at(39) === 0,
  [at(100), at(99.9), at(70), at(69), at(39)]);

(async () => {
  const br = await GBO2Browser.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  pg.on('dialog', d => d.accept());
  await pg.setViewport({ width: 1500, height: 1050 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1800);

  // 방어 쪽 기체 하나를 고르고 피탄 시뮬을 연다
  await pg.evaluate(() => {
    const i = document.querySelector('#msQuery');
    i.value = '건담 Ez8'; i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(900);
  await pg.evaluate(() => document.querySelector('#msList .ms-card').click());
  await sleep(1300);
  const DG = require('./lib/duelgate.js');
  /* 적 기체·무장을 **대결 시뮬**에서 고른다(피탄 시뮬이 있던 자리).
     읽는 값은 화면 글자가 아니라 attack() 이 내놓는 것 — 글자는 바뀌어도 뜻은 안 바뀐다.
     다만 「발마다의 피해」와 「※ 반영하지 않은 효과」는 **화면에 적혔는지**가 요점이라
     거기만 글자로 읽는다. 맞는 쪽은 앱에서 고른 건담 Ez8(me: null)이다. */
  let cur = null, curFoe = null;
  const pickEnemy = async (jpName) => { cur = null; curFoe = jpName; return { ok: true }; };
  const pickWeapon = async (re) => {
    const r = await DG.measure(pg, { me: null, foe: curFoe, from: 'R', weapon: re });
    cur = r.오류 ? null : r;
    return !r.오류;
  };
  const pickWeaponExact = async (nm) => {
    const r = await DG.measure(pg, { me: null, foe: curFoe, from: 'R', weaponExact: nm });
    cur = r.오류 ? null : r;
    return !r.오류;
  };
  const foeWeapons = () => DG.weaponsOf(pg, { me: null, foe: curFoe, from: 'R' });
  const readResult = async () => {
    if (!cur) return { kill: null, unmod: null, goal: '' };
    const dom = await pg.evaluate(sel => {
      const c = document.querySelector(sel);
      const u = c && c.querySelector('.dc-unmod');
      return {
        sub: c ? ((c.querySelector('.dc-sub') || {}).textContent || '') : '',
        unmodV: u ? ((u.querySelector('b') || {}).textContent || '') : '',
        unmodN: u ? ((u.querySelector('small') || {}).textContent || '') : '',
        goal: ((document.querySelector('#duelModal .goal-row .goal-note') || {}).textContent || '')
      };
    }, cur.카드);
    const sq = x => String(x).split(/\s+/).join(' ').trim();
    return {
      kill: { v: cur.발수 == null ? '—' : cur.발수 + '발', note: sq(dom.sub) },
      unmod: dom.unmodV ? { v: sq(dom.unmodV), note: sq(dom.unmodN) } : null,
      goal: sq(dom.goal)
    };
  };

  // ── 셀 수 있는 쪽 — 레일건[최대출력]
  const msName = m => dict[String(m.MS名).replace(/_LV\d+$/, '')] || String(m.MS名);
  const railMs = msData.find(m => /アトラスガンダム（BC）/.test(m.MS名));
  ok('레일건을 가진 기체를 찾았다', !!railMs, railMs && railMs.MS名);
  const pe1 = await pickEnemy(railMs.MS名);
  ok('적 기체를 골랐다', pe1.ok, pe1);
  await sleep(1300);
  ok('레일건[최대출력] 을 골랐다', await pickWeapon('最大出力'));
  await sleep(1300);
  const rr = await readResult();
  ok('격파까지가 나온다', !!rr.kill, rr);

  /* 앱의 식을 베끼지 않고 **화면이 적어 준 내구와 발마다의 피해**로 다시 센다.
     근거 줄에 「1발 100%→5,868」 꼴로 적혀 있으니, 그 값들을 더해 내구를 넘기는
     발수가 화면의 발수와 같아야 한다. */
  /* 근거 줄은 **기체 HP 눈금**으로 적는다 — 실효 HP(내구 지표)로 적었더니 사용자가
     제 HP 와 견주다 헷갈렸다(「1발 20,134 인데 내 HP 는 24,000?」). 둘은 비율이 같아
     발수는 그대로다. 실효 HP 는 그 줄의 title 에 남아 있다. */
  // 문구가 바뀌어 못 읽으면 **여기서 죽지 않고** 0 으로 둔다 — 죽으면 뒤 검사가 안 돈다
  const effRaw = (rr.kill.note.match(/HP\s*([\d,]+)/) || [])[1];
  const eff = effRaw ? Number(effRaw.replace(/,/g, '')) : 0;
  const steps = [...rr.kill.note.matchAll(/(\d+)발\s*(\d+)%→([\d,]+)/g)]
    .map(m => ({ n: +m[1], pct: +m[2], d: Number(m[3].replace(/,/g, '')) }));
  ok('근거에 발마다의 피해가 적혀 있다', steps.length >= 3, steps.slice(0, 3));

  /* **기체 HP 눈금으로 적는가.** 내구 지표로 적었더니 사용자가 제 HP 와 견주다 헷갈렸다.
     그래서 ① 글에 「내구」가 없고 ② 적힌 HP 가 그 기체의 실제 HP 이며
     ③ 실효 HP 는 title 에만 남아 있는지 본다(자동 구성이 그 눈금을 쓰므로 사라지면 안 된다). */
  /* 실효 HP(내구 지표)는 **화면 큰 글씨에서 뺐지만** 자동 구성이 쓰는 눈금이라
     어딘가에는 있어야 한다. 대결에서는 ① 중앙 카드의 「내구 지표」 줄과
     ② 버티기 목표 줄의 「실효 HP N 로 걸립니다」 둘에 남아 있다. */
  const hpInfo = await pg.evaluate(sel => {
    const c = document.querySelector(sel);
    const sub = c ? ((c.querySelector('.dc-sub') || {}).textContent || '') : '';
    const goal = (document.querySelector('#duelModal .goal-row .goal-note') || {}).textContent || '';
    /* 실효 HP 는 **글이 아니라 툴팁**에 있어야 한다 — 글로 적으면 사용자가 제 HP 와
       견주다 헷갈린다(앱이 그래서 옮겼다). 그래서 글(sub)이 아니라 title 을 본다. */
    const tip = c ? ((c.querySelector('.dc-kill') || {}).title || '') : '';
    const head = [...document.querySelectorAll('.duel-side[data-side="L"] .ds-dura .ds-dcell')]
      .map(e => e.textContent.replace(/[ ]+/g, ' ').trim());
    return { title: tip + ' ' + goal, head };
  }, cur.카드);
  ok('근거 줄에 「내구」라고 적지 않는다', !/내구/.test(rr.kill.note), rr.kill.note.slice(0, 60));
  /* 기대 HP 는 **앱이 적어 준 값이 아니라** core 로 직접 센다 — 베끼면 같이 틀린다.
     맞는 쪽 기체는 위에서 「건담 Ez8」로 골랐고, 파츠 없이 6강 기준이다. */
  const C2 = require(path.join(ROOT, 'src', 'core.js'));
  const defMs = msData.filter(m => /Ez8/.test(m.MS名))
    .sort((a, b) => C2.msLevel(b.MS名) - C2.msLevel(a.MS名))[0];
  const myHp = Math.round(C2.calcStats(defMs, [], 6, '拡張スキル無し',
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'parts.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fullst.json'), 'utf8')),
    null, 'normal').total.hp || 0);
  ok('적힌 HP 가 그 기체의 실제 HP 다', eff === myHp, { 적힌값: eff, 실제HP: myHp, 기체: defMs.MS名 });
  ok('실효 HP 는 툴팁에 남아 있다', /실효 HP [\d,]+/.test(hpInfo.title), hpInfo.title.slice(0, 60));
  // 내구 칸 — 속성 셋이 다 있어야 한다 (HP 는 기체 줄에 따로 적힌다)
  ok('내구 칸에 실탄·빔·격투가 다 있다',
    hpInfo.head.length === 3 && /실탄/.test(hpInfo.head[0]) && /빔/.test(hpInfo.head[1])
    && /격투/.test(hpInfo.head[2]), hpInfo.head);
  /* 칸의 숫자는 **게임 공식 내성 보정**(두 자리)이다 — 사용자 요청 2026-10-15. 기대값은 core 로 따로 센다.
     예전처럼 실효 HP(24,572 같은 다섯 자리)를 글로 적으면 운다. */
  {
    const tot = C2.calcStats(defMs, [], 6, '拡張スキル無し',
      JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'parts.json'), 'utf8')),
      JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fullst.json'), 'utf8')), null, 'normal').total;
    const want = [tot.armorRange, tot.armorBeam, tot.armorMelee].map(v => Math.round(v || 0));
    const got = hpInfo.head.map(t => Number((t.match(/내(?:실탄|빔|격투)\s*(\d+)/) || [])[1]));
    ok('내성 칸 숫자가 게임 공식 내성 보정이다 (' + want.join(' / ') + ')',
      JSON.stringify(got) === JSON.stringify(want), { 화면: hpInfo.head, 기대: want });
    ok('내성 칸 글에 실효 HP(네 자리 이상)를 적지 않는다', hpInfo.head.every(t => !/\d{1,3},\d{3}/.test(t)), hpInfo.head);
  }
  let left = eff, n = 0;
  for (const s of steps) { left -= s.d; n++; if (left <= 0) break; }
  const shown = Number((rr.kill.v.match(/\d+/) || [])[0]);
  ok('적어 준 피해를 더하면 적어 준 발수가 된다', n === shown && left <= 0, { 더해서: n, 화면: shown, 남은: left });
  // 첫 발은 HP 100% 라 가장 센 구간이어야 한다
  ok('첫 발이 HP 100% 구간이다', steps[0] && steps[0].pct === 100, steps[0]);
  ok('첫 발 피해가 그 뒤보다 크다', steps[0] && steps[1] && steps[0].d > steps[1].d, steps.slice(0, 2));
  // 보너스를 무시했을 때(나눗셈)보다 적게 맞아야 한다 — 그래야 고친 뜻이 있다
  // steps 가 비면(구간 셈이 꺼진 경우) 여기서 죽지 않게 — 죽으면 뒤 검사가 안 돈다
  const last = steps.length ? steps[steps.length - 1].d : 0;
  const flat = last > 0 ? Math.ceil(eff / last) : null;
  ok('보너스를 무시한 셈보다 발수가 적다', flat != null && shown < flat, { 지금: shown, 무시하면: flat });
  // 버티기 목표가 「1발 × N」 곱셈이 아니다
  ok('버티기 목표가 누적으로 적힌다', /누적/.test(rr.goal) && !/1발/.test(rr.goal), rr.goal);

  // ── 못 세는 쪽 — 트라이퍼니셔 등
  // weapons.json 의 키는 위키 페이지 번호다 — msData 의 wiki_url 끝자리와 맞춘다
  const pageOf = m => (String(m.wiki_url || '').match(/\/pages\/(\d+)\.html/) || [])[1];
  const unkKeys = new Set(unknown.map(u => u.key));
  const unkMs = msData.find(m => unkKeys.has(pageOf(m)));
  ok('못 세는 무장을 가진 기체를 찾았다', !!unkMs, unkMs && unkMs.MS名);
  if (unkMs) {
    const pe2 = await pickEnemy(unkMs.MS名);
    ok('그 기체를 골랐다', pe2.ok, pe2);
    await sleep(1300);
    const uk = unknown.find(u => u.key === pageOf(unkMs));
    const koW = uk ? uk.name : '';
    /* HP 조건이 달린 무장을 이름으로 못 찾을 수 있으니, 하나씩 골라 보고 ※ 줄이 뜨는 것을 찾는다. */
    let found = null;
    for (const nm of await foeWeapons()) {
      if (!(await pickWeaponExact(nm))) continue;
      const r = await readResult();
      if (r.unmod) { found = r; break; }
    }
    ok('못 세는 무장을 고르면 ※ 줄이 뜬다', !!found, { ms: unkMs.MS名, 무장: koW });
    if (found) {
      ok('※ 줄이 무엇을 왜 안 넣었는지 적는다',
        /대상 HP/.test(found.unmod.v) && /셈에 넣지 않습니다/.test(found.unmod.note), found.unmod);
      ok('※ 줄이 어느 쪽으로 틀리는지도 적는다', /더 아픕니다/.test(found.unmod.note), found.unmod.note);
    }
  }

  ok('페이지 오류 없음', errs.length === 0, errs.slice(0, 3));
  await br.close();
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
