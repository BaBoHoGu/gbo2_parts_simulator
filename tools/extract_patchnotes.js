// 게임 패치노트(밸런스 조정 · 추가 기체)를 날짜별로 모아 data/patchnotes.json 에 쌓는다.
//
//   node tools/extract_patchnotes.js            최근 6개월 공지를 보고 **합친다**
//   node tools/extract_patchnotes.js --months=12  더 넓게
//   node tools/extract_patchnotes.js --print    쓰지 않고 무엇이 들어갈지만 보여 준다
//
// ■ 왜 쌓는가 — 공식은 공지를 3~5개월치만 남긴다(실측: 2026-10 시점에 5월분까지).
//   매번 받아서 덮으면 **과거 패치가 영영 사라진다.** 그래서 합치고, 지우지 않는다.
//
// ■ 옛 공지도 매번 다시 받는다. 「조정 후」 참조 데이터와 판정(「상정 범위 안」)은
//   조정 당시엔 없고 **다음 밸런스 패치 때 그 글에 덧붙는다**(8월 공지에
//   「결과 보고에 대해(2026/9/24 추가)」가 적혀 있다). 한 번 받고 끝내면 결과가 영영 안 들어온다.
//
// ■ 자료 세 갈래
//   ① 공식 한국어 공지  — 게임 안에서 보이는 말. 번역·요약 없이 그대로 담는다.
//   ② 위키 아카이브     — 공식이 **생략한 수치**. 게다가 LV 별로 적혀 있다
//                         (공식은 대표값 하나뿐). raw/wiki 캐시만 읽는다.
//   ③ 우리 미러 대조    — 어느 기체가 새로 들어왔는지. **날짜는 위키 것을 쓴다** —
//                         우리 기록의 날짜는 「업데이트를 돌린 날」이라 최대 2주 어긋난다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { fetchWikiUrl } = require('./lib/wiki_fetch.js');
const { stripDisambig } = require('./lib/janame.js');
const P = require('./lib/patchnote_parse.js');
const W = require('./lib/wiki_history.js');
const FILL = require('./lib/patchnote_fill.js');

const BASE = 'https://bo2.ggame.jp/kr/';
const DEST = path.join(ROOT, 'data', 'patchnotes.json');
const arg = k => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
const MONTHS = Number(arg('months')) || 6;
const PRINT = process.argv.includes('--print');

/* 이 날부터만 모은다(사용자 지시 2026-10-09).
   그 전 패치는 공식이 공지를 곧 내리고, 우리 추가 기체 기록도 그보다 앞서지 않는다 —
   반쪽짜리 칸이 앞에 쌓이면 레일만 길어지고 읽을 것이 없다.
   이미 쌓아 둔 더 오래된 칸도 여기서 잘라 낸다. */
const SINCE = '2026-08-27';

const rd = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8')); } catch { return null; } };

const msData = rd('data', 'msData.json') || [];

/* 일본어 무장명 → 한국어(우리 무장 사전). 위키 이력의 무장을 공식 줄과 맞댈 때 쓴다. */
const WEAP = rd('data', 'i18n', 'weapons.json') || {};
const jaToKo = ja => WEAP[ja] || null;

/** 기체 줄기 → 위키 페이지 ID */
const pageOf = (() => {
  const m = new Map();
  const put = (name, url) => {
    const base = String(name).replace(/_LV\d+$/, '');
    const id = (String(url || '').match(/pages\/(\d+)/) || [])[1];
    if (id && !m.has(base)) m.set(base, id);
  };
  /* **오버라이드를 먼저** 본다. 새 기체의 wiki_url 은 자동 연결될 때
     data/msData.override.json 에만 적힌다(미러에는 없다) — 거기를 안 보면
     갓 나온 기체의 위키 이력을 통째로 못 읽는다(캐논 건담이 그랬다). */
  const ov = rd('data', 'msData.override.json') || {};
  for (const [name, v] of Object.entries(ov)) put(name, v && v.wiki_url);
  for (const x of msData) put(x['MS名'], x.wiki_url);
  return m;
})();

/* 공식 한국어 이름 → 우리 기체(일본어 줄기). 앱이 쓰는 순서와 같다: 수동 사전이 이긴다.
   꼬리표(「카풀 - カプル」)는 **이름의 일부가 아니다** — 떼고 비교한다(janame.js 한 곳). */
const NM = (() => {
  const I = rd('data', 'i18n', 'ms.json') || {};
  const auto = rd('data', 'i18n', 'ms.auto.json') || {};
  const norm = s => String(s).normalize('NFC')
    .replace(/[\s·・]/g, '').replace(/[［【]/g, '[').replace(/[］】]/g, ']').toLowerCase();
  const stems = [...new Set(msData.map(m => String(m['MS名']).replace(/_LV\d+$/, '')))];
  const map = new Map();
  for (const j of stems) map.set(norm(stripDisambig(I[j] || auto[j] || j)), j);
  return ko => map.get(norm(ko)) || null;
})();

/** 공지 목록에서 「유닛 관련 조정」 글. 한 패치가 타입별로 여러 글일 수 있다(실측: 2026-05-28). */
async function findNotices() {
  const now = new Date();
  const seen = new Map();
  for (let i = 0; i < MONTHS; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0');
    const h = await fetchWikiUrl(BASE + 'info/?cat=0&m=' + ym);
    if (!h) { console.log('  ' + ym + ' 목록을 받지 못했습니다.'); continue; }
    for (const m of h.matchAll(/\?p=(\d+)[\s\S]{0,400}?class="date">([\d.]+)<[\s\S]{0,400}?class="titArticle">([\s\S]*?)<\/span>/g)) {
      const title = m[3].replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
      if (!/유닛\s*(관련\s*)?조정/.test(title)) continue;
      if (m[2].replace(/\./g, '-') < SINCE) continue;
      if (!seen.has(m[1])) seen.set(m[1], { id: m[1], date: m[2].replace(/\./g, '-'), title });
    }
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/* ── 추가 기체의 **진짜 날짜** ───────────────────────────────────────
   우리 events 의 at 은 「업데이트를 돌린 날」이다 — 실측해 보니 위키가 적은 실제 날짜보다
   0~14 일 늦다(07-26 일요일, 08-31 월요일처럼 게임이 갱신하지 않는 요일에도 찍힌다).
   그대로 쓰면 주간 칸이 엉뚱한 날로 갈린다. 위키에서 **그 날 이전의 가장 가까운 추가 기록**을 찾는다.
   못 찾으면 우리 날짜를 그대로 쓰고, 그렇게 썼다는 것을 남긴다(지어내지 않는다). */
const ADD_RE = /追加|新規/;
function realAddDate(ms, ourDate) {
  const id = pageOf.get(ms);
  if (!id) return null;
  const ours = Date.parse(ourDate + 'T00:00:00+09:00');
  let best = null;
  for (const e of W.datedEntries(id)) {
    if (!ADD_RE.test(e.what)) continue;
    const t = Date.parse(e.date + 'T00:00:00+09:00');
    if (t > ours) continue;                       // 우리가 본 날보다 뒤면 그 사건이 아니다
    /* 창을 넓게 둔다. 28일로 조였더니 **미러에 늦게 들어온 기체**를 놓쳤다:
       가브스레이 LV4 는 2026-07-09(DP 교환), 데스티니 건담 LV2 는 2026-08-20(STEAM판)에
       들어왔는데 우리 미러는 10-08 에야 보았다 — 그래서 둘 다 10-08 추가로 적혔고,
       공식 10-08 공지에는 캐논 건담뿐이라 어긋났다(사용자가 짚었다).
       **그 날 이전의 가장 최근 추가 기록**을 고르므로, 멀어도 그것이 맞는 사건이다. */
    if (ours - t > 400 * 86400e3) continue;
    if (!best || t > best.t) best = { t, date: e.date, what: e.what };
  }
  return best;
}

(async () => {
  console.log('■ 공식 한국어 패치노트를 확인합니다… (최근 ' + MONTHS + '개월)');
  const notices = await findNotices();
  if (!notices.length) { console.log('  유닛 조정 공지를 찾지 못해 건너뜁니다.'); return; }

  const byDate = new Map();   // date → { date, ver, articles[], adjusted[], added[] }
  const ent = d => {
    if (!byDate.has(d)) byDate.set(d, { date: d, ver: '', articles: [], adjusted: [], added: [] });
    return byDate.get(d);
  };

  const unmatched = [];
  let wikiHit = 0, wikiMiss = [];
  let fillOk = 0, fillTry = 0;
  for (const a of notices) {
    const html = await fetchWikiUrl(BASE + 'info/?p=' + a.id);
    if (!html) { console.log('  ⚠ p=' + a.id + ' 를 받지 못했습니다.'); continue; }
    if (!P.looksLikePatchnote(html)) { console.log('  ⚠ p=' + a.id + ' 에 기체 마커가 없습니다 — 건너뜁니다.'); continue; }
    const e = ent(a.date);
    e.articles.push({ id: a.id, title: a.title });
    const ver = (html.match(/ver\.([\d.]+)/) || [])[1];
    if (ver && !e.ver) e.ver = ver;
    for (const u of P.parseNotice(html)) {
      const ja = NM(u.name);
      if (!ja) unmatched.push(a.date + ' 「' + u.name + '」');
      /* 위키에서 **그 날짜의 조정 내역**을 가져온다 — 공식이 생략한 수치가 여기 있다. */
      const id = ja ? pageOf.get(ja) : null;
      const wiki = id ? W.changesOn(id, a.date) : null;
      if (wiki && wiki.length) wikiHit++; else if (ja) wikiMiss.push(a.date + ' ' + u.name);
      /* 공식이 **수치를 안 적은 줄**에 위키 값을 단다. 공식 문구는 그대로 두고
         나란한 `fill` 배열에 담는다 — 화면에서 출처가 갈려 보이게 하려는 것이다. */
      const f = FILL.fillSections(u.sections, wiki, jaToKo);
      fillOk += f.filled; fillTry += f.tried;
      e.adjusted.push({ ko: u.name, ms: ja, sections: f.sections, intent: u.intent, ref: u.ref, wiki });
    }
  }

  /* ── 추가 기체를 **제 날짜 칸**에 담는다 (주간 단위) ──────────────── */
  const events = (rd('data', 'patch.json') || {}).events || [];
  let fixed = 0, kept = 0;
  for (const v of events) {
    if (!v || !v.ms) continue;
    const real = realAddDate(v.ms, v.at);
    const date = real ? real.date : v.at;
    if (date < SINCE) continue;   // 범위 밖
    if (real && real.date !== v.at) fixed++; else if (!real) kept++;
    ent(date).added.push({ ms: v.ms, why: v.why, at: date, 날짜출처: real ? '위키' : '우리기록' });
  }
  for (const e of byDate.values()) {
    e.added.sort((a, b) => a.ms.localeCompare(b.ms));
    e.kind = e.adjusted.length ? (e.added.length ? 'both' : 'balance') : 'add';
  }

  // ── 합친다 ──────────────────────────────────────────────────────────
  const prev = rd('data', 'patchnotes.json') || { patches: [] };
  const merged = new Map((prev.patches || []).map(p => [p.date, p]));
  let fresh = 0, grown = 0;
  for (const [d, e] of byDate) {
    const old = merged.get(d);
    if (!old) { fresh++; merged.set(d, e); continue; }
    /* 이미 있는 패치는 **더 많이 아는 쪽**을 남긴다. 받기가 반쯤 실패한 실행이
       멀쩡한 기록을 덮어 깎는 일을 막는다(타입별 분할 공지 하나만 받힌 경우). */
    const better = { ...old, ver: e.ver || old.ver, kind: e.kind || old.kind };
    if (e.adjusted.length >= (old.adjusted || []).length) better.adjusted = e.adjusted;
    if (e.articles.length >= (old.articles || []).length) better.articles = e.articles;
    if ((e.added || []).length >= (old.added || []).length) better.added = e.added;
    if (JSON.stringify(better) !== JSON.stringify(old)) grown++;
    merged.set(d, better);
  }
  const patches = [...merged.values()].filter(p => p.date >= SINCE)
    .sort((a, b) => b.date.localeCompare(a.date));

  const KIND = { balance: '조정', add: '추가', both: '조정+추가' };
  console.log('\n■ 날짜 ' + patches.length + '칸 (새로 ' + fresh + ' · 보강 ' + grown + ')');
  for (const p of patches) {
    console.log('  ' + p.date + '  ' + String(KIND[p.kind] || '').padEnd(9)
      + (p.ver ? 'ver.' + p.ver + '  ' : '            ')
      + '조정 ' + String((p.adjusted || []).length).padStart(2)
      + '기 · 추가 ' + String((p.added || []).length).padStart(2) + '기');
  }
  const withRef = patches.flatMap(p => p.adjusted || []).filter(a => a.ref).length;
  const withAfter = patches.flatMap(p => p.adjusted || [])
    .filter(a => a.ref && (a.ref.rows || []).some(r => /조정\s*후/.test(r.label))).length;
  const tot = patches.flatMap(p => p.adjusted || []).length;
  console.log('\n  참조 데이터 ' + withRef + '/' + tot + '기 · 그중 「조정 후」까지 들어온 것 ' + withAfter + '기');
  console.log('  위키 수치 ' + wikiHit + '/' + tot + '기');
  console.log('  공식이 생략한 수치를 위키에서 채운 줄 ' + fillOk + '/' + fillTry
    + '  (' + (fillTry ? (fillOk / fillTry * 100).toFixed(1) : 0) + '%)');
  console.log('  추가 기체 날짜 — 위키 날짜로 고친 것 ' + fixed + '건 · 우리 날짜를 그대로 쓴 것 ' + kept + '건');
  if (wikiMiss.length) console.log('  위키 수치를 못 찾은 기체 (앞 6): ' + wikiMiss.slice(0, 6).join(' | '));
  if (unmatched.length) {
    console.log('\n  ⚠ 우리 기체와 이름이 안 맞는 것 ' + unmatched.length + '건 — 사전을 공식 표기로 맞출 것');
    for (const u of unmatched) console.log('     ' + u);
  }

  if (PRINT) { console.log('\n(--print: 쓰지 않았습니다)'); return; }
  fs.writeFileSync(DEST, JSON.stringify({
    확인일: new Date().toISOString().slice(0, 10),
    출처: '공식 한국어 공지 bo2.ggame.jp/kr (유닛 관련 조정) + 위키 아카이브 업데이트 이력',
    patches
  }, null, 1) + '\n');
  console.log('\n→ data/patchnotes.json ' + (fs.statSync(DEST).size / 1024).toFixed(0) + 'KB');
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
