// 공식 사이트(bo2.ggame.jp)의 기체 일러스트를 받아 assets/illust/ 에 넣는다.
//
//   node tools/fetch_illust.js            빠진 것만 받는다
//   node tools/fetch_illust.js --all      전부 다시 받는다
//   node tools/fetch_illust.js --map      대응만 확인하고 받지는 않는다
//
// 왜 번들에 안 넣고 따로 두는가 — 원본이 750x800 PNG 라 573장이면 61MB 다.
// 360px WebP 로 줄여도 11MB 라, 16MB 짜리 단일 HTML 에 넣으면 OTA 다운로드가
// 매 갱신 두 배가 된다. 그래서 **사이트에 따로 올리고 앱은 URL 로 부른다**.
// <img> 는 CORS 를 타지 않으므로 APK·PC(file://)에서도 인터넷만 되면 뜨고,
// 안 되면 기존 썸네일로 떨어진다(ui.js 의 onerror).
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'illust');
const LIST = 'https://bo2.ggame.jp/jp/ms_stage/ms.php';
const IMG = code => `https://bo2.ggame.jp/jp/images/ms_stage/ms/detail/img_${code}.png`;

const WIDTH = 360;      // 오른쪽 칸이 248px 라 2배 해상도까지만
const QUALITY = 72;

const ALL = process.argv.includes('--all');
const MAP_ONLY = process.argv.includes('--map');

const get = url => new Promise((res, rej) => {
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      return get(new URL(r.headers.location, url).href).then(res, rej);
    }
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(chunks) }));
  }).on('error', rej);
});

/* 이름을 맞추기 위한 정규화.
   공식 사이트와 위키가 같은 기체를 조금씩 다르게 적는다 —
   전각/반각, 가운뎃점, 괄호, 공백. 그 차이만 지우고 견준다. */
const norm = s => String(s)
  .normalize('NFKC')
  .replace(/[・･·]/g, '')
  .replace(/[（）()［］\[\]｛｝{}]/g, '')
  .replace(/[\s　]/g, '')
  // 공식이 하이픈 자리에 장음 「ー」를 쓴다(「ＥｘーＳガンダム」 vs 「Ex-Sガンダム」).
  // 붙임표 종류를 하나로 모은다.
  .replace(/[ー－‐-‒–—―ｰ-]/g, '-')
  .toLowerCase()
  .replace(/ζ/g, 'z')      // ζ (Ζ 를 소문자화한 것)
  .replace(/ν/g, 'v')      // ν
  .replace(/ξ/g, 'xi');    // ξ

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  console.log('■ 공식 목록을 받는다…');
  const list = (await get(LIST)).body.toString('utf8');
  // <li> 덩어리로 끊어 각각에서 코드와 이름을 뽑는다.
  // 링크와 이름을 한 정규식으로 이으면 매치가 겹쳐 뒤 항목이 밀린다(592 중 501 만 잡혔다).
  const official = [];
  for (const block of list.split(/<li[\s>]/)) {
    // 코드에 대문자가 섞인다 — [a-z0-9] 로 잡으면 앞부분만 잘려 34기가 404 났다.
    const c = /ms_detail\.php\?ms=([A-Za-z0-9]+)/.exec(block);
    // 긴 이름은 <br> 로 줄이 나뉜다(「ベルガ・ギロス<br>[Ｂ・Ｖ仕様]」).
    // [^<]+ 로 잡으면 그런 38기가 통째로 빠진다 — 태그를 지우고 읽는다.
    const n = /<dt><span>([\s\S]*?)<\/span>/.exec(block);
    if (n) n[1] = n[1]
      .replace(/<[^>]+>/g, '')
      // 로마 숫자가 &#8544;(Ⅰ)·&#8545;(Ⅱ) 처럼 엔티티로 들어 있다.
      // 안 풀면 자쿠 계열 12기가 통째로 빠진다.
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      // 숫자 말고 **이름** 엔티티도 쓴다(「&Xi;ガンダム」).
      .replace(/&(Xi|Zeta|nu|xi|zeta|Nu);/g,
        (_, k) => ({ Xi: 'Ξ', xi: 'ξ', Zeta: 'Ζ', zeta: 'ζ', Nu: 'Ν', nu: 'ν' }[k]))
      .replace(/&amp;/g, '&').trim();
    if (c && n) official.push({ code: c[1], name: n[1].trim() });
  }
  console.log(`  공식 기체 ${official.length}기`);

  const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
  const bases = [...new Set(msData.map(m => m.MS名.replace(/_LV\d+$/i, '')))];
  console.log(`  우리 기체 ${bases.length}기 (LV 뺀 것)`);

  // 이름으로 맞춘다. 같은 이름이 둘이면 맞추지 않는다 — 틀린 그림이 붙으면 안 된다.
  const byNorm = new Map();
  for (const o of official) {
    const k = norm(o.name);
    if (byNorm.has(k)) byNorm.set(k, null);     // 중복 → 버린다
    else byNorm.set(k, o);
  }
  const pairs = [], missed = [];
  for (const b of bases) {
    const o = byNorm.get(norm(b));
    if (o) pairs.push({ base: b, code: o.code, official: o.name });
    else missed.push(b);
  }
  console.log(`  대응 ${pairs.length}기 · 못 찾음 ${missed.length}기`);
  if (missed.length) console.log('  못 찾은 예: ' + missed.slice(0, 8).join(' / '));
  if (MAP_ONLY) return;

  let got = 0, skip = 0, fail = 0, bytes = 0;
  for (const p of pairs) {
    const dest = path.join(OUT, p.base.normalize('NFC') + '.webp');
    if (!ALL && fs.existsSync(dest)) { skip++; continue; }
    try {
      const r = await get(IMG(p.code));
      // 없는 이미지에 HTML 을 돌려주는 서버가 있다 — PNG 매직으로 확인한다.
      if (r.status !== 200 || r.body.slice(0, 4).toString('hex') !== '89504e47') { fail++; continue; }
      const buf = await sharp(r.body).resize({ width: WIDTH, withoutEnlargement: true })
        .webp({ quality: QUALITY }).toBuffer();
      fs.writeFileSync(dest, buf);
      got++; bytes += buf.length;
    } catch { fail++; }
    if ((got + fail) % 50 === 0 && got + fail) process.stdout.write(`  … ${got + fail}/${pairs.length}\r`);
  }
  console.log(`\n■ 새로 받음 ${got} · 건너뜀 ${skip} · 실패 ${fail}`);
  const total = fs.readdirSync(OUT).filter(f => f.endsWith('.webp'))
    .reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`  assets/illust  ${fs.readdirSync(OUT).length}장 · ${(total / 1024 / 1024).toFixed(1)}MB`);
})();
