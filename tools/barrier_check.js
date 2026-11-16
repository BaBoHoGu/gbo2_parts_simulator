// 방어 판넬 배리어(핀 판넬［防御］ · 사이코 플레이트［防御］ · A·아머 DE［防御］ · 실드 판넬 x3［防御］)를 제대로 세는가.
//   node tools/barrier_check.js
//
// ■ 왜 — 2026-11-16 사용자: 「G도어즈, V건담 HWS 같은 유형은 어떻게 할 것인가」 → 「방어 판넬 배리어 조사 및 정리」.
//   대결의 「🛡 실드로 막음」 은 실드 무장(シールドHP)만 찾아서, HP 2,250~10,000 짜리 배리어 12종이
//   계산 어디에도 없었다. 위키 해설 12쪽을 전수로 읽어 규칙을 세웠다(core.barrierOf · barrierShots).
//
// ■ 자 — ① 데이터: 備考에서 **스스로** 배리어를 골라, 덧입력 표(막는 범위)에 빠진 것이 없는지.
//         새 배리어 무장이 생겼는데 표에 없으면 여기서 실패한다(조용히 셈 밖으로 빠지지 않게).
//        ② 셈: 손으로 계산한 값과 대조 — 넘친 몫 버림 · 연속 히트는 깨진 뒤 본체로 · 동시 발사는 통째로 ·
//         내성(실효 HP 자) · 문턱 149/150 · 1299/1300 경계 · 격투엔 사격 전용 배리어가 0발.
//        ③ 화면: 대결에서 단추가 **진짜 마우스로** 눌리고(가려지지 않고), 카드의 수가 셈과 같은지.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const C = require(path.join(ROOT, 'src', 'core.js'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label
    + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};

/* ── ① 데이터 ─────────────────────────────────────────────────────── */
const W = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'weapons.json'), 'utf8'));
const OV = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'barrier.override.json'), 'utf8'));
// 앱의 정규식을 빌리지 않고 넓게 고른다 — 「バリア」 + HP 또는 「弾数1発消費」 를 말하는 무장
const found = [];
for (const [id, pg] of Object.entries(W)) for (const w of pg.weapons || []) {
  const note = String((w.info && w.info['備考']) || '');
  if (/バリアのHP|ダメージを受けた時、弾数1発消費/.test(note)) found.push({ id, w, key: id + '|' + w.name });
}
ok('배리어 꼴 무장을 원문에서 15종 이상 찾는다 (전수 2026-11-16 — 배리어 14 · 배리어 아님 1)', found.length >= 15, found.length);
const missing = found.filter(f => !OV[f.key]).map(f => f.key);
ok('찾은 배리어가 모두 덧입력 표에 있다 — 없으면 막는 범위를 몰라 셈 밖으로 빠진다', !missing.length, missing);
const stale = Object.keys(OV).filter(k => !k.startsWith('_') && !found.some(f => f.key === k));
ok('덧입력 표의 항목이 모두 실제 무장을 가리킨다', !stale.length, stale);
ok('덧입력 항목마다 근거(src)와 막는 범위(shoot|all)가 있다',
  Object.entries(OV).filter(([k]) => !k.startsWith('_')).every(([, v]) => v.src && (v.none === true || /^(shoot|all)$/.test(v.blocks))));

// 빌드가 하는 일(w.barrier 붙이기)을 여기서 그대로 해 보고 core 가 읽는지 본다
const B = {};
for (const f of found) {
  const v = OV[f.key];
  const w = v ? { ...f.w, barrier: v.none ? { none: true } : { blocks: v.blocks, cut: v.cut || 0, front: !!v.front } } : f.w;
  B[f.key] = C.barrierOf(w);
}
const real = found.filter(f => !(OV[f.key] && OV[f.key].none));
ok('core.barrierOf 가 배리어 14종을 모두 판정한다 (unknown 없음)', real.length >= 14 && real.every(f => B[f.key] && !B[f.key].unknown),
  real.filter(f => !B[f.key] || B[f.key].unknown).map(f => f.key));
ok('「배리어 아님」(FEGCP B·실드 — 부위 실드) 은 null — 셈에서 빠진다', B['7714|FEGCP用B・シールドx2'] === null);
ok('V2 어설트 버스터 — HP 「?000」 은 hpUnknown · 정면 · [防御] 전부 / [広域防御] 사격만',
  (x => x && x.hpUnknown && x.front && x.blocks === 'all')(B['7792|バリア・ビット展開［防御］'])
  && (x => x && x.hpUnknown && x.front && x.blocks === 'shoot')(B['7792|バリア・ビット展開［広域防御］']));
ok('HP 미상 배리어는 발수를 세지 않는다(지어내지 않음)', C.barrierShots({ kind: 'hp', hp: null, hpUnknown: true }, { blocked: true, bh: 1000, scale: 1, n: 1, hit: 1000, per: 1000, eff: 20000 }).total === null);
const g = k => B[k] || {};
ok('ν건담 — HP 3000 · 사격만 · 배리어 피해 −10%(위키 이력)',
  g('3357|フィン・ファンネル［防御］').hp === 3000 && g('3357|フィン・ファンネル［防御］').blocks === 'shoot'
  && g('3357|フィン・ファンネル［防御］').cut === 10 && g('3357|フィン・ファンネル［防御］').cutFrom === 'wiki', g('3357|フィン・ファンネル［防御］'));
ok('ν건담[HWS] — 문턱 150 · 탄 5 · 사격만', (x => x.kind === 'thr' && x.thr === 150 && x.ammo === 5 && x.blocks === 'shoot')(g('5681|フィン・ファンネル［防御］')), g('5681|フィン・ファンネル［防御］'));
ok('G·도어즈 — 문턱 1300 · 탄 1 · 전부 · 태클에 해제', (x => x.kind === 'thr' && x.thr === 1300 && x.ammo === 1 && x.blocks === 'all' && x.tackleBreaks)(g('6427|サイコプレート［防御］')), g('6427|サイコプレート［防御］'));
ok('페넥스 — 통상/변신 두 벌 · −10% 는 備考에서', g('4605|アームド・アーマーDE［防御］').form === 'normal'
  && g('4605|A・アーマーDE［防御］（変身）').form === 'transform' && g('4605|アームド・アーマーDE［防御］').cutFrom === 'note');
ok('유니콘[각성] — HP 10000 · 전부', g('6350|シールド・ファンネルx3［防御］').hp === 10000 && g('6350|シールド・ファンネルx3［防御］').blocks === 'all');
ok('덧입력이 없으면 unknown — 셈하지 않는다', C.barrierOf({ info: { '備考': 'バリアのHP：3000' } }).unknown === true);
ok('배리어가 아닌 무장은 null', C.barrierOf({ info: { '備考': '移動射撃可 / よろけ値：0%' } }) === null);

/* ── ② 셈 (손 계산) ───────────────────────────────────────────────── */
const hpB = { kind: 'hp', hp: 3000 }, thr13 = { kind: 'thr', thr: 1300, ammo: 1 }, thr15 = { kind: 'thr', thr: 150, ammo: 5 };
const base = { blocked: true, scale: 1, n: 1, hit: 1000, per: 1000, eff: 20000, volley: false };
let r = C.barrierShots(hpB, { ...base, bh: 1000 });
ok('HP 3000 ÷ 1000 = 3발 + 본체 20발 = 23발', r.triggers === 3 && r.body === 20 && r.total === 23, r);
r = C.barrierShots(hpB, { ...base, bh: 1200, hit: 1200, per: 1200 });
ok('넘친 몫은 버린다 — 1200 x3 (3600 > 3000) 뒤 본체 17발 = 20발', r.triggers === 3 && r.leftover === 0 && r.total === 20, r);
r = C.barrierShots(hpB, { ...base, bh: 1000, n: 4, per: 4000, eff: 16500 });
ok('연속 히트(4히트) — 3히트로 깨지고 남은 1히트는 본체로: 1 + ⌈15500/4000⌉ = 5발', r.triggers === 1 && r.leftover === 1 && r.total === 5, r);
r = C.barrierShots(hpB, { ...base, bh: 1000, n: 4, per: 4000, eff: 16500, volley: true });
ok('동시 발사(4발) — 한 공격째로 막아 남는 히트 없음: 1 + ⌈16500/4000⌉ = 6발', r.triggers === 1 && r.leftover === 0 && r.total === 6, r);
r = C.barrierShots(hpB, { ...base, bh: 1000, scale: 1.25, eff: 25000 });
ok('내성도 배리어에 — 실효 1.25 배면 3000 HP 가 3750 → 4발', r.triggers === 4, r);
r = C.barrierShots(thr13, { ...base, bh: 1299 });
ok('문턱 1300 — 1299 는 무한 무효', r.inf === true && r.total === null, r);
r = C.barrierShots(thr13, { ...base, bh: 1300 });
ok('문턱 1300 — 1300 이면 1발에 깨지고 본체 20발 = 21발', !r.inf && r.triggers === 1 && r.total === 21, r);
r = C.barrierShots(thr13, { ...base, bh: 1040, scale: 0.8 });
ok('문턱은 HP 로 들어가는 값으로 잰다 — 1040 ÷ 0.8 = 1300 HP → 깨짐', !r.inf && r.bhHp === 1300, r);
ok('문턱 150 — 149 무효 · 150 이면 탄 5발', C.barrierShots(thr15, { ...base, bh: 149 }).inf === true
  && C.barrierShots(thr15, { ...base, bh: 150 }).triggers === 5);
r = C.barrierShots(hpB, { ...base, blocked: false, bh: 1000 });
ok('막지 못하는 공격은 배리어 0발 · 본체 발수 그대로', r.triggers === 0 && r.total === 20, r);
r = C.barrierShots(hpB, { ...base, bh: 300, hit: 300, n: 18, per: 5400, unit: 6 });
ok('「6発同時発射 x 3回攻撃」 — 6발 묶음 둘째에서 깨지고 셋째 묶음 6히트는 본체로 (was 18히트 통째로 막음)',
  r.triggers === 1 && r.absorbed === 12 && r.leftover === 6, r);
r = C.barrierShots(thr15, { ...base, bh: 200, n: 9, per: 1800, unit: 9 });
ok('문턱형에 9발 동시 발사 — 탄 5발이 떨어져도 그 묶음 9히트는 통째로 막는다', r.triggers === 1 && r.absorbed === 9 && r.leftover === 0, r);
const sh = { blocks: 'shoot' }, al = { blocks: 'all', tackleBreaks: true };
ok('사격 전용 배리어 — 사격은 막고 격투·격투 속성 사격은 못 막는다',
  C.barrierBlocks(sh, { melee: false, attr: 'beam' }) && !C.barrierBlocks(sh, { melee: true, attr: 'melee' })
  && !C.barrierBlocks(sh, { melee: false, attr: 'melee' }));
ok('전부 막는 배리어 — 격투도 막고, 태클(표기 있는 것)은 못 막는다',
  C.barrierBlocks(al, { melee: true, attr: 'melee' }) && !C.barrierBlocks(al, { melee: true, attr: 'melee', tackle: true }));
ok('unknown 배리어는 아무것도 막지 않는다(셈 밖)', !C.barrierBlocks({ unknown: true, blocks: 'all' }, { melee: false, attr: 'beam' }));

/* ── ③ 화면 ───────────────────────────────────────────────────────── */
(async () => {
  let findChrome;
  try { require('puppeteer-core'); ({ findChrome } = require('./lib/wiki_fetch.js')); }
  catch { console.log('  SKIP 화면 — puppeteer-core 없음'); return done(); }
  const CHROME = findChrome();
  const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
  if (!CHROME || !fs.existsSync(FILE)) { console.log('  SKIP 화면 — Chrome/dist 없음'); return done(); }
  const GBO2Browser = require('./lib/browser.js');
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    const pg = await br.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
    await pg.setViewport({ width: 1400, height: 900 });
    await pg.goto('file:///' + FILE.split(path.sep).join('/').split(' ').join('%20'), { waitUntil: 'load', timeout: 180000 });
    await new Promise(r => setTimeout(r, 3200));

    // 공격: 사자비 · 맞는 쪽: 지정 기체. 첫 사격(위력 있는) 무장을 고른다.
    const setup = (foeName, wantMelee) => pg.evaluate((foeName, wantMelee) => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state;
      const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
      const me = by('サザビー'), foe = by(foeName);
      if (!me || !foe) return { err: 'no ms' };
      window.GBO2Duel.open();
      S.L.ms = me; S.R.ms = foe; S.L.parts = []; S.R.parts = []; S.L.wKey = null;
      S.L.buffs.clear(); S.R.buffs.clear(); S.R.defs.clear(); S.R.barrierOn = false; S.R.barrierKey = null; S.R.shieldOn = false; S.R.form = 'normal';
      window.GBO2Duel.use({});
      for (const e of document.querySelectorAll('.duel-side[data-side="L"] .ds-w')) {
        e.click();
        const a = window.GBO2Duel.attack(S.L, S.R);
        if (a && !!a.wp.melee === wantMelee && a.power > 0) return { w: a.wp.w.name };
      }
      return { err: 'no weapon' };
    }, foeName, wantMelee);
    const btnAt = () => pg.evaluate(() => {
      const b = [...document.querySelectorAll('.duel-side[data-side="R"] .d-btn')].find(x => /배리어로 막음/.test(x.textContent));
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, hit: !!top && (top === b || b.contains(top)), text: b.textContent };
    });
    const card = () => pg.evaluate(() => {
      const S = window.GBO2Duel.state, a = window.GBO2Duel.attack(S.L, S.R);
      const el = document.querySelector('.dc-barrier');
      return { on: S.R.barrierOn, bar: a && a.barrier, shots: a && a.shots, eff: a && a.eff, hp: a && a.hp,
        boosted: a && a.boosted, n: a && a.n, volley: a && a.barrier && a.barrier.volley, text: el ? el.textContent : null };
    });

    let s = await setup('νガンダム', false);
    ok('대결 준비 — 사자비 → ν건담 (사격)', !s.err, s);
    let at = await btnAt();
    ok('ν건담 쪽에 「🌀 배리어로 막음」 단추가 보인다 · 가려지지 않았다', !!at && at.hit, at);
    if (at) await pg.mouse.click(at.x, at.y);
    await new Promise(r => setTimeout(r, 300));
    let c = await card();
    ok('진짜 마우스로 누르면 켜진다', c.on === true, c.on);
    // 셈과 대조 — 화면이 쓴 boosted 에서 손으로 다시 센다(n=1 · 비동시 발사일 때)
    const bh = Math.floor(c.boosted * 0.9), bEff = 3000 * c.eff / c.hp;
    const expect = c.n === 1 ? Math.ceil(bEff / bh) : null;
    ok('카드의 배리어 발수 = ⌈3000 × 실효/HP ÷ ⌊위력 × 0.9⌋⌉' + (expect != null ? ' (' + expect + '발)' : ''),
      !!c.bar && c.bar.blocked && (expect == null || c.bar.triggers === expect), { bar: c.bar && c.bar.triggers, expect, n: c.n });
    ok('합계 = 배리어 발수 + 본체 발수 (넘친 몫 버림)', !!c.bar && c.bar.total === c.bar.triggers + c.bar.body, c.bar);
    ok('카드에 「N발 → 합계 M발」 과 셈 밖 안내가 적힌다',
      !!c.text && c.text.includes(c.bar.triggers + '발 → 합계 ' + c.bar.total + '발') && /원문에 없음/.test(c.text), c.text);
    ok('배리어 피해 −10% 를 적는다 (공식 「방어 보정 상승」 · 수치는 위키)', !!c.text && /−10%/.test(c.text) && /수치는 위키/.test(c.text), c.text);

    s = await setup('νガンダム', true);
    await pg.evaluate(() => { window.GBO2Duel.state.R.barrierOn = true; window.GBO2Duel.use({}); });
    c = await card();
    ok('사격 전용 배리어에 격투 — 0발 · 본체 발수 그대로', !!c.bar && !c.bar.blocked && c.bar.triggers === 0
      && /격투에는 효과 없음/.test(c.text || ''), { s, bar: c.bar, text: c.text });

    s = await setup('G・ドアーズ', false);
    at = await btnAt();
    ok('G·도어즈 단추는 문턱으로 적힌다 (1,300 이상만 탄 소모)', !!at && /1,300 이상만 탄 소모/.test(at.text), at);
    if (at) await pg.mouse.click(at.x, at.y);
    await new Promise(r => setTimeout(r, 300));
    c = await card();
    const hpHit = c.bar ? c.bar.bhHp : null;
    ok('G·도어즈 — 한 히트 HP 가 1300 미만이면 「무효」, 이상이면 1발', !!c.bar && (hpHit < 1300 ? c.bar.inf === true && /무효/.test(c.text)
      : c.bar.triggers === 1), { hpHit, bar: c.bar });

    /* 승패 줄도 배리어 합계로 견준다 — 카드 아래 「합계」 와 결론이 갈리면 안 된다(was 본체 발수만) */
    s = await setup('νガンダム', false);
    await pg.evaluate(() => {
      const S = window.GBO2Duel.state, D = window.GBO2Duel;
      // 승패 줄은 양쪽 무장이 다 골라져야 나온다 — 오른쪽도 사격 무장 하나
      const rw = D.weaponsOf(S.R).find(w => !w.melee && w.power > 0);
      if (rw) S.R.wKey = rw.key;
      S.R.barrierOn = true; D.use({});
    });
    const vd = await pg.evaluate(() => {
      const S = window.GBO2Duel.state, a = window.GBO2Duel.attack(S.L, S.R);
      const v = document.querySelector('.dc-verdict');
      return { total: a && a.barrier && a.barrier.total, text: v ? v.textContent : null };
    });
    ok('승패 줄이 배리어 합계를 쓴다 (「나 N발(배리어 포함)」)', !!vd.text && vd.total != null
      && vd.text.includes('나 ' + vd.total + '발(배리어 포함)'), vd);

    /* 판넬 挟撃(6발 x 3회) — 대결이 묶음 크기 6 을 넘긴다 */
    const fun = await pg.evaluate(() => {
      const S = window.GBO2Duel.state, D = window.GBO2Duel;
      const wp = D.weaponsOf(S.L).find(w => /ファンネルx6［挟撃］/.test(w.w.name));
      if (!wp) return null;
      S.L.wKey = wp.key; const a = D.attack(S.L, S.R);
      return { n: a.n, unit: a.barrier && a.barrier.unit };
    });
    ok('「6発同時発射 x 3回攻撃」 무장은 한 공격 = 6히트로 막는다', !!fun && fun.n === 18 && fun.unit === 6, fun);

    /* 격투 속성 사격(문 건담 바타플라이 엣지) → HWS: 「깬다」 가 아니라 「통과」 */
    const bf = await pg.evaluate(() => {
      const G = window.GBO2_DATA, S = window.GBO2Duel.state, D = window.GBO2Duel;
      const by = n => G.msData.filter(m => m.MS名.replace(/_LV\d+$/, '') === n).pop();
      S.L.ms = by('ムーンガンダム'); S.R.ms = by('νガンダム［HWS装備］'); S.L.parts = []; S.R.parts = [];
      S.R.barrierOn = true; S.R.barrierKey = null;
      const wp = D.weaponsOf(S.L).find(w => w.w.type === 'shooting' && w.attr === 'melee');   // 바타플라이 엣지
      if (!wp) return null;
      S.L.wKey = wp.key; D.use({});
      const el = document.querySelector('.dc-barrier');
      return { w: wp.w.name, text: el ? el.textContent : null };
    });
    ok('격투 속성 사격에는 「격투 속성 공격은 막지 못합니다」 (was 「첫 격투가 배리어를 깨고」)',
      !!bf && /격투 속성 공격은 막지 못합니다/.test(bf.text || '') && !/첫 격투가/.test(bf.text || ''), bf);

    /* V2 어설트 버스터 — 배리어 둘 다 고를 수 있다(was ［防御］ 만) */
    s = await setup('V2アサルトバスターガンダム', false);
    const v2 = await pg.evaluate(() => [...document.querySelectorAll('.duel-side[data-side="R"] .d-btn')]
      .filter(x => /배리어로 막음/.test(x.textContent)).map(x => x.textContent));
    ok('V2 어설트 버스터는 배리어 단추가 둘 (［방어］ · ［광역 방어］)', v2.length === 2, v2);
    const v2at = await pg.evaluate(() => {
      const b = [...document.querySelectorAll('.duel-side[data-side="R"] .d-btn')].filter(x => /배리어로 막음/.test(x.textContent))[1];
      if (!b) return null;
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, hit: !!top && (top === b || b.contains(top)) };
    });
    if (v2at && v2at.hit) await pg.mouse.click(v2at.x, v2at.y);
    await new Promise(r => setTimeout(r, 300));
    const v2c = await card();
    ok('둘째 단추를 진짜 마우스로 누르면 ［광역 방어］ 가 켜진다 (사격만 · 정면)', !!v2at && v2at.hit && !!v2c.bar
      && /広域防御|광역/.test(v2c.bar.ja + v2c.bar.name) && v2c.bar.blocks === 'shoot' && v2c.bar.front, { v2at, bar: v2c.bar && { ja: v2c.bar.ja, blocks: v2c.bar.blocks } });

    s = await setup('サザビー', false);
    at = await btnAt();
    ok('배리어 없는 기체(사자비)에는 단추가 없다', at === null, at);

    // 무장 표 — ν건담 파츠 화면의 배리어 줄
    await pg.evaluate(() => window.GBO2Duel.close());
    await pg.evaluate(() => { const i = document.querySelector('#msQuery'); i.value = 'ν 건담'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await new Promise(r => setTimeout(r, 800));
    await pg.evaluate(() => {
      const cards = [...document.querySelectorAll('.ms-card')];
      (cards.find(x => /^[☆★\s]*ν 건담 LV/.test(x.textContent)) || cards[0]).click();
    });
    await new Promise(r => setTimeout(r, 1100));
    await pg.evaluate(() => { const g = document.querySelector('#infoGo'); if (g) g.click(); });
    await new Promise(r => setTimeout(r, 1200));
    const tbl = await pg.evaluate(() => [...document.querySelectorAll('.w-barrier')].map(e => e.textContent));
    ok('무장 표에 배리어 요약이 붙는다 (배리어 HP 3,000 · 사격만)', tbl.some(t => /배리어 HP 3,000/.test(t) && /사격만/.test(t)), tbl);
    ok('화면 오류 없음', !errs.length, errs);
  } finally { await br.close(); }
  done();
})();

function done() {
  console.log('\n' + (fail ? 'FAIL' : 'OK') + '  배리어 ' + pass + '/' + (pass + fail));
  process.exit(fail ? 1 : 0);
}
