// 기체별 위키 「アップデート履歴」 전체를 data/ms_history.json 으로 뽑는다 — 파츠 화면 「업데이트 이력」 칸.
//   node tools/extract_ms_history.js          캐시(raw/wiki)만 읽어 만든다 (네트워크 안 씀)
//   node tools/extract_ms_history.js --mt     못 옮긴 줄을 기계 번역해 data/i18n/history.auto.json 에 쌓고 만든다
//
// 줄마다 원문(일본어)과 한국어를 함께 담는다 — 일본어 모드는 원문을 그대로 보인다.
// 한국어로 못 옮긴 줄은 ko 를 비운다(화면은 원문을 보인다). 반쯤 옮긴 글은 넣지 않는다.
// 옮기는 규칙은 tools/lib/history_tr.js 한 곳.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const H = require('./lib/wiki_history.js');
const T = require('./lib/history_tr.js');

const MT = process.argv.includes('--mt');
const OUT = path.join(ROOT, 'data', 'ms_history.json');
const CACHE = path.join(ROOT, 'data', 'i18n', 'history.auto.json');
const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

/** 한 페이지의 날짜 항목들 — 같은 날짜가 둘이어도 따로 읽는다(changesOn 은 첫째만 찾는다). */
function entriesOf(id) {
  const html = H.readPage(id);
  if (!html) return null;
  const sec = H.historySection(html);
  if (!sec) return [];
  const heads = [...sec.matchAll(/<li[^>]*>\s*(20\d\d)\/(\d{1,2})\/(\d{1,2})\s*[：:]/g)];
  const out = [];
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : sec.length;
    const L = H.entryLines(sec.slice(m.index, end));
    if (!L.length) return;
    const what = L[0].text.replace(/^\s*20\d\d\/\d{1,2}\/\d{1,2}\s*[：:]\s*/, '');
    out.push({
      d: m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'),
      what, buff: L[0].buff,
      lines: L.slice(1).map(x => ({ depth: Math.max(0, x.depth - 1), text: x.text, buff: x.buff }))
    });
  });
  return out;
}

/* 갈래 — 화면의 「성능 조정만」 이 이것으로 거른다(판정은 여기 한 곳).
   입수 공지(DP 교환 · 배급 · 보상 · 신규 추가 · 교환 제한 완화)가 날짜 항목의 절반 가까이다. 조정 · 수정이 아닌 그 밖은 입수로 본다.
   「…調整」 · 「…修正」 이 들어가면 조정이다(「100mmマシンガン の調整」 · 「…現象を修正」). */
/* 위키는 같은 날의 입수 공지와 성능 조정을 **한 항목으로 묶어** 적기도 한다 — 머리는 「DP交換窓口に … 追加」,
   그 아래 줄에 「性能調整」(FAZZ 2026-09-24 · 네로 2026-05-28). 머리만 보면 입수로 빠져 「성능 조정만」 에서 사라지고
   공식 참조 데이터가 붙을 자리도 못 찾았다. 아래 줄에 조정 머리가 있으면 조정으로 본다. */
const ADJ_LINE = /^(性能調整|兵装調整|不具合修正|機体調整|バランス調整)/;
const kindOf = (what, lines) => (/調整|修正/.test(what) || (lines || []).some(x => ADJ_LINE.test(String(x.text).trim())) ? 'adj'
  : /追加|緩和|改定|交換|配給|報酬|搭乗可能|プレゼント|入手|配信/.test(what) ? 'get' : 'adj');

/** 기계 번역 — 여러 줄을 줄바꿈으로 이어 한 번에 보내고, 줄 수가 안 맞으면 한 줄씩 다시 보낸다. */
async function machine(list, cache) {
  const { translate, sleep } = require('./lib/mt.js');
  let ok = 0, bad = 0, sent = 0, i = 0;
  const take = (ja, ko) => {
    const k = T.postMT(ja, ko);
    if (T.acceptMT(ja, k)) { cache[ja] = k; ok++; } else bad++;
  };
  const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1) + '\n');
  while (i < list.length) {
    const batch = [];
    let len = 0;
    /* 주소에 실어 보내므로 짧게 — 일본어 한 글자가 9바이트로 불어난다 */
    while (i < list.length && batch.length < 25 && len + list[i].length < 700) { batch.push(list[i]); len += list[i].length + 1; i++; }
    if (!batch.length) batch.push(list[i++]);
    const res = await translate(batch.map(T.prepMT).join('\n'));
    sent++;
    if (res == null) { console.log('  번역 실패 — 입구가 막혔을 수 있습니다. 여기까지 저장하고 멈춥니다.'); break; }
    const parts = res.split(/\r?\n/);
    if (parts.length === batch.length) batch.forEach((ja, k) => take(ja, parts[k]));
    else for (const ja of batch) { const r = await translate(T.prepMT(ja)); sent++; if (r == null) break; take(ja, r); await sleep(250); }
    if (sent % 20 === 0) { save(); console.log(`  … ${i}/${list.length} (받아들임 ${ok} · 버림 ${bad})`); }
    await sleep(300);
  }
  save();
  console.log(`  기계 번역 ${sent}회 — 받아들임 ${ok} · 버림(일본어 남음·숫자 다름) ${bad} · 남은 줄 ${list.length - i}`);
}

(async () => {
  const pages = Object.keys(rd(path.join(ROOT, 'data', 'weapons.json'))).filter(k => /^\d+$/.test(k));
  const cache = rd(CACHE);
  const raw = {};
  /* 위키 캐시(raw/wiki)는 커밋하지 않는다 — 다른 PC 나 캐시를 지운 뒤에는 페이지가 없을 수 있다.
     그때 그 기체의 이력을 **지우지 않고** 지난번 결과를 그대로 둔다(없는 것을 「이력 없음」 으로 덮지 않는다). */
  const prev = rd(OUT);
  const kept = {};
  for (const id of pages) {
    const e = entriesOf(id);
    if (e === null) { if (prev[id]) kept[id] = prev[id]; continue; }
    if (e.length) raw[id] = e;
  }

  if (MT) {
    const need = new Set();
    for (const es of Object.values(raw)) for (const e of es) {
      if (T.koOf(e.what, 'head', cache) == null) need.add(T.NFC(e.what).trim());
      for (const x of e.lines) if (T.koOf(x.text, 'line', cache) == null) need.add(T.NFC(x.text).trim());
    }
    const list = [...need].filter(s => !(s in cache));
    console.log(`■ 기계 번역할 줄 ${list.length}개 (중복 제거)`);
    if (list.length) await machine(list, cache);
  }

  /* 쓰기 — 줄마다 [깊이, 원문, 한국어(같거나 못 옮기면 null), 오름 1 · 내림 -1 · 표식 없음 0].
     페이지 하나를 한 줄로 적는다(파일 전체를 한 줄로 쓰면 diff 를 못 읽는다). */
  let nLine = 0, nKo = 0, nHead = 0, nHeadKo = 0;
  const b = v => (v === true ? 1 : v === false ? -1 : 0);
  const rows = [];
  for (const id of Object.keys(raw).sort((a, c) => Number(a) - Number(c))) {
    const es = raw[id].slice().sort((x, y) => (x.d < y.d ? 1 : x.d > y.d ? -1 : 0));   // 최신이 위
    const enc = es.map(e => {
      const hk = T.koOf(e.what, 'head', cache);
      nHead++; if (hk != null) nHeadKo++;
      return { d: e.d, k: kindOf(e.what, e.lines), h: e.what, hk: hk === e.what ? null : hk, b: b(e.buff),
        l: e.lines.map(x => {
          const ko = T.koOf(x.text, 'line', cache);
          nLine++; if (ko != null) nKo++;
          return [x.depth, x.text, ko === x.text ? null : ko, b(x.buff)];
        }) };
    });
    rows.push([id, JSON.stringify(id) + ':' + JSON.stringify(enc)]);
  }
  for (const id of Object.keys(kept)) rows.push([id, JSON.stringify(id) + ':' + JSON.stringify(kept[id])]);
  rows.sort((a, c) => Number(a[0]) - Number(c[0]));
  if (Object.keys(kept).length) console.log(`  · 위키 캐시가 없어 지난번 이력을 그대로 둔 기체 ${Object.keys(kept).length}기`);
  fs.writeFileSync(OUT, '{\n' + rows.map(r => r[1]).join(',\n') + '\n}\n');
  const pct = (a, c) => (c ? (100 * a / c).toFixed(1) : '0') + '%';
  console.log(`■ 업데이트 이력 ${rows.length}기 — 날짜 ${nHead}개 · 줄 ${nLine}개 → data/ms_history.json (${Math.round(fs.statSync(OUT).size / 1024)}KB)`);
  console.log(`  한국어로 옮긴 것  머리 ${nHeadKo}/${nHead} (${pct(nHeadKo, nHead)}) · 줄 ${nKo}/${nLine} (${pct(nKo, nLine)}) — 나머지는 원문으로 보인다`);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
