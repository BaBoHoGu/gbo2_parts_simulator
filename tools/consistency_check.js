// 화면끼리 같은 값을 말하는지 실측 — 「기능적 모순」 회귀 방지.
//   node tools/consistency_check.js
//
// ① 「내구 지표」 를 성능표·피탄 상단·저장 목록·비교가 같은 값으로 낸다
//    (예전엔 뒤의 둘이 피해경감을 빼먹어 24,572 vs 22,115 로 갈렸다)
// ② 변형 모드에서 자동 구성이 변형 수치로 최적화한다 (후보 카드 == 적용 후 성능표)
// ③ 「위력순」 정렬이 표에 보이는 값 순서와 맞는다 (파츠 보정 반영)
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }
const URL = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (!ok && extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};
const nums = t => (String(t).match(/[\d,]{3,}/g) || []).map(x => Number(x.replace(/,/g, '')));

// 변형 스탯을 가진 기체를 데이터에서 고른다 (이름을 코드에 박지 않는다)
const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const dict = {
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'ms.auto.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', 'ms.json'), 'utf8'))
};
const TF_FIELDS = ['スピード_変形時', '高速移動_変形時', '射撃補正_変身時', '格闘補正_変身時', '旋回_変形時'];
const tfMs = msData.find(m => TF_FIELDS.some(f => m[f] != null));
const tfName = tfMs ? (dict[String(tfMs.MS名).replace(/_LV\d+$/, '')] || String(tfMs.MS名)) : null;

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  pg.on('dialog', d => d.accept());
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);

  const pick = async q => {
    await pg.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /기체 다시|다른 기체/.test(x.textContent));
      if (b) b.click();
    });
    await sleep(400);
    await pg.evaluate(t => { const e = document.querySelector('#msQuery'); e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }, q);
    await sleep(900);
    const ok = await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) { c.click(); return true; } return false; });
    await sleep(1400);
    return ok;
  };
  const perfStats = () => pg.evaluate(() => {
    const o = {};
    for (const r of document.querySelectorAll('#statBody .stat-row'))
      o[r.querySelector('.label').textContent.trim()] = r.querySelector('.total').textContent.trim();
    return o;
  });

  // ── ① 내구 지표가 네 화면에서 같은가 ──────────────────────────────
  await pick('짐 스나이퍼');
  // 무조건 걸리는 피해경감 파츠를 낀다 (교육형 컴퓨터 [특방] — 받는 피해 -10%)
  await pg.evaluate(() => { const q = document.querySelector('#partQuery'); q.value = '특방'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  const cutPart = await pg.evaluate(() => {
    const t = document.querySelector('#partList .part-tile');
    if (!t) return null;
    const n = t.querySelector('.pt-nm').textContent; t.click(); return n;
  });
  await sleep(900);
  check('피해경감 파츠 장착', !!cutPart, '파츠를 못 찾음');

  const perf = nums(await pg.evaluate(() => {
    const r = [...document.querySelectorAll('#statBody .dura-row')].find(x => /내구 지표/.test(x.textContent));
    return r ? r.textContent : '';
  }));
  await pg.evaluate(() => document.querySelector('#pietanBtn').click());
  await sleep(1200);
  const pie = nums(await pg.evaluate(() => (document.querySelector('#pietanDura') || {}).textContent || ''));
  await pg.evaluate(() => document.querySelector('#pietanClose').click());
  await sleep(500);
  await pg.evaluate(() => { window.prompt = () => '일관성점검'; document.querySelector('#save').click(); });
  await sleep(700);
  await pg.evaluate(() => document.querySelector('#load').click());
  await sleep(1000);
  const saved = nums(await pg.evaluate(() => (document.querySelector('#savedResults .sc-dura') || {}).textContent || ''));
  await pg.evaluate(() => document.querySelector('#savedModalClose').click());
  await sleep(500);
  await pg.evaluate(() => document.querySelector('#compareBtn').click());
  await sleep(1200);
  const cmp = await pg.evaluate(() => [...document.querySelectorAll('#compareBody .cmp-row')]
    .filter(r => /내실탄|내빔|내격투/.test(r.textContent) && /피해 -/.test(r.textContent))
    .map(r => (r.querySelector('.cmp-v') || {}).textContent || '').join(' '));
  await pg.evaluate(() => document.querySelector('#compareModalClose').click());
  await sleep(400);

  const same = (a, b) => a.length === 3 && b.length >= 3 && a.every((v, i) => v === b[i]);
  console.log(`   성능표 ${perf.join('/')} · 피탄 ${pie.join('/')} · 저장 ${saved.join('/')} · 비교 ${nums(cmp).slice(0, 3).join('/')}`);
  check('성능표 == 피탄 상단', same(perf, pie), `${perf.join('/')} vs ${pie.join('/')}`);
  check('성능표 == 저장 목록', same(perf, saved), `${perf.join('/')} vs ${saved.join('/')}`);
  check('성능표 == 비교', same(perf, nums(cmp)), `${perf.join('/')} vs ${nums(cmp).slice(0, 3).join('/')}`);
  check('피해경감이 실제로 반영됨(경감 전 값이 아님)', /피해 -/.test(String(perf.length ? 'x' : '')) || perf[0] > 0);

  // ── ② 변형 모드 자동 구성 ─────────────────────────────────────────
  if (!tfName) check('변형 기체를 데이터에서 찾음', false);
  else if (!(await pick(tfName.replace(/\s*LV\d+$/, '')))) check('변형 기체 선택', false, tfName);
  else {
    const hasForm = await pg.evaluate(() => !document.querySelector('#formSeg').hidden);
    check('변형 토글이 있다', hasForm, tfName);
    if (hasForm) {
      await pg.evaluate(() => { const b = [...document.querySelectorAll('#formSeg .seg-btn')][1]; if (b) b.click(); });
      await sleep(900);
      await pg.evaluate(() => document.querySelector('#openAuto').click());
      await sleep(500);
      await pg.evaluate(() => { document.querySelector('#effort').value = '4'; document.querySelector('#runAuto').click(); });
      await sleep(24000);
      const cand = await pg.evaluate(() => {
        const c = document.querySelector('#autoResults .auto-cand');
        if (!c) return null;
        const o = {};
        for (const st of c.querySelectorAll('.ac-stat')) o[st.querySelector('.ac-k').textContent.trim()] = st.querySelector('.ac-v').textContent.trim();
        return o;
      });
      await pg.evaluate(() => { const c = document.querySelector('#autoResults .auto-cand'); if (c) c.click(); });
      await sleep(1600);
      const after = await perfStats();
      const keys = ['스피드', '고속이동', '스러스터', '사격 보정', '격투 보정'];
      const bad = cand ? keys.filter(k => cand[k] != null && after[k] != null && cand[k] !== after[k]) : ['(후보 없음)'];
      console.log('   후보 ' + keys.map(k => k + ' ' + (cand && cand[k])).join(' · '));
      check('변형 모드: 후보 카드 == 적용 후 성능표', bad.length === 0,
        bad.map(k => `${k} 후보 ${cand[k]} ≠ 성능표 ${after[k]}`).join(' | '));
    }
  }

  // ── ③ 「위력순」 정렬이 표시값 순서와 맞는가 ────────────────────────
  await pick('짐 스나이퍼');
  await pg.evaluate(() => { const q = document.querySelector('#partQuery'); q.value = '탄약'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(700);
  const kit = await pg.evaluate(() => {
    const t = document.querySelector('#partList .part-tile');
    if (!t) return null;
    const n = t.querySelector('.pt-nm').textContent; t.click(); return n;
  });
  await sleep(800);
  check('실탄 한정 파츠 장착', !!kit, '탄약 강화 키트를 못 찾음');
  await pg.evaluate(() => {
    const b = [...document.querySelectorAll('#weaponSort .seg-btn')].find(x => /위력/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(900);
  const shown = await pg.evaluate(() => [...document.querySelectorAll('#weaponList .weapon')].map(r => {
    const read = c => {
      if (!c) return 0;
      const base = Number(String(c.childNodes[0] ? c.childNodes[0].textContent : '').replace(/[^\d]/g, '')) || 0;
      const g = c.querySelector('.w-gain');
      const s = c.querySelector('.s-gain, .s-gain.multi');
      return base + (g ? Number(g.textContent.replace(/[^\d]/g, '')) || 0 : 0)
        + (s ? Number(s.textContent.replace(/[^\d]/g, '')) || 0 : 0);
    };
    const cells = r.querySelectorAll('.w-dmg');
    return Math.max(read(cells[0]), read(cells[1]));
  }));
  const inv = shown.filter((v, i) => i && v > shown[i - 1]).length;
  console.log('   위력순 표시값: ' + shown.join(' ≥ '));
  check('「위력순」이 표에 보이는 값 순서와 맞는다', inv === 0, '역전 ' + inv + '건');

  check('스크립트 오류 없음', errs.length === 0, errs.join(' / '));
  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n화면 간 일관성 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
