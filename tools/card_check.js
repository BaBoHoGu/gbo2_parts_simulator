// 이미지 카드 실측 — 실제 Chrome 으로 dist 를 띄워 PNG 카드를 그리게 하고,
// 화면 성능표의 공격/내구 지표와 카드 안의 값이 같은지 본다. 카드 PNG 도 남긴다.
//   node tools/card_check.js [--out <경로>]
//
// 배경: 카드가 피해경감을 접지 않은 내구 지표를 그리고 공격 지표 행은 아예 없었다(2026-08-31).
// 화면과 카드는 코드가 갈라져 있어, 한쪽만 고치면 조용히 어긋난다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'dist', 'card_check.png');

let puppeteer, findChrome;
try {
  puppeteer = require('puppeteer-core');
  ({ findChrome } = require('./lib/wiki_fetch.js'));
} catch { console.log('SKIP  puppeteer-core 없음'); process.exit(0); }
if (!fs.existsSync(FILE)) { console.log('SKIP  dist 없음'); process.exit(0); }
const CHROME = findChrome();
if (!CHROME) { console.log('SKIP  Chrome 없음'); process.exit(0); }

const URL = 'file:///' + FILE.replace(/\\/g, '/').replace(/ /g, '%20');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await br.newPage();
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await pg.evaluate(() => document.querySelector('.ms-card').click());
  await sleep(800);

  // 피해경감 파츠를 하나 껴서 화면과 카드가 갈라지는 조건을 만든다.
  const part = await pg.evaluate(() => {
    const t = [...document.querySelectorAll('#partList .part-tile')].find(x => /교육형 컴퓨터 ?\[특방\]/.test(x.textContent));
    if (!t) return null;
    t.click();
    return t.textContent.replace(/\s+/g, ' ').trim();
  });
  if (!part) { console.log('FAIL  피해경감 파츠를 찾지 못했습니다'); await br.close(); process.exit(1); }
  await sleep(700);

  const rowText = lbl => pg.evaluate(l => {
    const r = [...document.querySelectorAll('.dura-row')].find(x => x.textContent.includes(l));
    return r ? r.textContent.replace(/\s+/g, ' ').trim() : '';
  }, lbl);
  const scrAtk = await rowText('공격 지표');
  const scrDur = await rowText('내구 지표');
  console.log('화면 · ' + scrAtk);
  console.log('화면 · ' + scrDur);

  // 카드 생성 → 미리보기 캔버스를 PNG 로 꺼낸다.
  await pg.evaluate(() => document.querySelector('#pngBtn').click());
  await sleep(400);
  const picked = await pg.evaluate(() => {
    const items = [...document.querySelectorAll('.png-menu-item')];
    if (!items.length) return null;
    items[0].click();            // 요약 카드
    return items[0].textContent.trim();
  });
  if (!picked) { console.log('FAIL  이미지 메뉴가 열리지 않았습니다'); await br.close(); process.exit(1); }
  await sleep(3000);
  const data = await pg.evaluate(() => {
    const c = document.querySelector('#pngPreview canvas') || document.querySelector('#pngPreview img');
    if (!c) return null;
    return c.tagName === 'IMG' ? c.src : c.toDataURL('image/png');
  });
  if (!data) { console.log('FAIL  카드 미리보기를 찾지 못했습니다'); await br.close(); process.exit(1); }
  fs.writeFileSync(OUT, Buffer.from(data.split(',')[1], 'base64'));
  const size = await pg.evaluate(() => {
    const c = document.querySelector('#pngPreview canvas');
    return c ? c.width + 'x' + c.height : '(img)';
  });
  await br.close();

  console.log('\n장착 파츠: ' + part);
  console.log('카드 저장: ' + OUT + '  (' + size + ')');
  console.log('\n화면의 값이 카드에도 그대로 보이는지 이미지를 확인하세요.');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
