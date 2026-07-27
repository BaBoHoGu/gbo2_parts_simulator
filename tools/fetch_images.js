// gbo2.jp 에서 기체/파츠 이미지를 내려받아 assets/images/ 에 저장한다.
// 서버가 없는 이미지에 대해 SPA 의 index.html 을 200 으로 돌려주므로
// RIFF/WEBP 매직으로 실제 이미지인지 검사한다.
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'images');
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

const msData = readJson('data', 'msData.json');
const parts = readJson('data', 'parts.json');

const baseName = n => n.replace(/_LV\d+$/i, '').trim();

// 사이트가 쓰는 대체 표기 (그리스문자/전각을 라틴으로)
const romanize = n => n
  .replace(/[ΖζＺｚZz]/g, 'Z').replace(/[ΝνＶｖVv]/g, 'V')
  .replace(/[ΑαＡａAa]/g, 'A').replace(/[ΣσＳｓSs]/g, 'S')
  .replace(/[ΕεＥｅEe]/g, 'E').replace(/[ΩωＯｏOo]/g, 'O');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

const isWebp = buf =>
  buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF'
  && buf.slice(8, 12).toString('latin1') === 'WEBP';

/** 후보 URL 을 순서대로 시도해 처음으로 진짜 webp 인 것을 저장한다. */
async function fetchFirst(candidates, dest) {
  for (const name of candidates) {
    const url = `https://gbo2.jp/images/${dest.dir}/${encodeURIComponent(name)}.webp`;
    let res;
    try { res = await get(url); } catch { continue; }
    if (res.status === 200 && isWebp(res.body)) {
      fs.writeFileSync(path.join(OUT, dest.dir, dest.file + '.webp'), res.body);
      return res.body.length;
    }
  }
  return 0;
}

async function run() {
  fs.mkdirSync(path.join(OUT, 'ms'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'parts'), { recursive: true });

  const msNames = [...new Set(msData.map(m => baseName(m.MS名)))].sort();
  const partNames = [...new Set([].concat(...Object.values(parts)).map(p => p.name))].sort();

  // 저장 파일명은 NFC 로 통일한다 (원본에 NFD 결합문자 이름이 섞여 있어 환경에 따라
  // 경로가 어긋나는 것을 막는다). 내려받기 후보(URL)는 원본 표기를 그대로 시도한다.
  const jobs = [
    ...msNames.map(n => ({ dir: 'ms', file: n.normalize('NFC'), candidates: [...new Set([n, romanize(n)])] })),
    ...partNames.map(n => ({ dir: 'parts', file: n.normalize('NFC'), candidates: [...new Set([n, baseName(n)])] }))
  ];

  let ok = 0, miss = 0, bytes = 0;
  const missing = [];
  const CONCURRENCY = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const dest = path.join(OUT, job.dir, job.file + '.webp');
      if (fs.existsSync(dest)) { ok++; bytes += fs.statSync(dest).size; continue; }
      const size = await fetchFirst(job.candidates, { dir: job.dir, file: job.file });
      if (size) { ok++; bytes += size; } else { miss++; missing.push(job.dir + '/' + job.file); }
      if ((ok + miss) % 100 === 0) process.stdout.write(`  ${ok + miss}/${jobs.length}\n`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // 이미지가 없는 항목용 기본 이미지
  for (const dir of ['ms', 'parts']) {
    const res = await get(`https://gbo2.jp/images/${dir}/default.webp`);
    if (isWebp(res.body)) fs.writeFileSync(path.join(OUT, dir, '_default.webp'), res.body);
  }

  console.log(`받음 ${ok} / 없음 ${miss} / 합계 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (missing.length) {
    fs.writeFileSync(path.join(ROOT, 'assets', 'missing.txt'), missing.join('\n'));
    console.log('없는 이미지 목록 -> assets/missing.txt (앞 10개)');
    console.log('  ' + missing.slice(0, 10).join('\n  '));
  }
}

run();
