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
const JPF = require('./lib/patchnote_jp.js');
const WTR = require('./lib/wiki_tr.js');

const BASE = 'https://bo2.ggame.jp/kr/';
/* 같은 공지의 **일본어판**. 위키 이력도 일본어라, 무장 이름을 번역하지 않고 맞댈 수 있다. */
const JP_BASE = 'https://bo2.ggame.jp/jp/';
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

/* 공식 **일본어** 이름 → 우리 기체. 한국어 이름보다 먼저 쓴다.
   한국어 이름은 겹친다 — カプル 와 カプール 가 둘 다 「카풀」이라, 한국어로 찾으면 늘 한쪽(맵에 나중에 든 쪽)으로 갔다.
   2026-10-29 공지의 カプル 조정이 カプール 에 붙어 패치노트 화면 · 공식 대조가 다 틀렸다(사용자 지적으로 확인).
   일본어끼리는 표기만 맞추면 된다: 전각→반각(NFKC) · 공백/가운뎃점 · 괄호꼴 · 그리스 Ζ ↔ 라틴 Z(공식은 Ｚ, 위키는 Ζ). */
const JNM = (() => {
  const norm = s => String(s).normalize('NFKC').replace(/Ζ/g, 'Z')
    .replace(/[\s·・]/g, '').replace(/[［【]/g, '[').replace(/[］】]/g, ']').toLowerCase();
  const map = new Map();
  for (const m of msData) { const j = String(m['MS名']).normalize('NFC').replace(/_LV\d+$/, ''); map.set(norm(j), j); }
  return ja => (ja ? map.get(norm(ja)) || null : null);
})();

/** 공지 목록에서 「유닛 관련 조정」 글. 한 패치가 타입별로 여러 글일 수 있다(실측: 2026-05-28).
 *  일본어판은 같은 틀에 제목만 다르다(실측: /jp/ 목록이 /kr/ 과 같은 HTML). */
const TITLE = { kr: /유닛\s*(관련\s*)?조정/, jp: /ユニット\s*(関連の)?調整/ };

/* ── 기체별 참조 데이터(data/ms_refs.json) — 파츠 화면 「업데이트 이력」 의 조정 항목 아래 표 ──
   패치노트 화면은 SINCE 부터지만, 참조 데이터는 **공식에 남아 있는 공지 전부**에서 모은다(2026-11-16 사용자 지시).
   공식 목록은 `info/?cat=0&m=YYYYMM` 으로 월을 바꾸면 옛 공지가 보인다(실측: 2025-12 까지, 그 전 달은 비어 있다).
   공식이 공지를 내리면 다시 못 받으므로 **한 번 받은 것은 지우지 않는다.**
   최근 MONTHS 달은 매번 보고, 그보다 옛 달은 한 번 훑으면 `listed` 에 적어 다시 안 본다 — 배포 시간을 아낀다. */
const REFS = path.join(ROOT, 'data', 'ms_refs.json');
/* 서비스 시작(2018-07)까지 거슬러 본다. **빈 달에서 멈추지 않는다** — 한국어 목록은 2025-06 ~ 11 이 비어 있는데
   그 너머 2019-04 까지 공지가 있다(2026-11-16 실측. 처음엔 빈 달 넷에서 멈춰 그 전부를 놓쳤다). */
const REF_FROM = '201807';
const refsPrev = (() => { try { return JSON.parse(fs.readFileSync(REFS, 'utf8')); } catch { return { listed: [], notices: {}, byPage: {} }; } })();
const listedOld = new Set(refsPrev.listed || []);

async function findNotices(lang) {
  const base = lang === 'jp' ? JP_BASE : BASE;
  const now = new Date();
  const seen = new Map();
  for (let i = 0; ; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0');
    if (ym < REF_FROM) break;
    const old = i >= MONTHS;
    if (old && listedOld.has(lang + ym)) continue;           // 옛 달은 한 번만 본다
    const h = await fetchWikiUrl(base + 'info/?cat=0&m=' + ym);
    if (!h) { console.log('  ' + ym + ' 목록을 받지 못했습니다.'); continue; }
    const items = [...h.matchAll(/\?p=(\d+)[\s\S]{0,400}?class="date">([\d.]+)<[\s\S]{0,400}?class="titArticle">([\s\S]*?)<\/span>/g)];
    if (old) listedOld.add(lang + ym);
    for (const m of items) {
      const title = m[3].replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
      if (!TITLE[lang || 'kr'].test(title)) continue;
      if (!seen.has(m[1])) seen.set(m[1], { id: m[1], date: m[2].replace(/\./g, '-'), title });
    }
  }
  /* 한 번 보고 지나간 옛 달의 공지도 잊지 않는다 — 참조 데이터를 다시 받을지 판단하려면 목록이 있어야 한다 */
  for (const [key, a] of Object.entries(refsPrev.notices || {})) {
    const [lg, id] = key.split(':');
    if (lg === (lang || 'kr') && id && !seen.has(id)) seen.set(id, { id, date: a.date, title: a.title });
  }
  return [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** 한 기체의 한국어 공지(u)와 같은 순번의 일본어 공지(jp)를 자리째 맞댄다.
 *  섹션 수 · 행 수 · 줄 수가 다 같고, 줄마다 **숫자 나열**까지 같아야 짝으로 본다 —
 *  수만 같으면 밀린 자리가 우연히 통과한다(memory: jp-official-bridge). 아니면 null. */
const digitsOf = s => (String(s).normalize('NFKC').match(/\d+(?:\.\d+)?/g) || []).join(',');
function mirrorJa(u, jp) {
  const ks = u.sections || [], js = jp.sections || [];
  if (ks.length !== js.length) return null;
  for (let i = 0; i < ks.length; i++) {
    const kr = ks[i].rows || [], jr = js[i].rows || [];
    if (kr.length !== jr.length) return null;
    for (let j = 0; j < kr.length; j++) {
      const kc = kr[j].changes || [], jc = jr[j].changes || [];
      if (kc.length !== jc.length) return null;
      for (let k = 0; k < kc.length; k++) if (digitsOf(kc[k]) !== digitsOf(jc[k])) return null;
    }
  }
  const ref = u.ref && jp.ref && (jp.ref.rows || []).length === (u.ref.rows || []).length ? jp.ref : null;
  return {
    name: jp.name,
    sections: js.map(s => ({ header: s.header, rows: (s.rows || []).map(r => ({ category: r.category, weapon: r.weapon, changes: r.changes })) })),
    intent: jp.intent || [],
    ...(ref ? { ref } : {})
  };
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
  const allKr = await findNotices('kr');
  /* 패치노트 화면(날짜 레일)은 SINCE 부터만 — 사용자가 정한 값이다. 그 전 공지는 참조 데이터에만 쓴다. */
  const notices = allKr.filter(a => a.date >= SINCE);
  if (!allKr.length) { console.log('  유닛 조정 공지를 찾지 못해 건너뜁니다.'); return; }

  /* ── 같은 공지의 **일본어판**을 함께 받는다 ──────────────────────────
     위키 이력은 일본어다. 한국어 공지와 맞대려면 무장 이름을 사전으로 옮겨야 하는데
     그 사전에 없는 이름이 많아 거기서 막혔다(실측 112/166). 일본어판을 거치면
     번역이 아니라 표기 통일만 남는다(159/166). 공식은 KR/JP 를 같은 틀로 찍어 내므로
     `▼N機目▼` 순번으로 자리가 맞는다 — 기체·섹션·행·줄까지 실측으로 전부 1:1 이었다.
     한 날짜에 글이 여러 개면 **번호 순서**로 짝짓고, 개수가 다르면 그 날짜는 쓰지 않는다. */
  console.log('■ 같은 공지의 일본어판을 확인합니다…');
  const jpNotices = await findNotices('jp');
  const jpByDate = new Map();
  for (const a of jpNotices) {
    if (!jpByDate.has(a.date)) jpByDate.set(a.date, []);
    jpByDate.get(a.date).push(a);
  }
  const krByDate = new Map();
  for (const a of allKr) {
    if (!krByDate.has(a.date)) krByDate.set(a.date, []);
    krByDate.get(a.date).push(a);
  }
  const jpOf = new Map();              // KR 글 id → JP 글 id
  for (const [date, ks] of krByDate) {
    const jsx = jpByDate.get(date) || [];
    if (!jsx.length) { console.log('  · ' + date + ' 일본어판이 없습니다 — 한국어만으로 채웁니다.'); continue; }
    if (jsx.length !== ks.length) { console.log('  ⚠ ' + date + ' 글 수가 다릅니다(KR ' + ks.length + ' / JP ' + jsx.length + ') — 이 날짜는 한국어만으로 채웁니다.'); continue; }
    const kk = [...ks].sort((x, y) => Number(x.id) - Number(y.id));
    const jj = [...jsx].sort((x, y) => Number(x.id) - Number(y.id));
    for (let i = 0; i < kk.length; i++) jpOf.set(kk[i].id, jj[i].id);
  }
  const jpCache = new Map();
  const jpSectionsOf = async (krId, idx) => {
    const jid = jpOf.get(krId);
    if (!jid) return null;
    if (!jpCache.has(jid)) {
      const h = await fetchWikiUrl(JP_BASE + 'info/?p=' + jid);
      /* 옛 틀(기체 구분 주석 없음)도 parseNotice 가 읽는다 — 이름 맞추기에 일본어 이름을 쓰려고 */
      jpCache.set(jid, h ? P.parseNotice(h) : null);
    }
    const arr = jpCache.get(jid);
    return arr && arr[idx] ? arr[idx] : null;
  };

  const byDate = new Map();   // date → { date, ver, articles[], adjusted[], added[] }
  const ent = d => {
    if (!byDate.has(d)) byDate.set(d, { date: d, ver: '', articles: [], adjusted: [], added: [] });
    return byDate.get(d);
  };

  const unmatched = [];
  const nameSplit = [];   // 한국어 이름과 일본어 이름이 다른 기체를 가리킨 것
  let wikiHit = 0, wikiMiss = [];
  let fillOk = 0, fillTry = 0;
  let jpUsed = 0; const jpSkip = [];
  let jaMirrored = 0; const jaOff = [];
  const krHtml = new Map();            // 받은 한국어 공지 — 참조 데이터 단계가 다시 받지 않게
  for (const a of notices) {
    const html = await fetchWikiUrl(BASE + 'info/?p=' + a.id);
    if (html) krHtml.set(a.id, html);
    if (!html) { console.log('  ⚠ p=' + a.id + ' 를 받지 못했습니다.'); continue; }
    if (!P.looksLikePatchnote(html)) { console.log('  ⚠ p=' + a.id + ' 에 기체 마커가 없습니다 — 건너뜁니다.'); continue; }
    const e = ent(a.date);
    e.articles.push({ id: a.id, title: a.title });
    const ver = (html.match(/ver\.([\d.]+)/) || [])[1];
    if (ver && !e.ver) e.ver = ver;
    const krUnits = P.parseNotice(html);
    for (let ui = 0; ui < krUnits.length; ui++) {
      const u = krUnits[ui];
      /* 일본어판의 같은 순번 항목 이름으로 먼저 찾는다(JNM) — 한국어 이름이 겹치는 기체(카풀) 때문.
         못 찾으면 한국어 이름으로 물러선다. 둘이 다른 기체를 가리키면 남겨 둔다(순번 짝이 어긋났을 수도 있다). */
      const jpUnit = await jpSectionsOf(a.id, ui);
      const byJp = jpUnit ? JNM(jpUnit.name) : null, byKo = NM(u.name);
      const ja = byJp || byKo;
      if (byJp && byKo && byJp !== byKo) nameSplit.push(a.date + ' 「' + u.name + '」 한국어→' + byKo + ' · 일본어 「' + jpUnit.name + '」→' + byJp + ' (일본어를 씀)');
      if (!ja) unmatched.push(a.date + ' 「' + u.name + '」');
      /* 위키에서 **그 날짜의 조정 내역**을 가져온다 — 공식이 생략한 수치가 여기 있다. */
      const id = ja ? pageOf.get(ja) : null;
      /* 위키 이력을 한국어로 옮겨 함께 담는다. **공식 표기가 이긴다** —
         사전에 없는 말은 원문 그대로 남는다(지어내지 않는다). */
      const wiki = WTR.trLines(id ? W.changesOn(id, a.date) : null);
      if (wiki && wiki.length) wikiHit++; else if (ja) wikiMiss.push(a.date + ' ' + u.name);
      /* 공식이 **수치를 안 적은 줄**에 위키 값을 단다. 공식 문구는 그대로 두고
         나란한 `fill` 배열에 담는다 — 화면에서 출처가 갈려 보이게 하려는 것이다.

         ■ **일본어판을 거친다.** 둘 다 일본어라 무장 이름이 번역 없이 붙는다.
           실측(2026-10-12, 3개 날짜 158줄): 한국어 경로 136 / 일본어 경로 154.
           게다가 한국어 경로가 **틀리게 채운 자리 셋**을 바로잡는다 —
           리미터 해제에 통상 값, 【헤비 어택】에 통상 격투 값(F89·기라 줄루).
         ■ 자리가 어긋나면 손대지 않고 한국어 경로로 물러선다. 틀린 수치는 없는 것만 못하다. */
      // jpUnit 은 위에서 받았다(기체 연결에 먼저 쓴다)
      let f = null;
      if (jpUnit && wiki && wiki.length) {
        const r = JPF.fillByJp(u.sections, jpUnit.sections, wiki);
        if (r.skipped) jpSkip.push(a.date + ' ' + u.name);
        else { f = r; jpUsed++; }
      }
      if (!f) f = FILL.fillSections(u.sections, wiki, jaToKo);
      fillOk += f.filled; fillTry += f.tried;
      /* 일본어 모드(?lang=ja)가 보일 **공식 일본어 원문**을 같이 담는다 — 번역하지 않는다.
         같은 자리(섹션·행·줄)로 짝지으므로 줄 수와 숫자 나열이 다 맞을 때만 담는다. 어긋나면 없다(화면은 한국어). */
      const jaSide = jpUnit ? mirrorJa(u, jpUnit) : null;
      if (jaSide) jaMirrored++; else if (jpUnit) jaOff.push(a.date + ' ' + u.name);
      e.adjusted.push({ ko: u.name, ms: ja, sections: f.sections, intent: u.intent, ref: u.ref, wiki, ...(jaSide ? { ja: jaSide } : {}) });
    }
  }

  /* ── 기체별 참조 데이터 → data/ms_refs.json ─────────────────────────
     패치노트 화면과 같은 자(파서 · 기체 이름 맞추기 · 일본어판 짝)로 읽는다. 위키 페이지 번호로 묶는다 —
     「업데이트 이력」 칸이 그 번호로 기체를 찾는다. 「조정 후」 줄은 다음 패치 때 덧붙으므로
     그 줄이 다 들어온 옛 공지(complete)만 다시 안 받는다. 붙이는 규칙은 tools/lib/history_refs.js. */
  const refNotices = { ...(refsPrev.notices || {}) };
  const byPage = JSON.parse(JSON.stringify(refsPrev.byPage || {}));
  const hasAfter = r => ((r && r.rows) || []).some(x => /조정\s*후/.test(x.label));
  let refGot = 0, refSkip = 0;
  const refUnmatched = [];
  for (const a of allKr) {
    const key = 'kr:' + a.id;
    if (a.date < SINCE && refNotices[key] && refNotices[key].complete) { refSkip++; continue; }
    const html = krHtml.get(a.id) || await fetchWikiUrl(BASE + 'info/?p=' + a.id);
    if (!html) continue;
    const units = P.parseNotice(html);           // 옛 틀(2021 ~ 2025-05)은 parseLegacy 로 읽는다
    /* 참조 데이터 표가 하나도 없는 공지(2018 ~ 2020)는 다시 볼 일이 없다 */
    if (!units.some(u => u.ref)) { refNotices[key] = { date: a.date, title: a.title, complete: true, noRef: true }; continue; }
    let complete = units.length > 0;
    /* 일본어판은 **같은 수로 갈렸을 때만** 자리로 짝짓는다 — 옛 틀은 주석 번호가 없어 한쪽만 더 갈리면 짝이 밀려
       엉뚱한 기체에 표가 붙는다. 어긋나면 한국어 이름으로만 찾는다. */
    await jpSectionsOf(a.id, 0);
    const jpArr = jpOf.has(a.id) ? jpCache.get(jpOf.get(a.id)) : null;
    const jpOk = !!jpArr && jpArr.length === units.length;
    /* 「문 건담(바르길용 빔 라이플[GN] 장비 시)」 — 무장 조정 절의 기체 이름. 찾을 때만 장비 꼬리를 뗀다(화면엔 그대로) */
    /* 옛 공식 한국어 표기 → 지금 사전 표기. 공식이 몇 년 사이 표기를 바꿨다 — 본 것만 적는다(2026-11-16 실측) */
    const OLD_KO = [[/^아쿠트 자쿠/, '액트 자쿠']];
    const bare = s => OLD_KO.reduce((x, [re, to]) => x.replace(re, to),
      String(s || '').replace(/\s*[（(][^（）()]*(장비\s*시|装備時)[)）]\s*$/, ''));
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui];
      if (!u.ref) { complete = false; continue; }
      const jpUnit = jpOk ? jpArr[ui] : null;
      const ja = (jpUnit ? JNM(jpUnit.name) || JNM(bare(jpUnit.name)) : null) || NM(u.name) || NM(bare(u.name));
      const pid = ja ? pageOf.get(ja) : null;
      if (!pid) { refUnmatched.push(a.date + ' ' + u.name); complete = false; continue; }
      /* 일본어 모드는 일본어판 표를 보인다 — 줄 수가 같을 때만(자리가 어긋나면 한국어 표) */
      const refJa = jpUnit && jpUnit.ref && (jpUnit.ref.rows || []).length === (u.ref.rows || []).length ? jpUnit.ref : null;
      const rec = { d: a.date, ms: ja, ko: u.name, ref: u.ref, ...(refJa ? { refJa } : {}) };
      const list = byPage[pid] || (byPage[pid] = []);
      const k = list.findIndex(x => x.d === a.date && x.ko === u.name);
      /* 더 많이 아는 쪽을 남긴다 — 반쯤 실패한 실행이 「조정 후」 줄을 깎지 않게 */
      if (k < 0) list.push(rec);
      else if ((rec.ref.rows || []).length >= (list[k].ref.rows || []).length) list[k] = rec;
      refGot++;
      if (!hasAfter(u.ref)) complete = false;
    }
    /* 반년 지난 공지는 더 덧붙지 않는다 — 「조정 후」 가 끝내 없는 기체가 있어도 다시 받지 않는다(배포마다 수십 개를 다시 받게 된다) */
    const settled = a.date < new Date(Date.now() - 183 * 86400e3).toISOString().slice(0, 10);
    refNotices[key] = { date: a.date, title: a.title, complete: complete || settled };
  }
  /* 한국어판이 **없는** 날짜의 일본어 공지 — 2025-11-20 조정(글 3개)은 한국어 목록에 아예 없다(2025-06 ~ 11 이 비어 있다).
     일본어 표만으로 담고(ref 없음 · refJa · jpOnly), 화면은 「일본어판 공지」 라고 밝혀 보인다. 번역해 지어내지 않는다. */
  const krDates = new Set(allKr.map(a => a.date));
  for (const a of jpNotices) {
    const key = 'jp:' + a.id;
    if (krDates.has(a.date)) { if (!refNotices[key]) refNotices[key] = { date: a.date, title: a.title }; continue; }
    if (a.date < SINCE && refNotices[key] && refNotices[key].complete) { refSkip++; continue; }
    const h = await fetchWikiUrl(JP_BASE + 'info/?p=' + a.id);
    if (!h) continue;
    const units = P.parseNotice(h);
    if (!units.some(u => u.ref)) { refNotices[key] = { date: a.date, title: a.title, complete: true, noRef: true }; continue; }
    let complete = true;
    for (const u of units) {
      if (!u.ref) continue;
      const ja = JNM(u.name) || JNM(String(u.name).replace(/\s*[（(][^（）()]*装備時[)）]\s*$/, ''));
      const pid = ja ? pageOf.get(ja) : null;
      if (!pid) { refUnmatched.push(a.date + ' (JP) ' + u.name); continue; }
      const rec = { d: a.date, ms: ja, ko: u.name, ref: null, refJa: u.ref, jpOnly: true };
      const list = byPage[pid] || (byPage[pid] = []);
      const k = list.findIndex(x => x.d === a.date && x.ko === u.name);
      if (k < 0) list.push(rec); else list[k] = rec;
      refGot++;
      if (!(u.ref.rows || []).some(x => /調整後/.test(x.label))) complete = false;
    }
    const settled = a.date < new Date(Date.now() - 183 * 86400e3).toISOString().slice(0, 10);
    refNotices[key] = { date: a.date, title: a.title, complete: complete || settled };
  }
  for (const list of Object.values(byPage)) list.sort((x, y) => y.d.localeCompare(x.d));
  {
    const recs = Object.values(byPage).flat();
    console.log('\n■ 기체별 참조 데이터 — 공지 ' + Object.keys(refNotices).filter(k => k.startsWith('kr:')).length + '개 · 기체 ' + Object.keys(byPage).length
      + '개 페이지 · 표 ' + recs.length + '개(그중 「조정 후」 ' + recs.filter(r => hasAfter(r.ref)).length + ')'
      + ' · 이번에 읽음 ' + refGot + ' · 다 들어와 건너뜀 공지 ' + refSkip
      + ' · 가장 오래된 ' + (recs.map(r => r.d).sort()[0] || '-'));
    if (refUnmatched.length) console.log('  ⚠ 위키 페이지를 못 찾은 기체 ' + refUnmatched.length + ': ' + refUnmatched.slice(0, 8).join(' | '));
  }
  if (!PRINT) {
    const ids = Object.keys(byPage).sort((x, y) => Number(x) - Number(y));
    fs.writeFileSync(REFS, '{\n "listed": ' + JSON.stringify([...listedOld].sort()) + ',\n "notices": ' + JSON.stringify(refNotices)
      + ',\n "byPage": {\n' + ids.map(id => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(byPage[id])).join(',\n') + '\n }\n}\n');
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
  {
    const all = patches.flatMap(p => (p.adjusted || []).flatMap(a => a.wiki || []));
    const left = all.filter(x => WTR.hasJa(x.ko != null ? x.ko : x.text)).length;
    console.log('  위키 이력 한글화 ' + (all.length - left) + '/' + all.length
      + '  (' + (all.length ? ((all.length - left) / all.length * 100).toFixed(1) : 0) + '%)');
    if (left) console.log('    남은 일본어 ' + left + '줄 — data/i18n/wiki_terms.json 에 용어를 더하세요');
  }
  console.log('  공식이 생략한 수치를 위키에서 채운 줄 ' + fillOk + '/' + fillTry
    + '  (' + (fillTry ? (fillOk / fillTry * 100).toFixed(1) : 0) + '%)');
  console.log('  그 가운데 일본어판을 거친 기체 ' + jpUsed + '기'
    + (jpSkip.length ? ' · 자리가 어긋나 한국어로 물러선 기체 ' + jpSkip.length + '기: ' + jpSkip.join(', ') : ''));
  console.log('  일본어 원문을 같이 담은 기체 ' + jaMirrored + '기'
    + (jaOff.length ? ' · 자리가 어긋나 못 담은 기체 ' + jaOff.length + '기: ' + jaOff.join(', ') : ''));
  console.log('  추가 기체 날짜 — 위키 날짜로 고친 것 ' + fixed + '건 · 우리 날짜를 그대로 쓴 것 ' + kept + '건');
  if (wikiMiss.length) console.log('  위키 수치를 못 찾은 기체 (앞 6): ' + wikiMiss.slice(0, 6).join(' | '));
  if (nameSplit.length) {
    console.log('\n  · 한국어 이름과 일본어 이름이 다른 기체를 가리킨 것 ' + nameSplit.length + '건 (한국어 이름이 겹치는 기체 — 일본어로 이었다):');
    for (const s of nameSplit) console.log('     ' + s);
  }
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
