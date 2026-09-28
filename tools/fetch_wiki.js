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
const { fetchWikiHtml } = require('./lib/wiki_fetch.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'raw', 'wiki');
const FORCE = process.argv.includes('--force');
const DELAY_MS = 1200;          // 요청 간 간격
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// gbo2.jp 가 wiki_url 을 비워 보낸 기체(ゴトラタン 등)를 override 로 보정 — 그래야 페이지를 받는다.
const msData = require('./lib/msdata.js').applyWikiOverride(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8')), ROOT);

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

  const needHeadless = [];        // plain https 로 못 받은 것 (대개 Cloudflare) → 헤드리스로 재시도
  const nameById = new Map();
  /* **막혔으면 두드리기를 그만둔다.**
     atwiki 가 Cloudflare 뒤로 들어간 뒤로 plain 은 사실상 다 실패한다 — 그런데도
     페이지마다 요청하고 DELAY_MS 만큼 쉬었다. 11페이지를 받는 실행에서 헛요청 11번과
     13초를 버렸고, 전체 한 바퀴(약 60페이지)면 60번과 72초였다. 차단된 서버를 그만큼
     두드리는 것은 차단이 풀리지 않을 이유이기도 하다. 연속으로 이만큼 실패하면 plain 을
     접고 남은 것은 곧장 헤드리스로 넘긴다.
     (번역기에서 막힌 입구를 한 번만 확인하고 접게 한 것과 같은 처방이다.) */
  const PLAIN_GIVEUP = 3;
  let plainMiss = 0, plainOff = false;
  for (const p of list) {
    const dest = path.join(OUT, p.id + '.html');
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 10000) { skip++; continue; }
    nameById.set(p.id, p.names[0]);
    if (plainOff) { needHeadless.push(p.id); continue; }   // 요청을 안 보내니 쉴 일도 없다
    try {
      const buf = await get(p.url);
      fs.writeFileSync(dest, buf);
      done++;
      plainMiss = 0;               // 하나라도 받았으면 plain 은 살아 있다
    } catch (e) {
      needHeadless.push(p.id);     // 실패는 헤드리스로 넘긴다 (아직 fail 로 세지 않는다)
      if (++plainMiss >= PLAIN_GIVEUP) {
        plainOff = true;
        console.log(`plain 수신이 ${PLAIN_GIVEUP}번 잇달아 실패 — 남은 것은 곧장 헤드리스로 받습니다`);
      }
    }
    if ((done + needHeadless.length) % 25 === 0) {
      process.stdout.write(`\r받는 중 ${done + needHeadless.length + skip}/${list.length} (신규 ${done} · 건너뜀 ${skip} · 헤드리스대기 ${needHeadless.length})`);
    }
    await sleep(DELAY_MS);
  }
  process.stdout.write('\r');

  // Cloudflare 등으로 막힌 것을 헤드리스 Chrome 으로 통과해 받는다 (브라우저 1개 재사용).
  if (needHeadless.length) {
    console.log(`plain 수신 실패 ${needHeadless.length}건 → 헤드리스 Chrome 으로 재시도…`);
    try {
      const r = await fetchWikiHtml(needHeadless, (id, html) => {
        fs.writeFileSync(path.join(OUT, id + '.html'), html);
      });
      done += r.ok.length;
      fail += r.fail.length;
      r.fail.forEach(id => failed.push(id + ' ' + (nameById.get(id) || '') + ' — 헤드리스도 실패'));
    } catch (e) {
      fail += needHeadless.length;
      console.log('헤드리스 수신 불가:', e.message);
      needHeadless.forEach(id => failed.push(id + ' ' + (nameById.get(id) || '') + ' — ' + e.message));
    }
  }

  console.log(`완료 — 전체 ${list.length} · 신규 ${done} · 건너뜀 ${skip} · 실패 ${fail}`);
  if (failed.length) console.log('실패 목록:\n  ' + failed.join('\n  '));
})();
