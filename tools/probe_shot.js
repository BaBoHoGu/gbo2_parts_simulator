// 화면 한 곳을 찍어 눈으로 본다. 조사용.
//   node tools/probe_shot.js <셀렉터|full> [파일이름] [폭] [높이]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const puppeteer = require('puppeteer-core');
const { findChrome } = require('./lib/wiki_fetch.js');
const FILE = path.join(ROOT, 'dist', 'gbo2-simulator.html');
const URL = 'file:///' + FILE.split(path.sep).join('/').replace(/ /g, '%20');
const SEL = process.argv[2] || 'full';
const NAME = process.argv[3] || 'shot';
const VW = +(process.argv[4] || 1500), VH = +(process.argv[5] || 1000);
const OUT = path.join(ROOT, 'dist', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', executablePath: findChrome(), args: ['--no-sandbox'] });
  const pg = await browser.newPage();
  await pg.setViewport({ width: VW, height: VH, deviceScaleFactor: 2 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4500);
  const f = path.join(OUT, NAME + '.png');
  if (SEL === 'full') await pg.screenshot({ path: f });
  else {
    await pg.evaluate(s => { const e = document.querySelector(s); if (e) e.scrollIntoView(); }, SEL);
    await sleep(400);
    const el = await pg.$(SEL);
    if (!el) { console.log('못 찾음: ' + SEL); await browser.close(); process.exit(1); }
    await el.screenshot({ path: f });
  }
  console.log('→ ' + f);
  await browser.close();
})().catch(e => { console.log('실패: ' + e.message); process.exit(1); });
