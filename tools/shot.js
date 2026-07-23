// 빌드 결과를 실제 크로미움으로 열어 스크린샷을 남긴다 (육안 확인용).
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = path.join(__dirname, '..', 'shots');
const url = 'file:///' + path.join(DIST, 'gbo2-simulator.html').replace(/\\/g, '/');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  await page.setViewport({ width: 1600, height: 980, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('#msList .ms-card');

  // 이미지가 실제로 뜨는지 확인
  const imgStat = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    return {
      total: imgs.length,
      loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.src).slice(0, 3)
    };
  });
  console.log('이미지', imgStat.loaded + '/' + imgStat.total, '로드', imgStat.broken.length ? '깨짐: ' + imgStat.broken : '');

  await page.screenshot({ path: path.join(OUT, '1-초기화면.png') });

  // 파츠 몇 개 장착
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#partList .part-tile')].filter(r => !r.classList.contains('blocked'));
    for (const r of rows.slice(0, 5)) r.click();
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, '2-파츠장착.png') });

  // 자동 구성 드로어
  await page.click('#openAuto');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, '3-자동구성.png') });

  // 좁은 화면
  await page.click('#closeAuto');
  await page.setViewport({ width: 600, height: 900 });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT, '4-모바일.png'), fullPage: false });

  await browser.close();
  console.log('스크린샷 ->', OUT);
})();
