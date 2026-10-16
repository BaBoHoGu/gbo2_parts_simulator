// 방어 무시·감소(상대 내성 감소 · 실드 무시 · 완충재 무시)가 **조건대로** 걸리는가 — 실측.
//   node tools/armorignore_check.js
//
// ■ 왜 — 2026-10-16 사용자: 「갓 건담 명경지수를 보면 내격 일부 무시가 있는데 반영이 안 되는 듯함 —
//   방어력 무시가 있는 무장들을 한 번 더 검사할 것」. 전수 감사에서 나온 것:
//   · 상대 내성**만** 깎는 스킬(명경지수 · TYPE C.A-Ⅲ · 롱 레인지 어댑터)은 스탯 축이 없어 대결 칩 목록에서
//     빠졌다 — 셈은 준비돼 있었는데 켤 단추가 없었다.
//   · 추격 격투 보조 프로그램(LV3)은 범위 표시가 수치 줄 밖(「格闘兵装を当てると」)에 있어 셈에서 빠졌다.
//   · 무장 원문의 「スキル発動中、…」 — 내성 감소·실드 무시는 조건을 안 보고 **늘** 걸었고,
//     완충재 무시는 「어느 스킬인지 모른다」 며 **아예** 뺐다. 「集束時」 내성 감소도 늘 걸었다.
//     그 「스킬」 은 기체마다 「対応兵装の性能変化」 라고 적힌 스킬이다(8기 전수).
//   · 「シールド貫通効果有」(대상 표기 없음) 꼴은 실드 무시로 못 읽었다.
// ■ 자 — 같은 무장을 **조건만 바꿔** 두 번 잰다(끔/켬). 한쪽만 재면 「늘 걸림」 도 통과한다.
'use strict';
const GBO2Browser = require('./lib/browser.js');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = require('./lib/duelgate.js');

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

(async () => {
  const br = await GBO2Browser.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--hide-scrollbars'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1500, height: 1300, deviceScaleFactor: 1 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(2400);

  const m = o => G.measure(pg, { foe: 'ジム_LV1', ...o });
  const chips = () => pg.evaluate(() => [...document.querySelectorAll('.duel-side[data-side="L"] .ds-chip:not(.def)')]
    .map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  const conds = () => pg.evaluate(() => [...document.querySelectorAll('.dc-card[data-dir="LR"] .fx-cond')]
    .map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), on: e.classList.contains('on') })));

  /* ① 상대 내성만 깎는 스킬 — 칩이 있고, 켜면 깎인다 */
  for (const [nm, me, buff, ko, pct, melee] of [
    ['갓 건담 명경지수', 'ゴッドガンダム_LV2', '明鏡止水', '내격투', 10, true],
    ['F90 MZ OS「TYPE C.A-Ⅲ」', 'F90［MZ仕様］_LV1', 'OS「TYPE C.A-Ⅲ」', '내격투', 30, true],
    ['V2 롱 레인지 어댑터', 'V2ガンダム_LV1', 'ロングレンジ・アダプター', '내빔', 15, false],
  ]) {
    const off = await m({ me, melee });
    const cs = await chips();
    const on = await m({ me, melee, buffs: [buff] });
    ok(nm + ' — 대결 칩이 있다(「적 ' + ko + ' −' + pct + '%」)', cs.some(t => t.includes('적 ' + ko + ' −' + pct + '%')), cs);
    ok(nm + ' — 끄면 0 · 켜면 ' + pct + '%', off.스킬깎기 === 0 && on.스킬깎기 === pct, { off: off.스킬깎기, on: on.스킬깎기 });
  }
  /* ② 범위가 수치 줄 밖에 적힌 스킬 — 추격 격투 보조 프로그램 LV3 */
  {
    const on = await m({ me: 'トールギスⅢ_LV1', melee: true, buffs: ['追撃格闘補助プログラム'] });
    const cs = await chips();
    ok('톨기스Ⅲ 추격 격투 보조(LV3) — 칩에 「적 내격투 −10%」 꼬리표, 켜면 10%',
      cs.some(t => /추격 격투 보조/.test(t) && t.includes('적 내격투 −10%')) && on.스킬깎기 === 10, { cs, on: on.스킬깎기 });
  }
  /* ③ 동작 한정(태클 · 카운터 · 헤비 어택)은 무장 목록에 없다 — 칩으로 새면 사벨에 붙는다 */
  for (const [me, kw] of [['ラムズゴック_LV1', '블레이드 태클'], ['クシャトリヤ・リペアード_LV1', '카운터'], ['プロトタイプΖΖガンダム_LV1', '바이오 센서']]) {
    await m({ me, melee: true });
    const cs = await chips();
    ok(me.replace(/_LV\d$/, '') + ' — 동작 전용 「' + kw + '」 는 내성 감소 칩으로 안 뜬다', !cs.some(t => /적 내/.test(t)), cs);
  }
  /* ④ 무장 원문의 「スキル発動中、」 — 무장 성능 변화 스킬을 켰을 때만 */
  {
    const off = await m({ me: 'クロスボーン・ガンダムX3_LV1', melee: true, weapon: 'ムラマサ・ブラスター$' });
    const cOff = await conds();
    const on = await m({ me: 'クロスボーン・ガンダムX3_LV1', melee: true, weapon: 'ムラマサ・ブラスター$', buffs: ['最大出力（T）'] });
    ok('X3 무라마사 블래스터 — 최대 출력(T) 끄면 0 · 켜면 30%', off.무장깎기 === 0 && on.무장깎기 === 30, { off: off.무장깎기, on: on.무장깎기 });
    ok('X3 무라마사 블래스터 — 끈 동안 계산식에 「스킬 발동 중일 때만」 을 적는다', cOff.some(c => !c.on && /스킬 발동 중일 때만/.test(c.t)), cOff);
  }
  {
    const off = await m({ me: 'スサノオ_LV1', weapon: 'Bチャクラム', foe: 'ドム_LV1', defs: ['脚部特殊緩衝材'] });
    const on = await m({ me: 'スサノオ_LV1', weapon: 'Bチャクラム', foe: 'ドム_LV1', defs: ['脚部特殊緩衝材'], form: 'transform' });
    ok('스사노오 B 차크람 — 완충재 무시는 트랜잠(모드) 때만', off.완충재무시 && !off.완충재무시.적용 && on.완충재무시 && on.완충재무시.적용 && on.한발 > off.한발,
      { off: off.완충재무시, on: on.완충재무시, 한발: [off.한발, on.한발] });
  }
  /* ⑤ 「集束時」 내성 감소 — 집속했을 때만 */
  {
    const nc = await m({ me: 'ダギ・イルス_LV2', weapon: '3連装拡散ビーム砲' });
    ok('다기 이루스 3연장 확산 빔포 — 논차지에서는 내빔 감소를 안 건다', nc.모드 === 'nc' ? nc.무장깎기 === 0 : true, { 모드: nc.모드, 무장깎기: nc.무장깎기 });
  }
  /* ⑥ 조건 없는 무장 내성 감소는 그대로 늘 */
  {
    const r = await m({ me: 'F91_LV1', weapon: 'ヴェスバー.*照射' });
    ok('F91 베스바［조사］ — 조건 없는 내빔 −30% 는 늘 건다', r.무장깎기 === 30, r.무장깎기);
  }
  /* ⑦ 실드 무시 — 「シールド貫通効果有」(대상 표기 없음) 꼴 */
  {
    const r = await pg.evaluate(() => {
      const all = [];
      for (const g of Object.values(window.GBO2_WEAPONS || {})) for (const w of (g && g.weapons) || []) all.push(w);
      const w = all.find(x => /ネロ用フラッシュグレネード/.test(x.name));
      return w ? (w.info && w.info['備考']) : null;
    });
    ok('섬광탄(「シールド貫通効果有」) 원문을 찾았다', !!r, r);
    const src = fs.readFileSync(path.join(ROOT, 'src', 'ui.js'), 'utf8');
    const re = eval(src.match(/const SHIELD_IGNORE_RE = (\/.*\/[a-z]*);/)[1]);
    ok('실드 무시 판정이 「シールド貫通効果有」 를 읽는다 · 「…無視を無効化」 는 판정 뒤에서 거른다',
      re.test('シールド貫通効果有') && re.test('スキル発動中、シールドHP無視') && re.test('攻撃対象のシールドHP無視'));
  }
  ok('페이지 오류 없음', !errs.length, errs);
  await br.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
