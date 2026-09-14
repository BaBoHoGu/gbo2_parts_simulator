// 파츠 적용 화면을 찍는다. 조사용.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const puppeteer = require('puppeteer-core');
const { findChrome } = require('./lib/wiki_fetch.js');
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
const URL = 'file:///' + FILE.split(path.sep).join('/').replace(/ /g, '%20');
const OUT = path.join(ROOT, 'dist', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1500, height: 950, deviceScaleFactor: 2 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4500);
  await pg.evaluate(() => { const c = document.querySelector('.ms-card'); if (c) c.click(); });
  await sleep(2500);
  await pg.evaluate(() => {
    document.querySelector('#openAuto').click();
    const p = document.querySelector('#preset'); if (p) { p.value = '격투 강습'; p.dispatchEvent(new Event('change')); }
    const e = document.querySelector('#effort'); if (e) e.value = '4';
    document.querySelector('#runAuto').click();
  });
  await sleep(12000);
  await pg.evaluate(() => { const d = document.querySelector('#autoDrawer'); if (d) d.classList.remove('open'); });
  await sleep(800);
  // 무장 한 줄을 펴서 위키 설명까지 찍는다
  await pg.evaluate(() => {
    const r = document.querySelector('.weapon');
    if (r) r.click();
  });
  await sleep(900);
  await pg.evaluate(() => { const d = document.querySelector('.wd-note-chips, .wd-note-tx'); if (d) d.scrollIntoView({ block: 'center' }); });
  await sleep(400);
  await pg.screenshot({ path: path.join(OUT, 'build.png') });
  console.log('ok');
  await browser.close();
})().catch(e => { console.log('실패: ' + e.message); process.exit(1); });
