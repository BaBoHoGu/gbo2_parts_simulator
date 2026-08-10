// 위키(atwiki) 수신 공용 유틸 — Cloudflare "Just a moment" 챌린지를 헤드리스 Chrome 으로 통과한다.
//   plain https 는 이제 전부 403 이라, 시스템 Chrome 을 puppeteer-core 로 띄워 받는다.
// 제공:
//   findChrome()                 시스템 Chrome/Edge 실행 경로 (없으면 null)
//   withBrowser(fn)              브라우저 1개 띄워 fn(browser) 실행 후 정리
//   fetchWikiHtml(ids, onHtml)   pages/{id}.html 들을 받아 onHtml(id, html) 호출
//   resolvePageIds(names)        機体一覧 태그 페이지에서 기체명 → 페이지ID Map
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE = 'https://w.atwiki.jp/battle-operation2';

/** 시스템에 설치된 Chrome/Edge 실행 파일을 찾는다. */
function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && process.env.LOCALAPPDATA.replace(/\\/g, '/') + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch { /* skip */ } }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 브라우저 1개를 띄워 fn 에 넘기고, 끝나면 닫는다. puppeteer-core·Chrome 없으면 예외. */
async function withBrowser(fn) {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { throw new Error('puppeteer-core 가 없습니다. `npm install --no-save puppeteer-core` 후 다시 실행하세요.'); }
  const chrome = findChrome();
  if (!chrome) throw new Error('시스템 Chrome/Edge 를 찾지 못했습니다. 환경변수 CHROME_PATH 로 지정하세요.');
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1300,900']
  });
  try { return await fn(browser); } finally { await browser.close().catch(() => {}); }
}

/** 새 탭을 만들고 봇 탐지 회피 설정을 건다. */
async function newPage(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja,en-US;q=0.9' });
  return page;
}

/** 챌린지("Just a moment")가 풀릴 때까지 기다린다. 풀리면 true. */
async function waitClear(page, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const t = await page.title().catch(() => '');
    if (t && !/just a moment|attention required|cloudflare/i.test(t)) return true;
    await sleep(2000);
  }
  return false;
}

/**
 * pages/{id}.html 들을 헤드리스로 받아 onHtml(id, html) 를 호출한다.
 * @param {string[]} ids  페이지 ID 목록
 * @param {(id:string, html:string)=>void} onHtml
 * @returns {Promise<{ok:string[], fail:string[]}>}
 */
async function fetchWikiHtml(ids, onHtml) {
  const uniq = [...new Set(ids.map(String))];
  if (!uniq.length) return { ok: [], fail: [] };
  return withBrowser(async browser => {
    const page = await newPage(browser);
    const ok = [], fail = [];
    for (const id of uniq) {
      try {
        await page.goto(`${BASE}/pages/${id}.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (!(await waitClear(page))) { fail.push(id); continue; }
        const html = await page.content();
        onHtml(id, html);
        ok.push(id);
      } catch { fail.push(id); }
      await sleep(400);
    }
    return { ok, fail };
  });
}

/**
 * 機体一覧 태그 페이지에서 (기체명 → 페이지ID) 매핑을 만든다.
 * gbo2.jp 가 wiki_url 을 비워 보낸 신기체의 페이지를 이름으로 찾는 데 쓴다.
 * @returns {Promise<Map<string,string>>}
 */
async function resolvePageIds() {
  return withBrowser(async browser => {
    const page = await newPage(browser);
    await page.goto(`${BASE}/tag/機体一覧`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitClear(page);
    const pairs = await page.evaluate(() => [...document.querySelectorAll('a[href*="pages/"]')]
      .map(a => ({ name: a.textContent.trim(), id: (a.getAttribute('href').match(/pages\/(\d+)\.html/) || [])[1] }))
      .filter(x => x.id && x.name && !x.name.includes('/')));   // ログ 등 하위 페이지 제외
    const map = new Map();
    for (const { name, id } of pairs) if (!map.has(name)) map.set(name, id);   // 첫 등장 우선
    return map;
  });
}

module.exports = { findChrome, withBrowser, fetchWikiHtml, resolvePageIds };
