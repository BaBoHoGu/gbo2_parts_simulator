// 스킬 도감을 열어 찍는다. 조사용.
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
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  const W = +(process.argv[2] || 1500), H = +(process.argv[3] || 1000);
  await pg.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: W < 500, hasTouch: W < 500 });
  await pg.goto(URL, { waitUntil: 'load', timeout: 180000 });
  await sleep(4500);
  await pg.evaluate(() => { const m = document.querySelector('#moreBtn, .more-btn'); if (m && getComputedStyle(m).display !== 'none') m.click(); });
  await sleep(400);
  await pg.evaluate(() => document.querySelector('#codexBtn').click());
  await sleep(1200);
  await pg.screenshot({ path: path.join(OUT, 'codex' + (process.argv[2] ? '_' + process.argv[2] : '') + '.png') });
  // 첫 스킬을 골라 본다
  await pg.evaluate(() => { const h = document.querySelector('.codex-item'); if (h) h.click(); });
  await sleep(600);
  await pg.screenshot({ path: path.join(OUT, 'codex_open' + (process.argv[2] ? '_' + process.argv[2] : '') + '.png') });
  const note = await pg.evaluate(() => (document.getElementById('codexNote') || {}).textContent || '');
  console.log('도감: ' + note);
  console.log(errs.length ? '스크립트 오류 ' + errs.length + ': ' + errs[0] : '스크립트 오류 없음');
  await browser.close();
})().catch(e => { console.log('실패: ' + e.message); process.exit(1); });
