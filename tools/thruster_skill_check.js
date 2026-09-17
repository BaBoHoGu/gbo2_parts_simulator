// 스러스터 **스킬** 파싱을 전수로 훑고, 손으로 확인한 표와 대조한다.
//
//   node tools/thruster_skill_check.js            대조만
//   node tools/thruster_skill_check.js --list     읽어 낸 것 전부 출력(원문과 같이)
//
// 왜 필요한가 — 이 파서가 어려운 것은 수치가 아니라 **언제 걸리는가**다.
// 대부분이 상황 한정(공중·태클·착지캔슬·발동중)인데, 상시로 잘못 두면 아무도 모르게
// 부스트 지속이 좋게 나온다. 그래서 「상시로 잡힌 것」을 통째로 못 박아 둔다 —
// 여기 없는 이름이 상시로 올라오면 그 순간 실패한다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'dist', 'gbo2-simulator.html'), 'utf8');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }

/* 손으로 원문을 읽고 확인한 「상시」 목록.
   이름 → 그 스킬이 상시로 거는 효과들. LV 는 기체마다 다르므로 이름으로만 못 박는다.
   근거(원문)는 주석에 같이 둔다 — 나중에 문구가 바뀌면 여기부터 다시 읽어야 한다. */
const ALWAYS = {
  normal: {
    // 「高速移動とジャンプを使用した時、スラスターの初期消費量を N% 軽減する」
    '廃熱効率適正化': ['cutInit'],
    // 「宇宙において、高速移動開始時のスラスター消費量を 15% 軽減する」 — 우주에서만
    '反動姿勢制御システム': ['cutInit']
  },
  transform: {
    '廃熱効率適正化': ['cutInit'],
    '反動姿勢制御システム': ['cutInit'],
    // 変形時 모드에만 있는 스킬이다 — 통상 상태에서는 아예 안 걸린다.
    // 「高速移動開始時のスラスター消費量と変形時から通常時へ変形するときの…を 60% 軽減」
    // 「移動中のスラスター消費量を 25% 軽減する」
    '変形機構最適化制御': ['cutInit', 'cutRate']
  }
};

const FILE = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LIST = process.argv.includes('--list');

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const pg = await br.newPage();
  await pg.goto(FILE, { waitUntil: 'load', timeout: 180000 });
  await sleep(4000);

  // 앱 안에서 전 기체를 훑는다 — 파서가 앱 것과 같아야 뜻이 있으므로 복사하지 않는다.
  const rows = await pg.evaluate(() => {
    const U = window.GBO2UiTest;
    if (!U) return null;
    const out = [];
    // 통상·변형 두 형태를 다 본다 — 変形機構最適化制御 는 変形時 모드에만 있어
    // 통상만 훑으면 그 스킬이 있는지조차 모른 채 지나간다.
    for (const form of ['normal', 'transform'])
      for (const m of U.msData())
        for (const s of U.thrusterSkillsOf(m, U.msLevel(m), form))
          out.push({ form, ms: m.MS名, name: s.name, ko: s.ko, lv: s.lv, key: s.key, v: s.v,
            cond: s.cond, env: s.env, seg: s.seg });
    return out;
  });
  if (!rows) { console.log('FAIL  앱이 thrusterSkillsOf 를 내보내지 않습니다 (GBO2UiTest)'); await br.close(); process.exit(1); }

  /* ── 「量」이 없는 표기 ──
     설명은 「継続消費量 －70%」로도 「継続消費 －70%」로도 적힌다. 파서가 量 을 요구해
     **79 곳(33 종)** 이 통째로 새고 있었다 — 사용자가 V2 의 「スラスター継続消費 －70%」를
     보고 「소비 감소 아니냐」고 짚어 드러났다.
     값이 안 잡히면 경감을 못 읽어 부스트 지속이 **짧게** 나오고 아무도 모른다.
     아는 기체를 값까지 박아 놓고 본다. 「持続」·OH 의 「－N%」 꼴도 같이 본다.
     (재는 것은 브라우저가 살아 있을 때 해야 한다 — 판정은 아래 ok 가 생긴 뒤에.) */
  const KNOWN = [
    { ms: 'V2ガンダム', skill: 'M・ドライブ・ユニット制御機構', key: 'cutRate', v: 70 },
    { ms: 'Hi-νガンダム', skill: 'サイコフレーム共振', key: 'cutRate', v: 50 },
    { ms: 'ヴィクトリーガンダム', skill: 'ミノフスキー・フライト・システム', key: 'cutInit', v: 10 },
    { ms: 'Ζガンダム3号機P2型', skill: 'サイコ・ニュートライザー', key: 'oh', v: 50 }
  ];
  const known = await pg.evaluate(list => {
    const t = window.GBO2UiTest;
    return list.map(w => {
      const ms = t.msData().filter(m => m.MS名.replace(/_LV\d+$/, '') === w.ms).pop();
      if (!ms) return Object.assign({}, w, { got: '(기체 없음)' });
      for (const form of ['normal', '変形時']) {
        const hit = (t.thrusterSkillsOf(ms, t.msLevel(ms), form) || [])
          .find(x => x.name === w.skill && x.key === w.key);
        if (hit) return Object.assign({}, w, { got: hit.v });
      }
      return Object.assign({}, w, { got: '(못 읽음)' });
    });
  }, KNOWN);

  /* 늘어나는 값(＋)은 읽지 않는다 — 이 칸은 「경감」 축이라 음수로 넣으면 화면에
     「초기소비 -25%」로 나와 줄어드는 것처럼 읽힌다. 「계산 안 함」으로 남긴다. */
  const plusRead = await pg.evaluate(() => {
    const t = window.GBO2UiTest;
    const ms = t.msData().filter(m => /^FAガンダムMk-Ⅱ_LV/.test(m.MS名)).pop();
    if (!ms) return '(기체 없음)';
    const hit = (t.thrusterSkillsOf(ms, t.msLevel(ms), 'normal') || [])
      .find(x => x.name === 'インターラプトガード');
    return hit ? ('읽어 버림 ' + hit.key + ' ' + hit.v) : null;
  });

  await br.close();

  // 이름+LV+효과 단위로 접는다
  const uniq = new Map();
  for (const r of rows) {
    const k = [r.form, r.name, r.lv || '', r.key, r.v, r.cond || '', r.env || ''].join('|');
    if (!uniq.has(k)) uniq.set(k, { ...r, n: 0 });
    uniq.get(k).n++;
  }
  const all = [...uniq.values()];
  const always = all.filter(x => !x.cond);

  let pass = 0, fail = 0;
  const ok = (label, cond, extra) => {
    if (cond) { pass++; console.log('  PASS ' + label); }
    else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + JSON.stringify(extra, null, 1) : '')); }
  };

  console.log('스러스터 스킬 — 효과 ' + all.length + '가지 (기체 연인원 ' + rows.length + ')\n');

  console.log('== 상시로 잡힌 것이 손으로 확인한 목록과 같은가 ==');
  for (const form of ['normal', 'transform']) {
    const mine = always.filter(x => x.form === form);
    const gotNames = [...new Set(mine.map(x => x.name))].sort();
    const wantNames = Object.keys(ALWAYS[form]).sort();
    ok('[' + form + '] 상시 스킬 이름 목록', JSON.stringify(gotNames) === JSON.stringify(wantNames),
      { 읽어냄: gotNames, 기대: wantNames });
    for (const nm of wantNames) {
      const keys = [...new Set(mine.filter(x => x.name === nm).map(x => x.key))].sort();
      ok('  [' + form + '] ' + nm + ' 의 축',
        JSON.stringify(keys) === JSON.stringify([...ALWAYS[form][nm]].sort()),
        { 읽어냄: keys, 기대: ALWAYS[form][nm] });
    }
  }

  console.log('');
  console.log('== 체크가 상황 단위인가 ==');
  // 한 스킬이 조건이 다른 효과를 여럿 가질 수 있다. 체크를 **이름**으로 묶으면 한 줄만
  // 눌러도 동시에 성립하지 않는 상황이 같이 켜져, 경감 합이 100% 를 넘고 계산이 음수로
  // 넘어간다(실제로 133기에서 그랬다 — 부스트 8.1 → 20.9초).
  const pairs = {};
  for (const x of all.filter(y => y.cond)) {
    const k = x.form + '|' + x.name;
    (pairs[k] = pairs[k] || new Set()).add(x.cond);
  }
  const multi = Object.entries(pairs).filter(function (e) { return e[1].size > 1; });
  console.log('  조건을 둘 이상 가진 스킬 ' + multi.length + '종 — 이름으로 묶이면 안 된다');
  ok('조건부 효과에 조건이 빠짐없이 붙어 있다',
    all.filter(x => x.cond).every(x => typeof x.cond === 'string' && x.cond.length > 0));

  console.log('');
  console.log('== 합이 계산을 뒤집지 않는가 ==');
  // 같은 상황 안에서의 합만 본다 — 서로 다른 상황을 함께 켜는 것은 사용자의 선택이고,
  // 그때는 앱이 95% 로 묶고 그 사실을 화면에 적는다.
  const bySit = {};
  for (const x of all.filter(y => y.cond)) {
    // LV 을 열쇠에 넣는다 — 같은 이름·조건이라도 LV 이 다르면 **다른 항목**이다.
    // 안 넣으면 LV1 25% + LV2 50% + LV3 75% 를 한 덩어리로 세어 150% 라고 말한다.
    const k = x.form + '|' + x.name + '|' + x.lv + '|' + x.cond + '|' + x.key;
    bySit[k] = (bySit[k] || 0) + x.v;
  }
  const overOne = Object.entries(bySit).filter(function (e) {
    return /cutInit|cutRate/.test(e[0]) && e[1] >= 100;
  });
  ok('한 상황 안의 경감 합이 100% 미만', overOne.length === 0,
    overOne.slice(0, 4).map(function (e) { return e[0] + ' = ' + e[1] + '%'; }).join(' / '));

  console.log('\n== 값이 제정신인가 ==');
  ok('경감·상승은 1~100% 안', all.every(x => x.v > 0 && x.v <= 150), all.filter(x => !(x.v > 0 && x.v <= 150)));
  ok('축은 넷뿐', all.every(x => ['cutInit', 'cutRate', 'recover', 'oh'].includes(x.key)));
  // 조건 없는 불릿을 상시로 올리지 않았는가 (보수적으로 발동중이어야 한다)
  ok('조건 없는 불릿이 상시로 안 샜다', !always.some(x => /^[・･]/.test(String(x.seg).trim())),
    always.filter(x => /^[・･]/.test(String(x.seg).trim())).map(x => x.name + ':' + x.seg));

  console.log('\n== 상시 내역 ==');
  for (const x of always.sort((a, b) => b.n - a.n))
    console.log('  ' + ('[' + x.form + ']').padEnd(12) + (x.ko || x.name).padEnd(22)
      + String(x.n).padStart(4) + '기  ' + x.key + ' ' + x.v + '%' + (x.env ? ' [' + x.env + ']' : ''));

  const tally = {};
  for (const x of all.filter(y => y.cond)) tally[x.cond] = (tally[x.cond] || 0) + 1;
  console.log('\n상황 한정 ' + all.filter(x => x.cond).length + '가지 — '
    + Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · '));

  if (LIST) {
    console.log('\n== 전체 ==');
    for (const x of all.sort((a, b) => b.n - a.n))
      console.log('  ' + (x.ko || x.name).padEnd(24) + String(x.n).padStart(4) + '기  '
        + (x.cond || '상시').padEnd(7) + x.key + ' ' + x.v + '%\n        「' + x.seg + '」');
  }

  for (const k of known) {
    ok('「量」 없는 표기를 읽는다 — ' + k.ms + ' / ' + k.key,
      k.got === k.v, '기대 ' + k.v + ' · 실제 ' + k.got);
  }
  ok('늘어나는 값(＋)은 읽지 않는다', plusRead === null, String(plusRead));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
