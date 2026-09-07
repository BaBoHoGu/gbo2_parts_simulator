// 파츠 목록 순서 규칙 실측.
//   node tools/partorder_check.js
//
// ① 장착/해제해도 타일 순서는 그대로여야 한다 (폰에서 손가락 밑 타일이 바뀌면 엉뚱한 게 끼워진다)
// ② 강화 단계를 내리면 슬롯이 줄어 장착 가능/불가가 뒤집히므로 순서를 다시 잡아야 한다
// ③ 소스에 NUL(U+0000) 이 남아 있으면 안 된다 (grep 이 파일을 바이너리로 취급한다)
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

let fails = 0;
const check = (label, ok, extra) => {
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (!ok && extra ? '  — ' + extra : ''));
  if (!ok) fails++;
};

// ③ 은 브라우저가 필요 없다 — 먼저 본다
for (const f of ['src/ui.js', 'src/core.js', 'src/damage.js', 'src/optimizer.js', 'src/i18n.js']) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const n = [...s].filter(c => c.codePointAt(0) === 0).length;
  if (n) check(f + ' 에 NUL 없음', false, n + '개');
}
check('소스에 NUL 문자 없음', fails === 0);

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(fails ? 1 : 0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(fails ? 1 : 0); }
const URL = 'file:///' + path.join(ROOT, 'dist', 'gbo2-simulator.html').replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const names = () => [...document.querySelectorAll('#partList .part-tile .pt-nm')].map(e => e.textContent);

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pg.evaluate(() => { const q = document.querySelector('#msQuery'); q.value = '짐 스나이퍼'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(800);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(1400);

  // ① 장착해도 순서 유지
  const before = await pg.evaluate(names);
  await pg.evaluate(() => {
    const t = [...document.querySelectorAll('#partList .part-tile')].find(x => !x.classList.contains('blocked'));
    if (t) t.click();
  });
  await sleep(700);
  const after = await pg.evaluate(names);
  check('장착해도 타일 순서가 그대로다',
    before.length === after.length && before.every((n, i) => n === after[i]),
    '앞 5개: ' + before.slice(0, 5).join(',') + ' → ' + after.slice(0, 5).join(','));

  // ② 강화 단계를 내리면 순서를 다시 잡는다
  //    (내릴 때 파츠 초기화 확인창이 뜨므로 자동 승인)
  pg.on('dialog', d => d.accept());
  const changed = await pg.evaluate(async () => {
    const seg = document.querySelector('#stageSeg');
    const btn = [...seg.children].find(b => b.dataset.v === '0');   // 미강화
    if (!btn) return null;
    btn.click();
    await new Promise(r => setTimeout(r, 600));
    return [...document.querySelectorAll('#partList .part-tile .pt-nm')].map(e => e.textContent);
  });
  await sleep(600);
  check('강화 단계를 내리면 순서를 다시 잡는다',
    !!changed && !(changed.length === after.length && changed.every((n, i) => n === after[i])),
    '순서가 그대로였다');

  // 다시 잡은 순서가 '장착 가능 먼저' 인지 — 불가 타일이 가능 타일보다 앞에 오면 안 된다
  const ordered = await pg.evaluate(() => {
    const ts = [...document.querySelectorAll('#partList .part-tile')];
    const kind = t => t.classList.contains('blocked') ? 2 : (t.classList.contains('on') ? 1 : 0);
    let last = -1, bad = 0;
    for (const t of ts) { const k = kind(t); if (k < last) bad++; last = Math.max(last, k); }
    return { bad, total: ts.length };
  });
  check('정렬이 「장착 가능 → 장착 중 → 불가」 순이다', ordered.bad === 0,
    `역전 ${ordered.bad}건 / ${ordered.total}개`);

  check('스크립트 오류 없음', errs.length === 0, errs.join(' / '));
  await br.close();
  console.log(fails ? '\n' + fails + '건 실패' : '\n파츠 순서 실측 통과');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
