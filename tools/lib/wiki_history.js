// 위키(atwiki) 기체 페이지의 「アップデート履歴」를 날짜별로 읽는다.
//
// 왜 — **공식 공지는 수치를 생략한다.** 「비틀거림 축적치 상승」처럼 올랐다는 말만 적고
// 얼마에서 얼마로인지는 안 적는다. 그 수치가 위키에 날짜별로 있다.
// 게다가 위키는 **LV 별로** 적는다(공식은 대표값 하나뿐):
//     機体HP上昇 → LV1：23000 → 25000　LV2：25000 → 28000　LV3：27000 → 31000
//
// 옆 프로젝트 `개인 개발/BP` 의 atwiki.py 가 같은 일을 한다(읽기 전용 참고).
// 거기서 가져온 것: 날짜 항목은 **최상위 <li>** 이고 다음 최상위 날짜 직전까지가 한 덩어리다.
// 고정 길이로 자르면 긴 조정이 잘린다.
//
// 받아 둔 캐시(raw/wiki/*.html)만 읽는다 — 네트워크를 쓰지 않는다.
// 조정 기체 82기 전부가 캐시에 제 날짜 항목을 갖고 있다(2026-10-09 실측, 100%).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const WIKI = path.join(ROOT, 'raw', 'wiki');

/** 날짜 줄만 최상위에 온다: 「2026/07/23：性能調整」 */
const DATE_RE = /(20\d\d)\/(\d{1,2})\/(\d{1,2})/;
const slashOf = ymd => {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[1] + '/' + String(Number(m[2])) + '/' + String(Number(m[3])) : '';
};

/** 페이지 HTML 에서 「アップデート履歴」 절만 */
function historySection(html) {
  const m = String(html).match(
    /<h2 id="[^"]+">アップデート履歴<\/h2>([\s\S]*?)(?:<h2 |<div id="wiki_right)/);
  return m ? m[1] : null;
}

/** 그 절에서 날짜 하나의 최상위 <li> 덩어리. 다음 최상위 날짜 직전까지 자른다. */
function entryHtml(section, dateSlash) {
  if (!section) return null;
  /* 위키는 「2026/07/23」처럼 0 을 채워 적기도, 「2026/7/23」처럼 안 채우기도 한다.
     둘 다 찾아본다 — 한 꼴만 보면 멀쩡한 이력을 못 찾고 조용히 비운다. */
  const [y, mo, d] = dateSlash.split('/');
  const cands = [
    y + '/' + mo.padStart(2, '0') + '/' + d.padStart(2, '0'),
    y + '/' + Number(mo) + '/' + Number(d)
  ];
  let i = -1, used = '';
  for (const c of cands) { const k = section.indexOf(c); if (k >= 0) { i = k; used = c; break; } }
  if (i < 0) return null;
  const start = section.lastIndexOf('<li>', i);
  const from = start < 0 ? i : start;
  /* 다음 **최상위** 날짜까지. 안쪽 <li> 에는 날짜가 안 나오므로 날짜만 보면 된다. */
  const rest = section.slice(i + used.length);
  const nx = rest.search(/20\d\d\/\d{1,2}\/\d{1,2}/);
  return section.slice(from, nx < 0 ? section.length : i + used.length + nx);
}

/* 태그를 지우되 글자는 남긴다. `<span id="buff">` 는 **지우기 전에** 표식으로 바꿔 둔다 —
   버프인지 너프인지는 이 span 에만 적혀 있어서, 그냥 지우면 사라진다. */
const BUFF = '\u0001', NERF = '\u0002';
const mark = h => String(h)
  .replace(/<span id="buff">/gi, BUFF).replace(/<span id="nerf">/gi, NERF);
const clean = h => mark(h)
  .replace(/<\/?[a-zA-Z!][^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/**
 * 한 날짜 덩어리 → [{ depth, text, buff }] 계층 그대로.
 * depth 0 = 날짜 줄, 1 = 항목(또는 무장 묶음), 2 이상 = 그 아래 값.
 * buff: true 올림 · false 내림 · null 표식 없음.
 */
function entryLines(entry) {
  if (!entry) return [];
  const out = [];
  let depth = -1;
  /* <ul> 로 들어가고 </ul> 로 나오며, <li> 하나가 한 줄이다.
     여는 <li> 가 빠진 자료는 못 봤지만, 닫는 </li> 가 없는 경우는 흔해서
     **다음 <li>·<ul>·</ul> 경계까지**를 그 줄의 제 글로 본다. */
  const tok = entry.match(/<ul[^>]*>|<\/ul>|<li[^>]*>/gi) || [];
  let pos = 0;
  for (const t of tok) {
    const at = entry.indexOf(t, pos);
    pos = at + t.length;
    if (/^<ul/i.test(t)) { depth++; continue; }
    if (/^<\/ul/i.test(t)) { depth--; continue; }
    // <li> — 다음 경계까지가 이 줄의 제 글
    const nx = entry.slice(pos).search(/<ul[^>]*>|<\/ul>|<li[^>]*>/i);
    const own = nx < 0 ? entry.slice(pos) : entry.slice(pos, pos + nx);
    const txt = clean(own);
    if (!txt) continue;
    const buff = txt.includes(BUFF) ? true : (txt.includes(NERF) ? false : null);
    out.push({
      depth: Math.max(0, depth),
      text: txt.split(BUFF).join('').split(NERF).join('').replace(/\s+/g, ' ').trim(),
      buff
    });
  }
  return out;
}

/** 캐시에서 페이지를 읽는다. 없으면 null. */
function readPage(pageId) {
  const f = path.join(WIKI, String(pageId) + '.html');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

/** 기체 페이지 + 날짜(YYYY-MM-DD) → 그 날의 조정 내역 줄 목록 */
function changesOn(pageId, ymd) {
  const html = readPage(pageId);
  if (!html) return null;
  const sec = historySection(html);
  const ent = entryHtml(sec, slashOf(ymd));
  if (!ent) return null;
  const L = entryLines(ent);
  /* 첫 줄은 날짜 머리(「2026/07/23：性能調整」) — 날짜는 이미 아는 값이라 뺀다. */
  return L.length ? L.slice(1) : [];
}

/** 기체 페이지에 적힌 **모든** 날짜 — 실제 구현일·LV 추가일을 알아내는 쪽에 쓴다. */
function datedEntries(pageId) {
  const html = readPage(pageId);
  if (!html) return [];
  const sec = historySection(html);
  if (!sec) return [];
  const out = [];
  /* 최상위 <li> 중 날짜로 시작하는 것만. 안쪽 값 줄에는 날짜가 안 나온다.
     설명은 **다음 <ul>·<li> 경계까지** 긁어 태그를 지운다. 처음에 `[^<]*` 로 잡았더니
     「抽選配給にて Lv2 ＆ <a>…</a> 追加」에서 링크 앞까지만 들어와 **「追加」가 잘렸고**,
     그 때문에 LV 추가 날짜를 못 찾아 우리 날짜(돌린 날)를 그대로 쓰고 있었다. */
  for (const m of sec.matchAll(/<li[^>]*>\s*(20\d\d)\/(\d{1,2})\/(\d{1,2})\s*[：:]/g)) {
    const pos = m.index + m[0].length;
    const nx = sec.slice(pos).search(/<ul[^>]*>|<\/ul>|<li[^>]*>/i);
    const own = nx < 0 ? sec.slice(pos) : sec.slice(pos, pos + nx);
    out.push({
      date: m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'),
      what: clean(own)
    });
  }
  return out;
}

module.exports = { historySection, entryHtml, entryLines, changesOn, datedEntries, readPage, DATE_RE };
