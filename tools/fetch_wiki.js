// 기체별 위키 페이지를 raw/wiki/ 에 내려받는다 (무장 표 추출용).
//   node tools/fetch_wiki.js               이미 받은 것은 건너뛰고 새 것만
//   node tools/fetch_wiki.js --force       전부 다시 받기
//   node tools/fetch_wiki.js --pages=ID,ID 지정한 페이지만 받기(증분 업데이트용)
//
// atwiki 는 UA 없는 요청을 403 으로 막으므로 브라우저 UA 를 보내고,
// 서버 부담을 줄이려고 요청 사이에 간격을 둔다.
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'raw', 'wiki');
const FORCE = process.argv.includes('--force');
const DELAY_MS = 1200;          // 요청 간 간격
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));

// --pages=ID,ID : 이 페이지들만 받는다 (배포본 증분 업데이트 — 캐시 전체를 받지 않음)
const pagesArg = process.argv.find(a => a.startsWith('--pages='));
const onlyIds = pagesArg ? new Set(pagesArg.slice('--pages='.length).split(',').filter(Boolean)) : null;

// 같은 기체의 LV 변형은 위키 페이지가 같으므로 URL 기준으로 묶는다.
const pages = new Map();
for (const m of msData) {
  if (!m.wiki_url) continue;
  const id = (m.wiki_url.match(/pages\/(\d+)\.html/) || [])[1];
  if (!id) continue;
  if (onlyIds && !onlyIds.has(id)) continue;
  if (!pages.has(id)) pages.set(id, { id, url: m.wiki_url, names: [] });
  pages.get(id).names.push(m.MS名);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  const list = [...pages.values()].slice(0, limit);
  let done = 0, skip = 0, fail = 0;
  const failed = [];

  for (const p of list) {
    const dest = path.join(OUT, p.id + '.html');
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 10000) { skip++; continue; }
    try {
      const buf = await get(p.url);
      fs.writeFileSync(dest, buf);
      done++;
    } catch (e) {
      fail++;
      failed.push(p.id + ' ' + p.names[0] + ' — ' + e.message);
    }
    if ((done + fail) % 25 === 0) {
      process.stdout.write(`\r받는 중 ${done + fail + skip}/${list.length} (신규 ${done} · 건너뜀 ${skip} · 실패 ${fail})`);
    }
    await sleep(DELAY_MS);
  }
  process.stdout.write('\r');
  console.log(`완료 — 전체 ${list.length} · 신규 ${done} · 건너뜀 ${skip} · 실패 ${fail}`);
  if (failed.length) console.log('실패 목록:\n  ' + failed.join('\n  '));
})();
