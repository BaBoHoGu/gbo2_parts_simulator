// 기체별 위키 「アップデート履歴」 전체(2018~)를 한국어로 옮기는 규칙 — extract_ms_history.js 가 쓴다.
//
// 차례 (앞에서 다 옮겨지면 뒤로 안 간다):
//   ① 날짜 머리는 **틀**로 — 「DP交換窓口に ○○ LvN追加」 · 「抽選配給にて …」 · 「性能調整」 같은 꼴이
//      머리 5,537개의 72% 다(2026-11-16 실측). 틀로 옮기면 기체마다 표기가 고르게 나온다.
//      무장 이름은 무장명 사전 → 무장명 규칙(build_weapon_i18n) 순. 하나라도 못 옮기면 틀을 버린다.
//   ② 줄은 위키 이력 한글화 규칙(wiki_tr.trLine) — 최근 패치노트가 쓰는 것과 **같은 자**.
//   ③ 그래도 일본어가 남으면 기계 번역 캐시(data/i18n/history.auto.json, 원문 → 번역).
//      캐시에도 없으면 **원문 그대로** 둔다 — 반쯤 옮긴 글(「爆발範囲를」)은 내지 않는다.
//
// 기계 번역에 보낼 때는 반쯤 옮긴 글이 아니라 **원문**을 보낸다. 스킬 · 무장 이름을 사전으로 먼저 바꾸고
// 게임 용어는 glossary.protect 로 박아 둔다(「よろけ」 가 「쑥쑥」 이 되지 않게). 받은 뒤 post 로 다시 맞추고,
// **숫자가 원문과 하나라도 다르면 버린다** — 수치 기록이라 숫자가 바뀐 번역은 거짓이다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const WTR = require('./wiki_tr.js');
const G = require('./glossary.js');

const NFC = s => String(s == null ? '' : s).normalize('NFC');
const hasJa = WTR.hasJa;

let ruleName = null;
try { ruleName = require('../build_weapon_i18n.js').translate; } catch { ruleName = null; }

/** 무장 이름 하나(LV 꼬리 없이) → 한국어. 못 옮기면 null. */
function weaponNameKo(ja) {
  const s = NFC(ja).trim();
  if (!s) return null;
  const d = WTR.weaponKo(s);
  if (d) return d;
  if (ruleName) { const r = ruleName(s); if (r && !hasJa(r)) return r; }
  return null;
}

/* 날짜 머리의 고정 문구. 공식 한국어 공지의 표기를 따른다(「성능 조정」 · 「DP 교환」). */
const HEAD_FIXED = {
  '性能調整': '성능 조정', '兵装調整': '무장 조정', '不具合修正': '버그 수정', '修正': '수정',
  '新規追加': '신규 추가', 'DP交換制限緩和': 'DP 교환 제한 완화', 'DP交換価格改定': 'DP 교환 가격 개정',
  'βテストで搭乗可能': 'β 테스트에서 탑승 가능', 'バランス調整': '밸런스 조정'
};
/* 「〜として」 · 「〜にて」 · 「〜に」 — 어디서 얻는가. 긴 것부터 맞춘다. */
const HEAD_PLACE = [
  ['クランマッチ上位入賞報酬として', '클랜 매치 상위 입상 보상으로'],
  ['キャンペーン先行入手機体として', '캠페인 선행 입수 기체로'],
  ['リサイクルチケット専用機体として', '리사이클 티켓 전용 기체로'],
  ['期間限定任務報酬として', '기간 한정 임무 보상으로'],
  ['限定任務報酬機体として', '한정 임무 보상 기체로'],
  ['限定任務報酬として', '한정 임무 보상으로'],
  ['先行配信機体として', '선행 배포 기체로'],
  ['初期所有機体として', '초기 소유 기체로'],
  ['DP交換窓口に', 'DP 교환 창구에'],
  ['リサイクル窓口に', '리사이클 창구에'],
  ['抽選配給にて', '추첨 배급으로']
].sort((a, b) => b[0].length - a[0].length);

/** 「100mmマシンガン Lv5 ＆ ビーム・サーベル［先行型］ Lv2」 → 한국어. 이름 하나라도 못 옮기면 null. */
function itemsKo(s) {
  const t = s.trim();
  if (!t) return '';
  const parts = t.split(/\s*[＆&]\s*/);
  const out = [];
  for (const p of parts) {
    const m = p.match(/^(.*?)\s*((?:[LＬ][vｖ]\s*\d+)(?:\s*[～~\-・、,]\s*(?:[LＬ][vｖ])?\s*\d+)*)?$/i);
    if (!m) return null;
    const name = m[1].trim(), lv = (m[2] || '').replace(/[ＬｖＶ]/g, c => ({ 'Ｌ': 'L', 'ｖ': 'v', 'Ｖ': 'V' }[c])).replace(/\s+/g, '');
    if (!name) { out.push(lv); continue; }
    const ko = weaponNameKo(name);
    if (!ko) return null;
    out.push(lv ? ko + ' ' + lv : ko);
  }
  return out.join(' & ');
}

/** 날짜 머리(「DP交換窓口に ロケット・ランチャー Lv3追加」) → 한국어 틀. 틀에 안 맞으면 null. */
function trHead(what) {
  const s = NFC(what).replace(/\s+/g, ' ').trim().replace(/[.．。]$/, '');
  if (!s) return '';
  if (HEAD_FIXED[s]) return HEAD_FIXED[s];
  /* 「100mmマシンガン の調整」 · 「陸戦型ガンダム用ビーム・ライフルの性能調整」 — 무장 하나의 조정 */
  const adj = s.match(/^(.+?)\s*の(性能)?調整$/);
  if (adj) { const w = weaponNameKo(adj[1]); return w ? w + (adj[2] ? ' 성능 조정' : ' 조정') : null; }
  for (const [ja, ko] of HEAD_PLACE) {
    if (!s.startsWith(ja)) continue;
    let rest = s.slice(ja.length).replace(/^[、,]\s*/, '').trim();
    const neu = /新規追加$/.test(rest);
    if (!/追加$/.test(rest)) return null;
    rest = rest.replace(/(新規)?(が)?追加$/, '').trim();
    const items = itemsKo(rest);
    if (items == null) return null;
    return ko + ' ' + (items ? items + ' ' : '') + (neu ? '신규 추가' : '추가');
  }
  return null;
}

/* 기계 번역에 보내기 전에 사전으로 먼저 바꿀 **이름** — 무장 · 기체 · 스킬.
   기계 번역은 고유명사를 음차하거나 풀어 버린다(「ペイルライダー」 → 「페이루라이다」, 「機体固定装置」 → 「항공기 고정 장치」).
   짧은 낱말(「ライフル」)까지 바꾸면 문장을 헤집으므로 **이름 꼴**만, 긴 것부터. */
const NAMES = (() => {
  const rdj = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'i18n', f), 'utf8')); } catch { return {}; } };
  const out = new Map();
  const add = (k, v, ok) => { k = NFC(k); if (typeof v === 'string' && v && !hasJa(v) && ok(k) && !out.has(k)) out.set(k, v); };
  for (const [k, v] of Object.entries(rdj('weapons.json'))) add(k, v, x => x.length >= 6 && /[・［\[（(]|用/.test(x));
  const ms = Object.assign({}, rdj('ms.auto.json'), rdj('ms.json'));
  for (const [k, v] of Object.entries(ms)) add(k, v, x => x.length >= 3 && /[ァ-ヶ]/.test(x));
  const sk = Object.assign({}, rdj('skill_text.json'), rdj('skills.json'));
  for (const [k, v] of Object.entries(sk)) add(k, v, x => x.length >= 4 && x.length <= 24 && !/[。、，,.\s]/.test(x));
  return [...out.entries()].sort((a, b) => b[0].length - a[0].length);
})();
const nameSwap = s => { for (const [k, v] of NAMES) if (s.includes(k)) s = s.split(k).join(v); return s; };
function prepMT(ja) {
  let s = NFC(ja);
  /* 「」 안 — 스킬 이름이면 사전으로, 아니면 이름 · 게임 용어를 그 안에도 건다.
     glossary.protect 는 「」 안을 고유명사로 보고 건너뛰어 「よろけ値」 가 「요로케치」 로 나왔다. */
  s = s.replace(/「([^」]+)」/g, (m, inner) => {
    const ko = WTR.skillKo(inner);
    return '「' + (ko || G.protect(nameSwap(inner))) + '」';
  });
  return G.protect(nameSwap(s));
}

/** 받은 번역을 우리 표기로 맞춘다 — glossary.post 에 더해 이 자료에서 본 것만. */
function postMT(ja, ko) {
  if (typeof ko !== 'string') return ko;
  let s = G.post(ko).replace(/DP교환/g, 'DP 교환');
  /* 「판넬」 을 박아 보냈는데 「패널」 로 되돌려 왔다 — 원문에 ファンネル 이 있을 때만 바꾼다 */
  if (/ファンネル/.test(ja)) s = s.replace(/패널/g, '판넬');
  /* 박아 보낸 「실드」 · 「대미지」 를 흔한 표기로 되돌려 온다 — 원문에 그 말이 있을 때만 */
  if (/シールド/.test(ja)) s = s.replace(/쉴드/g, '실드');
  if (/ダメージ/.test(ja)) s = s.replace(/데미지/g, '대미지');
  return s;
}

/** 숫자가 원문과 같은가 — 수치 기록이라 숫자가 하나라도 바뀌면 그 번역은 버린다. */
/* 옛 한자 숫자(壱·弐·参)는 이름 안에서 숫자로 옮겨지기도(「零式弐型」 → 「영식 2형」) 음으로 옮겨지기도 한다(「영식 이형」).
   그래서 「型·号·式」 앞의 것만 숫자로 본 셈과 안 본 셈 중 하나가 맞으면 된다(「参照」 의 参 은 숫자가 아니다). */
const digits = (s, kanji) => {
  let t = NFC(s).normalize('NFKC');
  if (kanji) t = t.replace(/[壱弐参](?=[型号式])/g, c => ({ '壱': '1', '弐': '2', '参': '3' }[c]));
  return (t.match(/\d+(?:\.\d+)?/g) || []).join(',');
};
const digitsOk = (ja, ko) => digits(ko) === digits(ja) || digits(ko) === digits(ja, true);

/* 원문에 없는 영어 낱말이 끼었는가 — 「ビーム・カノンx2」 가 「Beam Canon x2」 로 나왔다 */
const newLatin = (ja, ko) => {
  const src = NFC(ja).normalize('NFKC').toLowerCase();
  return (ko.match(/[A-Za-z]{3,}/g) || []).some(w => !src.includes(w.toLowerCase()));
};
/** 기계 번역 결과를 받아들일 수 있는가 — 일본어가 남지 않고 · 숫자가 같고 · 게임 용어가 살아 있고 · 영어가 안 끼었을 것 */
const acceptMT = (ja, ko) => typeof ko === 'string' && !!ko.trim() && !hasJa(ko) && digitsOk(ja, ko)
  && G.missing(ja, ko).length === 0 && !newLatin(ja, ko);

/**
 * 원문 한 줄 → 한국어(못 옮기면 null).
 * kind: 'head' 면 틀부터, 'line' 이면 한글화 규칙부터. cache 는 기계 번역 캐시(원문 → 번역).
 */
function koOf(ja, kind, cache) {
  const s = NFC(ja).trim();
  if (!s) return '';
  if (!hasJa(s)) return s;
  /* 틀은 머리에만 있지 않다 — 「新規追加」 아래 줄에 「抽選配給にて ○○ Lv2追加」 가 오기도 한다 */
  const h = trHead(s);
  if (h != null && !hasJa(h)) return h;
  const d = WTR.trLine(s);
  if (d && !hasJa(d)) return d;
  const c = cache && cache[s];
  return acceptMT(s, c) ? c : null;
}

module.exports = { trHead, itemsKo, weaponNameKo, prepMT, postMT, digitsOk, acceptMT, koOf, hasJa, NFC };
