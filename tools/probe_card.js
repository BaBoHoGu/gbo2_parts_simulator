// PNG 카드를 실제로 뽑아 저장한다. 조사용 — 배포물에 영향 없음.
//   node tools/probe_card.js [summary|detail]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const puppeteer = require('puppeteer-core');
const { findChrome } = require('./lib/wiki_fetch.js');
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
const URL = 'file:///' + FILE.split(path.sep).join('/').replace(/ /g, '%20');
const MODE = process.argv[2] === 'detail' ? 1 : 0;
const OUT = path.join(ROOT, 'dist', 'card_probe');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1500, height: 1000 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(5000);
  // 「이미지」 버튼은 step-only 라 기체를 먼저 골라야 나타난다
  await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) c.click(); });
  await sleep(2500);
  // 자동 구성으로 파츠를 채운다 — 빈 카드는 실제 쓰임새가 아니다
  await pg.evaluate(() => {
    document.querySelector('#openAuto').click();
    const p = document.querySelector('#preset'); if (p) { p.value = '격투 강습'; p.dispatchEvent(new Event('change')); }
    const e = document.querySelector('#effort'); if (e) e.value = '4';
    document.querySelector('#runAuto').click();
  });
  await sleep(12000);
  await pg.evaluate(() => { const d = document.querySelector('#autoDrawer'); if (d) d.classList.remove('open'); });
  await sleep(600);
  await pg.click('#pngBtn');
  await sleep(400);
  await pg.evaluate(i => document.querySelectorAll('.png-menu-item')[i].click(), MODE);
  await sleep(3000);
  const d = await pg.evaluate(() => {
    const im = document.querySelector('#pngPreview img');
    const note = document.getElementById('pngNote');
    return im ? { url: im.src, note: note ? note.textContent : '' } : null;
  });
  if (!d) { console.log('카드를 못 뽑았습니다'); await browser.close(); process.exit(1); }
  const b = Buffer.from(d.url.split(',')[1], 'base64');
  const f = path.join(OUT, 'card_' + (MODE ? 'detail' : 'summary') + '.png');
  fs.writeFileSync(f, b);
  console.log(d.note + '  ·  ' + Math.round(b.length / 1024) + 'KB');
  console.log('→ ' + f);
  await browser.close();
})().catch(e => { console.log('실패: ' + e.message); process.exit(1); });
