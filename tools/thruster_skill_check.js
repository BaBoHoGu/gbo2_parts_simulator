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

  /* ── 「…速度 N倍」 ──
     특수 긴급 회피 제어는 「3秒間スラスター＆OH復帰速度 2.5倍」로 **숫자가 적혀 있다.**
     예전에는 % 만 읽어 통째로 「계산 안 함」이었다(사용자 지적).
     2.5배 = 회복속도 +150% · 복귀시간 1/2.5 → 60% 단축. 몇 초짜리라 **조건부**여야 한다 —
     상시로 새면 아무도 모르게 좋게 나온다. 그래서 cond 가 붙었는지까지 본다. */
  const burst = await pg.evaluate(() => {
    const t = window.GBO2UiTest;
    const ms = t.msData().filter(m => /^V2ガンダム_LV/.test(m.MS名)).pop();
    if (!ms) return '(기체 없음)';
    return (t.thrusterSkillsOf(ms, t.msLevel(ms), 'normal') || [])
      .filter(x => x.name === '特殊緊急回避制御')
      .map(x => x.key + ':' + x.v + ':' + (x.cond || '상시') + ':' + (x.burst || 0));
  });

  /* 반대쪽은 읽으면 안 된다 — 오버부스트의 「終了後は3倍程度の回復時間を必要とする」는
     **벌점**이다. 速度 가 아니라 時間 이라 안 걸려야 한다. 상승으로 읽으면 거꾸로다. */
  const penalty = await pg.evaluate(() => {
    const t = window.GBO2UiTest;
    const ms = t.msData().filter(m => /^ヘイズル・アウスラ_LV/.test(m.MS名)).pop();
    if (!ms) return '(기체 없음)';
    const hit = (t.thrusterSkillsOf(ms, t.msLevel(ms), 'normal') || [])
      .find(x => x.name === 'オーバーブースト');
    return hit ? ('읽어 버림 ' + hit.key + ' ' + hit.v) : null;
  });

  /* ── 파츠 경감은 스킬 **뒤에** 곱한다 ──
     연소 효율 보조 장치(10%)는 스킬과 겹쳐 더해지지 않는다(사용자 지적).
     V2 의 M 드라이브(계속소비 70%)에 얹으면 80% 가 아니라 1−0.3×0.9 = 73% 다.
     더하면 부스트 지속이 실제보다 **길게** 나오고, 스킬이 센 기체일수록 더 틀린다. */
  const stack = await pg.evaluate(() => {
    const t = window.GBO2UiTest;
    const ms = t.msData().filter(m => /^V2ガンダム_LV/.test(m.MS名)).pop();
    if (!ms) return '(기체 없음)';
    const part = [{ description: '高速移動開始時と高速移動のスラスター消費量を10%軽減' }];
    const lv = t.msLevel(ms);
    const on = new Set(['M・ドライブ・ユニット制御機構|발동중']);
    const only = t.thrusterMetrics(ms, 80, part, 'ground', { lv, on: new Set(), form: 'normal' });
    const both = t.thrusterMetrics(ms, 80, part, 'ground', { lv, on, form: 'normal' });
    return { partOnly: only && only.fx.cutRate, withSkill: both && both.fx.cutRate };
  });

  /* ── 소비가 **늘어나는** 스킬 ──
     플랩 부스터는 게임 안 설명에 「消費量が増加する」뿐이라 값이 없어 「계산 안 함」에
     남아 있었다. 위키 해설이 값을 적고 있다 — LV1 +100%(8→16/초), LV2 +50%(8→12/초).
     경감 축에 음수로 넣었으니, 켜면 부스트 지속이 **정확히 반**(LV1)·2/3(LV2)이 되어야 한다.
     지속이 짧아지는 쪽이라 부호가 뒤집히면 도리어 길어진다 — 그래서 값이 아니라
     **지속 시간**으로 잰다. 지상 한정이므로 우주에서는 안 걸리는 것도 함께 본다. */
  const flap = await pg.evaluate(() => {
    const t = window.GBO2UiTest;
    const get = re => t.msData().filter(m => re.test(m.MS名)).pop();
    const one = (ms, lv) => {
      if (!ms) return '(기체 없음)';
      const key = 'フラップ・ブースター|상승중';
      const mk = (env, on) => t.thrusterMetrics(ms, 60, [], env, { lv: t.msLevel(ms), on, form: 'normal' });
      const g0 = mk('ground', new Set()), g1 = mk('ground', new Set([key]));
      const s1 = mk('space', new Set([key]));
      const row = (t.thrusterSkillsOf(ms, t.msLevel(ms), 'normal') || [])
        .find(x => /フラップ/.test(x.name));
      return { lv: row && row.lv, v: row && row.v, cond: row && row.cond, env: row && row.env,
        groundOff: g0 && +g0.boost.toFixed(3), groundOn: g1 && +g1.boost.toFixed(3),
        spaceOn: s1 && +s1.boost.toFixed(3),
        spaceOff: mk('space', new Set()) && +mk('space', new Set()).boost.toFixed(3) };
    };
    return { lv1: one(get(/^ガンダム試作2号機［BB仕様］_LV/)), lv2: one(get(/^Hi-νガンダム_LV/)) };
  });

  /* ── 상대 내성을 깎는 몫을 적어 보이는가 ──
     롱 레인지 어댑터는 스킬 칸에 「선회 +20」만 떴다 — 본체인 내실탄·내빔 15%減 둘이
     통째로 없는 것처럼 보였다(사용자 지적). 수치로 반영하지는 못한다(피해 계산에 상대가 없다).
     그래도 **있다는 것은** 적어야 한다. 원문에서 값 둘을 다 읽는지까지 본다. */
  const foe = await pg.evaluate(async () => {
    const q = document.querySelector('#msQuery');
    q.value = 'V2 건담'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    const card = document.querySelector('#msList .ms-card');
    if (!card) return '(기체 없음)';
    card.click();
    await new Promise(r => setTimeout(r, 1500));
    const b = document.querySelector('#skillBtn');
    if (!b) return '(스킬 버튼 없음)';
    b.click();
    await new Promise(r => setTimeout(r, 300));
    return [...document.querySelectorAll('#skillMenu .skill-item')].map(x => ({
      nm: x.querySelector('.k') && x.querySelector('.k').textContent,
      foe: x.querySelector('.foe') && x.querySelector('.foe').textContent
    }));
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
  // 값은 줄어드는 쪽이 양수다. 늘어나는 쪽(음수)도 이제 하나 있다(플랩 부스터) —
  // 그래서 부호를 막는 대신 **크기**를 막고, 늘어나는 쪽은 누구인지를 따로 못 박는다.
  ok('값의 크기가 제정신인가 (0 이 아니고 150 이내)',
    all.every(x => x.v !== 0 && Math.abs(x.v) <= 150), all.filter(x => !(x.v !== 0 && Math.abs(x.v) <= 150)));
  {
    // 소비가 늘어나는 값은 손으로 넣은 것뿐이어야 한다. 파서가 경감을 음수로 잘못 읽으면
    // 부스트 지속이 아무도 모르게 **길어진다** — 여기서 걸린다.
    const minus = [...new Set(all.filter(x => x.v < 0).map(x => x.name))];
    ok('늘어나는 쪽은 플랩 부스터뿐',
      minus.length === 1 && minus[0] === 'フラップ・ブースター', minus);
  }
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

  ok('배수 표기를 읽는다 — 특수 긴급 회피 제어 회복속도',
    Array.isArray(burst) && burst.includes('recover:150:회피:3'), JSON.stringify(burst));
  ok('배수 표기를 읽는다 — 특수 긴급 회피 제어 OH 복귀',
    Array.isArray(burst) && burst.includes('oh:60:회피:3'), JSON.stringify(burst));
  // 목록이 비면 every 가 공허하게 참이 된다 — 값이 **있고** 그 값이 상시가 아닌지를 본다
  ok('몇 초짜리를 상시로 올리지 않는다',
    Array.isArray(burst) && burst.length === 2 && burst.every(x => !/:상시:/.test(x)),
    JSON.stringify(burst));
  ok('끝난 뒤 느려지는 벌점(배수)은 읽지 않는다', penalty === null, String(penalty));
  ok('파츠 경감만 있을 때 10%', stack && stack.partOnly === 10, JSON.stringify(stack));
  ok('파츠는 스킬 뒤에 곱한다 (70%+10% → 80 이 아니라 73)',
    stack && stack.withSkill === 73, JSON.stringify(stack));

  {
    const a = flap && flap.lv1, b = flap && flap.lv2;
    ok('플랩 부스터 LV1 을 소비 +100% 로 읽는다',
      a && a.v === -100 && a.lv === 'LV1', JSON.stringify(a));
    ok('플랩 부스터 LV2 를 소비 +50% 로 읽는다',
      b && b.v === -50 && b.lv === 'LV2', JSON.stringify(b));
    // 값이 아니라 결과로 잰다 — 부호가 뒤집히면 지속이 **길어진다**
    ok('LV1 을 켜면 부스트 지속이 정확히 반이 된다',
      a && Math.abs(a.groundOn - a.groundOff / 2) < 0.01, JSON.stringify(a));
    ok('LV2 를 켜면 부스트 지속이 2/3 이 된다',
      b && Math.abs(b.groundOn - b.groundOff * 2 / 3) < 0.01, JSON.stringify(b));
    // 지상 스킬이다 — 우주에서 켜도 아무 일이 없어야 한다
    ok('우주에서는 걸리지 않는다',
      a && a.spaceOn === a.spaceOff, JSON.stringify(a));
    ok('상시가 아니라 체크식이다', a && a.cond === '상승중' && a.env === 'ground', JSON.stringify(a));
  }
  {
    const row = Array.isArray(foe) && foe.find(x => x.nm === '롱 레인지 어댑터');
    ok('롱 레인지 어댑터가 스킬 칸에 있다', !!row, JSON.stringify(foe));
    ok('적 내실탄·내빔 감소를 적어 보인다',
      row && row.foe && /내실탄/.test(row.foe) && /내빔/.test(row.foe) && /15%/.test(row.foe),
      JSON.stringify(row));
    // 상대가 없는 계산이라는 것까지 적어야 한다 — 안 적으면 반영된 줄 안다
    ok('수치에 안 들어간다고 적는다', row && row.foe && /안 들어갑니다/.test(row.foe),
      JSON.stringify(row));
  }

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
