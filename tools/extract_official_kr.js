// 공식 한글 사이트(bo2.ggame.jp/kr)의 공지에서 **공식 한글 이름**을 확인한다.
//   node tools/extract_official_kr.js            최근 10일치 공지만 본다
//   node tools/extract_official_kr.js --days=30  기간을 넓힌다
//
// 공식은 기체 목록 페이지를 두지 않는다. 이름이 나오는 곳은 공지 세 종류뿐이다.
//   ① 【업데이트 파일 ver.XXXX】 — 신규 유닛   「･ ★★★★★ Ξ건담 LV1 추가」
//   ② 유닛 관련 조정            — 조정 유닛   이름 다음 줄이 「기체 성능」
//   ③ 추첨 배급 라인업/STEP UP   — 그 밖의 유닛(전부는 아님)
//
// **공식 표기가 위키·커뮤니티 자료보다 우선이다** — 게임 안에서 보이는 이름이다.
// 갱신 파이프라인에서 매번 도는 자리라 기본 창을 좁게(10일) 잡는다. 새 공지만 보면
// 충분하고, 옛 공지는 어차피 공식이 3~5개월치만 남긴다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fetchWikiUrl } = require('./lib/wiki_fetch.js');

const BASE = 'https://bo2.ggame.jp/kr/';
const DEST = path.join(ROOT, 'data', 'official_kr.json');
const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
const DAYS = Number(arg('days')) || 10;

const lines = h => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr|td|th|a)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

// 기체 이름이 아닌 줄
const NOT_NAME = /^(기체 성능|스킬|조정 의도|부무장|주무장|격투 주무장|사격 주무장|■|◎|・|･|※|＜|<|\d|기간|대상|내용|LV\d)/;
// 같은 자리에 나오지만 기체가 아닌 것 — 변형 모드 소제목과 무장 이름
const NOT_MS = /<[^>]*시>$|＜[^＞]*시＞$|용 [^ ]+$|【TB】$/;
const okName = s => s && s.length <= 34 && /[가-힣A-Za-z]/.test(s) && !NOT_NAME.test(s) && !NOT_MS.test(s);

(async () => {
  // ── 최근 DAYS 일치 공지만 고른다 ────────────────────────────────────
  // 목록 markup: <a href="?p=195119">…<span class="date">2026.08.27</span><span class="titArticle">…</span></a>
  const cut = new Date(Date.now() - DAYS * 86400000);
  const now = new Date();
  const arts = new Map();                    // id → { date, title }
  for (let i = 0; i < 2; i++) {              // 이번 달 + 지난달(창이 달을 걸칠 수 있다)
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0');
    const h = await fetchWikiUrl(BASE + 'info/?cat=0&m=' + ym);
    if (!h) { console.log('  ' + ym + ' 목록을 받지 못했습니다.'); continue; }
    for (const m of h.matchAll(/href="\?p=(\d+)"[\s\S]{0,400}?class="date">([\d.]+)<[\s\S]{0,200}?class="titArticle">([\s\S]*?)<\/span>/g)) {
      const dt = new Date(m[2].replace(/\./g, '-') + 'T00:00:00+09:00');
      if (isNaN(dt) || dt < cut) continue;
      if (!arts.has(m[1])) arts.set(m[1], { date: m[2], title: m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    }
  }
  console.log('최근 ' + DAYS + '일 공지 ' + arts.size + '건');
  if (!arts.size) { console.log('  새 공지가 없어 건너뜁니다.'); return; }

  // ── 이름 수집 ───────────────────────────────────────────────────────
  const found = new Map();
  for (const [id, meta] of arts) {
    const h = await fetchWikiUrl(BASE + 'info/?p=' + id);
    if (!h) continue;
    const t = lines(h);
    for (const s of t) {                                   // ① 신규 유닛
      const m = s.match(/★+\s*(.+?)\s*LV\d+\s*추가/);
      if (m && okName(m[1])) found.set(m[1].trim(), '신규 ' + meta.date);
    }
    for (let i = 1; i < t.length; i++) {                   // ② 조정 유닛
      if (t[i] !== '기체 성능') continue;
      const nm = t[i - 1];
      if (okName(nm) && !/타입$/.test(nm)) found.set(nm, '조정 ' + meta.date);
    }
    if (/추첨 배급|라인업|STEP UP/.test(meta.title)) {       // ③ 배급 라인업
      for (const s of t) {
        const m = s.match(/^(?:★+\s*)?(.+?)\s*LV\d+$/);
        if (m && okName(m[1])) found.set(m[1].trim(), '배급 ' + meta.date);
      }
    }
  }
  const names = [...found.keys()].sort();

  // 새로 본 이름을 누적해 둔다(다음 실행 때 이미 확인한 것과 구분하려고)
  let prev = { 이름: [] };
  try { prev = JSON.parse(fs.readFileSync(DEST, 'utf8')); } catch { /* 처음 */ }
  const merged = [...new Set([...(prev.이름 || []), ...names])].sort();
  fs.writeFileSync(DEST, JSON.stringify({ 확인일: new Date().toISOString().slice(0, 10), 이름: merged }, null, 1) + '\n');
  console.log('이번에 본 이름 ' + names.length + '개 (누적 ' + merged.length + ') → data/official_kr.json');

  // ── 우리 사전과 대조 ────────────────────────────────────────────────
  const rd = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
  const I = rd('data', 'i18n', 'ms.json');
  let auto = {}; try { auto = rd('data', 'i18n', 'ms.auto.json'); } catch { /* 없어도 됨 */ }
  const PI = rd('data', 'i18n', 'parts.json');
  const ms = rd('data', 'msData.json');
  const partsByCat = rd('data', 'parts.json');

  const norm = s => String(s).replace(/[\s·・]/g, '').replace(/[［【]/g, '[').replace(/[］】]/g, ']').toLowerCase();
  const stems = [...new Set(ms.map(m => String(m['MS名']).replace(/_LV\d+$/, '')))];
  const msSet = new Set(stems.map(j => norm(I[j] || auto[j] || j)));
  const partSet = new Set();
  for (const arr of Object.values(partsByCat)) for (const p of arr) {
    // 파츠 사전 키에는 _LV 가 붙어 있다. 이름만 떼어 비교한다.
    const ko = ((PI[p.name] && PI[p.name].n) || p.name).replace(/\s*LV\d+$/, '');
    partSet.add(norm(ko));
  }

  const miss = [];
  let okMs = 0, okPart = 0, weapon = 0;
  for (const n of names) {
    if (/용 [^ ]+$/.test(n)) { weapon++; continue; }        // 무장은 사전이 따로다
    const k = norm(n);
    if (msSet.has(k)) { okMs++; continue; }
    if (partSet.has(k)) { okPart++; continue; }
    miss.push(n);
  }
  console.log('  일치 — 기체 ' + okMs + ' · 파츠 ' + okPart + ' · 무장(대조 안 함) ' + weapon);
  if (!miss.length) { console.log('  공식과 다른 이름 없음.'); return; }
  console.log('\n  ⚠ 공식 표기와 다른 이름 ' + miss.length + '건 — 사전을 손볼 것');
  for (const n of miss) console.log('     공식 「' + n + '」   (' + found.get(n) + ')');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
