// 앱 아이콘을 한 장의 원본에서 필요한 크기로 만든다.
//   node tools/make_icons.js [원본.png]
//
// 이미지 라이브러리를 새로 들이지 않는다 — 이 저장소는 이미 헤드리스 Chrome 을 갖고 있고,
// canvas 로 줄이는 것이 sharp 같은 네이티브 의존성을 더하는 것보다 가볍다.
//
// 만드는 것
//   android/app/src/main/res/mipmap-*/ic_launcher.png   APK 아이콘 (5개 밀도)
//   assets/brand.webp                                    좌측 상단 대표 이미지 (앱에 인라인된다)
//   assets/favicon.png                                   브라우저 탭 아이콘 (HTML 에 인라인된다)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { findChrome } = require('./lib/wiki_fetch.js');

const SRC = process.argv[2] || path.join(ROOT, 'assets', 'icon-src.png');
if (!fs.existsSync(SRC)) {
  console.error('원본 이미지를 찾지 못했습니다: ' + SRC);
  console.error('  node tools/make_icons.js <원본.png>');
  process.exit(1);
}

// 안드로이드 런처 아이콘 밀도별 크기(px)
const MIPMAP = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

(async () => {
  const puppeteer = require('puppeteer-core');
  const chrome = findChrome();
  if (!chrome) { console.error('시스템 Chrome/Edge 를 찾지 못했습니다.'); process.exit(1); }

  const dataUri = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  /** 원본을 size×size 로 줄여 dataURL 로 돌려준다. 비율이 어긋나면 가운데를 잘라 채운다. */
  const resize = (uri, size, type, quality) => page.evaluate(async (uri, size, type, quality) => {
    const img = new Image();
    await new Promise((ok, ng) => { img.onload = ok; img.onerror = ng; img.src = uri; });
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const s = Math.min(img.width, img.height);           // 가운데를 정사각으로 자른다
    g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL(type, quality);
  }, uri, size, type, quality);

  const write = (file, dataUrl) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return fs.statSync(file).size;
  };

  console.log('원본: ' + path.basename(SRC));
  for (const [dpi, size] of Object.entries(MIPMAP)) {
    const out = path.join(ROOT, 'android/app/src/main/res/mipmap-' + dpi, 'ic_launcher.png');
    const n = write(out, await resize(dataUri, size, 'image/png'));
    // 둥근 아이콘도 같은 그림을 쓴다 — 원본이 이미 둥근 사각형이라 따로 만들 것이 없다
    write(path.join(path.dirname(out), 'ic_launcher_round.png'), await resize(dataUri, size, 'image/png'));
    console.log('  mipmap-' + dpi.padEnd(7) + size + 'px  ' + (n / 1024).toFixed(1) + ' KB');
  }

  // 좌측 상단 대표 이미지 — 화면에는 30px 로 보이지만 고해상도 화면을 위해 3배로 만든다
  const brand = write(path.join(ROOT, 'assets', 'brand.webp'), await resize(dataUri, 90, 'image/webp', 0.9));
  console.log('  assets/brand.webp      90px  ' + (brand / 1024).toFixed(1) + ' KB');

  // 탭 아이콘 — HTML 에 인라인되므로 작게 유지한다
  const fav = write(path.join(ROOT, 'assets', 'favicon.png'), await resize(dataUri, 64, 'image/png'));
  console.log('  assets/favicon.png     64px  ' + (fav / 1024).toFixed(1) + ' KB');

  await browser.close();
})();
