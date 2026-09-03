// 오버로드류 스킬 뒤 무장 OH 2배 표기 실측.
//   node tools/ohx2_check.js
//
// 2배 문구가 있는 기체에만 붙고, 문구 없는 오버로드 LV3 기체엔 안 붙어야 한다.
// 사이코뮤 증폭장치는 사이코뮤 무장에만 붙는다.
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

// 데이터에서 기대값을 먼저 만든다 — 화면만 보고 맞다고 하면 근거가 없다
const skills = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ms_skills.json'), 'utf8'));
const X2 = /効果終了後[^\/]*?2倍のOH復帰時間/;
const OL = /オーバーロード|サイコミュ増幅装置/;
const expect = [];                 // 2배가 붙어야 하는 기체
const notExpect = [];              // 오버로드지만 2배 문구가 없는 기체
for (const [ms, modes] of Object.entries(skills)) {
  let hit = false, ol = false;
  for (const m of (Array.isArray(modes) ? modes : [])) for (const sk of (m.skills || [])) {
    if (X2.test(String(sk.desc || ''))) hit = true;
    if (OL.test(sk.name)) ol = true;
  }
  if (hit) expect.push(ms); else if (ol) notExpect.push(ms);
}
console.log('  2배 대상 ' + expect.length + '기 / 오버로드지만 비대상 ' + notExpect.length + '기');

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);

  // 검색으로 기체를 열고, 무장 표의 리로드/OH 칸을 읽는다
  const openByQuery = async q => {
    await pg.evaluate(() => {
      const back = [...document.querySelectorAll('button')].find(b => /기체 다시|다른 기체/.test(b.textContent));
      if (back) back.click();
    });
    await sleep(400);
    await pg.evaluate(s => { const e = document.querySelector('#msQuery'); e.value = s; e.dispatchEvent(new Event('input', { bubbles: true })); }, q);
    await sleep(900);
    const ok = await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) { c.click(); return true; } return false; });
    if (!ok) return null;
    await sleep(1500);
    return pg.evaluate(() => ({
      rows: [...document.querySelectorAll('#weaponList .weapon')].map(r => {
        const rl = r.querySelector('.w-reload');
        return {
          nm: ((r.querySelector('.w-nm-top') || r.querySelector('.w-nm') || {}).textContent || '').trim(),
          oh: rl ? rl.textContent.replace(/\s+/g, ' ').trim() : '',
          x2: !!(rl && rl.querySelector('.w-ohx2'))
        };
      })
    }));
  };

  // ① 2배 대상 — 오버로드 기체. OH 무장 전부에 붙고, 값은 표시값의 2배여야 한다
  const fa = await openByQuery('풀 아머 건담 Mk-Ⅲ');
  if (!fa || !fa.rows.length) check('풀 아머 건담 Mk-Ⅲ 무장 표', false, '기체를 못 찾음');
  else {
    const withOh = fa.rows.filter(r => /OH복귀/.test(r.oh));
    check('풀 아머 건담 Mk-Ⅲ — OH 무장 전부에 2배 표기', withOh.length > 0 && withOh.every(r => r.x2),
      withOh.map(r => r.oh).join(' | ').slice(0, 220));
    // 「23초OH복귀오버로드 후 46초」 처럼 앞 숫자의 2배가 뒤에 와야 한다
    const bad = withOh.filter(r => {
      const m = r.oh.match(/^([\d.]+)초.*?후\s*([\d.]+)초/);
      return !m || Math.abs(Number(m[2]) - Number(m[1]) * 2) > 0.05;
    });
    check('2배 값이 맞다', bad.length === 0, bad.map(r => r.oh).join(' | '));
    console.log('   ' + withOh.map(r => r.oh).join(' | ').slice(0, 200));
  }

  // ② 오버로드지만 E팩 탄창식 빔뿐인 기체 — 「残弾式ビーム兵装非対応」 이라 붙을 자리가 없다
  const rd = await openByQuery('릭 디제');
  if (rd && rd.rows.length)
    check('릭 디제 — E팩 리로드뿐이라 표기 없음', rd.rows.every(r => !r.x2),
      rd.rows.filter(r => r.x2).length + '건 잘못 붙음');
  else check('릭 디제 무장 표', false, '기체를 못 찾음');

  // ③ 2배 문구 없는 오버로드 LV3 — 붙으면 안 된다
  const hz = await openByQuery('하이젠슬레이');
  if (hz && hz.rows.length)
    check('하이젠슬레이Ⅱ 라 — 2배 문구가 없어 표기도 없다', hz.rows.every(r => !r.x2),
      hz.rows.filter(r => r.x2).length + '건 잘못 붙음');
  else check('하이젠슬레이Ⅱ 라 무장 표', false, '기체를 못 찾음');

  // ④ 사이코뮤 증폭장치 — 사이코뮤 무장에만
  const dd = await openByQuery('대그 돌');
  if (dd && dd.rows.length) {
    const marked = dd.rows.filter(r => r.x2);
    check('대그 돌 — 사이코뮤 무장에만 붙는다', marked.length > 0 && marked.length < dd.rows.length,
      `${marked.length}/${dd.rows.length}`);
    console.log('   붙은 무장: ' + marked.map(r => r.nm.slice(0, 24)).join(', '));
  } else check('대그 돌 무장 표', false, '기체를 못 찾음');

  check('스크립트 오류 없음', errs.length === 0, errs.join(' / '));
  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\nOH 2배 표기 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
