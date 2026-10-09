// 공식 한국어 패치노트에서 **수치가 빠진 줄**에 위키 수치를 붙인다.
//
// 공식은 이렇게만 적는다:   ・비틀거림 축적치 상승
// 위키는 수치를 적는다:     よろけ値上昇 → 8% → 17%
// 그래서 둘을 짝지어   ・비틀거림 축적치 상승  [8% → 17%]   로 보여 준다.
//
// **공식 문구는 건드리지 않는다.** 값을 문장에 끼워 넣어 다시 쓰면 공식이 쓴 말이
// 바뀌고, 어디까지가 공식이고 어디부터가 우리가 붙인 것인지 알 수 없어진다.
// 원문은 그대로 두고 값을 **따로** 달아, 화면에서도 출처가 갈려 보이게 한다.
//
// 짜임새는 옆 프로젝트 `개인 개발/BP`(읽기 전용 참고)의 rules.py + atwiki.py 에서 가져왔다.
// 거기서 배운 것:
//   · 한국어 항목어 → 위키 일본어 라벨 대응표가 있어야 한다(ATWIKI_KEY).
//   · 값에서 대표 수치쌍을 뽑을 때 「Lv1：」 같은 앞머리와 「※…」 꼬리를 떼야 한다.
//   · 集束/非集束(집속/통상)은 **다른 값**이다 — 소제목을 보고 그 구간만 봐야 한다.
//     구간이 없는데 다른 모드 값만 있으면 **채우지 않는다**(엉뚱한 값을 붙이느니 비운다).
//   · 「発/分」→「발/분」, 「秒」 제거 같은 단위 맞춤이 필요하다.
//
// BP 와 다른 점: BP 는 일본어 공지에서 무장명을 얻는다. 우리는 한국어 공지뿐이라
// **우리 무장 사전(data/i18n/weapons.json)을 뒤집어** 한국어 무장명 → 일본어로 되돌린다.
'use strict';

/** 한국어 항목어 → 위키 일본어 라벨 키워드. 더 구체적인 것을 먼저 둔다. */
const ATWIKI_KEY = [
  ['2연격', '2撃目'], ['3연격', '3撃目'], ['4연격', '4撃目'],
  ['연격 보정', '連撃補正'],
  ['비틀거림 축적치', 'よろけ値'],
  /* 위키 이력은 라벨을 줄여 적기도 한다 — 「下格補正上昇」처럼 闘 가 빠진다.
     **한 항목에 후보를 여럿 둔다.** 처음에 짧은 꼴을 따로 줄로 넣었더니,
     그 줄이 먼저 걸려 온전한 꼴(下格闘補正)을 쓴 자료를 못 잡아 9줄이 되레 사라졌다. */
  ['하격투 보정', ['下格闘補正', '下格補正']],
  ['상격투 보정', ['上格闘補正', '上格補正']],
  ['좌우 격투 보정', ['横格闘補正', '横格補正']],
  ['상격투 보정', '上格闘補正'],
  ['무장 전환 시간', '切り替え'],
  ['히트율', 'ヒート率'],
  ['연사 속도', '連射'],
  ['빔 확산 수', '拡散'],
  ['소이 효과를 통한 대미지', '焼夷'],
  ['소이 효과 지속 시간', '焼夷'],
  ['오버 히트', 'オーバーヒート'],
  ['효과 시간', '効果時間'],
  ['폭발의 히트 횟수', 'ヒット回数'],
  ['폭발 히트 횟수', 'ヒット回数'],
  ['공격 히트 횟수', 'ヒット数'],
  ['재장전', 'リロード'],
  ['쿨타임', 'クールタイム'],
  ['집속 시간', '集束時間'],
  ['사정거리', '射程'],
  ['탄 수', '弾数'],
  /* 탄속(弾速)·ASL 범위는 위키도 **수치를 안 적는다**(「弾速上昇」만 적고 값이 빈다).
     넣어 두면 31줄이 「짚었는데 못 채움」으로 남아 덮는 비율만 흐려진다 — 뺀다.
     BP 도 같은 이유로 弾速 를 규칙에서 뺐다. */
  ['위력', '威力'],
  /* 기체 성능 쪽. 공식이 수치를 적어 주므로 배지는 안 붙지만,
     「(더불어 상위 LV도 상승)」 줄의 **LV 별 수치**를 찾으려면 이 대응이 있어야 한다. */
  ['기체 HP', '機体HP'],
  ['실드 HP', 'シールドHP'],
  ['근거리 파츠 슬롯', '近距離パーツスロット'],
  ['중거리 파츠 슬롯', '中距離パーツスロット'],
  ['원거리 파츠 슬롯', '遠距離パーツスロット'],
  ['슬러스터', 'スラスター'],
  ['스피드', 'スピード'],
  ['고속 이동', '高速移動'],
  ['선회', '旋回']
];

/** 위키에서 「항목」인지 — 동작어로 끝난다(BP 의 _ACTIONS). */
const ACTIONS = ['上昇', '低下', '短縮', '軽減', '延長', '増加', '減少', '緩和',
  '付与', '統合', '拡大', '改善', '変更', '追加', '削除', '向上',
  '強化', '弱体', '低減', '解除', '付加', '可能'];
const isMetric = t => ACTIONS.some(a => t.endsWith(a));
/** 값을 감싸는 문맥층(무장이 아니다) */
const CTX_PREFIX = ['非集束', '集束', '通常', 'Lv', 'LV', 'レベル'];
const isContext = t => CTX_PREFIX.some(p => t.startsWith(p)) || t.includes('→');
/** 그냥 묶기만 하는 층 — 통과해서 그 아래를 본다 */
const isGrouping = t => t.includes('性能調整') || t.includes('微調整');

const nrm = s => String(s).normalize('NFC').replace(/[\s·・]/g, '')
  .replace(/[×Xx]/g, 'x').replace(/[［【]/g, '[').replace(/[］】]/g, ']').toLowerCase();

/**
 * 무장 이름을 **「용」 뒤 꼬리**로 줄인다.
 *
 * 위키는 기체명을 축약해 적는다:
 *     공식 「실루엣 건담 개량형용 헤비 머신건」   위키 「SG改用ヘビーマシンガン」(= SG 개량형용 헤비 머신건)
 * 앞의 기체명만 다르고 **꼬리는 글자까지 같다.** 그래서 꼬리로 맞춘다.
 * (BP 는 일본어 공지가 있어 이름끼리 유사도를 쟀다. 우리는 한국어뿐이라 그 길이 없고,
 *  유사도는 「무엇이 맞는지」를 설명하지 못해 틀려도 모른다. 꼬리 규칙은 설명이 된다.)
 * 맞대는 짝은 **그 기체의 위키 이력 안**으로 한정되므로, 꼬리가 겹칠 일이 거의 없다.
 */
const tailKey = ko => {
  const s = String(ko || '').normalize('NFC');
  const i = s.lastIndexOf('용');
  return nrm(i >= 0 && i < s.length - 1 ? s.slice(i + 1) : s);
};

/**
 * 위키 줄 목록(flat [{depth,text}]) → [{ weapon, label, value }] 색인.
 * 무장 문맥은 **자식이 있는데 항목도 문맥도 아닌 층**이다.
 */
function buildIndex(lines) {
  const out = [];
  if (!Array.isArray(lines)) return out;
  const hasChild = i => i + 1 < lines.length && lines[i + 1].depth > lines[i].depth;
  /** i 아래에서 첫 번째 값(→ 가 든 줄) */
  const firstValue = i => {
    const d = lines[i].depth;
    for (let k = i + 1; k < lines.length && lines[k].depth > d; k++)
      if (lines[k].text.includes('→')) return lines[k].text;
    return '';
  };
  const stack = [];            // depth → 무장 이름
  for (let i = 0; i < lines.length; i++) {
    const { depth, text } = lines[i];
    stack.length = depth;
    const weapon = stack.filter(Boolean).pop() || '';
    if (isGrouping(text)) continue;
    if (isMetric(text)) { out.push({ weapon: nrm(weapon), weaponRaw: weapon, label: text, value: firstValue(i) }); continue; }
    if (isContext(text)) continue;
    if (hasChild(i)) stack[depth] = text;
  }
  return out;
}

/* ── 값에서 대표 수치쌍 뽑기 ─────────────────────────────────────── */
/** 오른쪽 값을 자를 다음 문맥 경계 — 「Lv2」「3撃目」「集束：」처럼 새 항목이 시작되는 자리 */
const CTX_RE = /(\d+撃目|\d+段階|Lv\d|LV\d|レベル|[^\s：:0-9→][^\s：:]*[：:])/;

/** 「Lv1：200 → 220 Lv2…」 → ['200','220']. 숫자가 없으면 null. */
function firstPair(value) {
  const v = String(value || '').replace(/　/g, ' ');
  const i = v.indexOf('→');
  if (i < 0) return null;
  let left = v.slice(0, i).split(/[：:]/).pop().trim();
  left = left.replace(/^(非集束|集束|通常|LV\d*機体|Lv\d+|LV\d+|レベル\d*)\s*/, '');
  let right = v.slice(i + 1).trim().split('※')[0].trim();
  const m = right.match(CTX_RE);
  if (m) right = right.slice(0, m.index).trim();
  left = left.replace(/\s+/g, ' '); right = right.replace(/\s+/g, ' ');
  if (!/\d/.test(left) || !/\d/.test(right)) return null;
  return [left, right];
}

/** 집속/통상 구간만 떼어 낸다. 없으면 null. */
function modeSegment(value, mode) {
  const v = String(value || '').replace(/　/g, ' ');
  if (mode === '非集束') {
    const m = v.match(/(?:非集束|通常)\s*[：:]?\s*([\s\S]+?)(?=(?<!非)集束\s*[：:]?|$)/);
    return m ? m[1] : null;
  }
  if (mode === '集束') {
    const m = v.match(/(?<!非)集束(?!\s*\d+\s*段階)\s*[：:]?\s*([\s\S]+)/);
    return m ? m[1] : null;
  }
  return null;
}

/**
 * 모드에 맞는 구간에서 대표 수치쌍.
 * **모드가 있는데 그 구간이 없고 다른 모드 값만 있으면 null** — 엉뚱한 값을 붙이지 않는다.
 */
function pickPair(value, mode) {
  if (mode) {
    /* 위키가 모드 표시를 **잘못 적은** 값은 쓰지 않는다.
       실제로 봤다: 「集束：9% → 8%　集束：80% → 70%」 — 앞의 것은 非集束 이어야 하는데
       둘 다 集束 라고 적혀 있다. 그대로 쓰면 집속 줄에 **통상 값**이 붙는다(화면에서 잡았다).
       한쪽 표시만 두 번 나오면 어느 쪽이 어느 쪽인지 알 수 없으므로 비운다 —
       틀린 수치는 없는 것만 못하다. */
    const v = String(value || '');
    const nonFocus = (v.match(/非集束/g) || []).length;
    const focus = (v.match(/集束/g) || []).length - nonFocus;
    if (focus > 1 && nonFocus === 0) return null;
    if (nonFocus > 1 && focus === 0) return null;
    const seg = modeSegment(value, mode);
    if (seg) { const p = firstPair(seg); if (p) return p; }
    else if (/集束|非集束|通常/.test(String(value))) return null;
  }
  return firstPair(value);
}

/**
 * 값에서 **LV 별 수치**를 모두 뽑는다 — 「Lv1：23000 → 25000　Lv2：25000 → 28000 …」.
 *
 * 공식은 대표 LV 하나만 적고 「(더불어 상위 LV도 상승)」이라고만 쓴다. 위키는 LV 를 다 적는다.
 * 둘 이상 있을 때만 돌려준다 — 하나뿐이면 공식이 이미 적은 그 값이라 덧붙일 것이 없다.
 */
function lvBreakdown(value) {
  const v = String(value || '').replace(/　/g, ' ');
  const out = [];
  /* 「Lv1：A → B」 조각을 차례로 집는다. 뒤의 ※주석은 버린다. */
  const re = /(Lv|LV|レベル)\s*(\d+)(?:\s*-\s*\d+)?\s*(?:機体)?\s*[：:]\s*([^→]+?)\s*→\s*([^\s]+(?:\s*\([^)]*\))?)/g;
  let m;
  while ((m = re.exec(v))) {
    const to = m[4].split('※')[0].trim();
    if (!/\d/.test(m[3]) || !/\d/.test(to)) continue;
    out.push({ lv: 'LV' + m[2], from: m[3].trim(), to });
  }
  return out.length >= 2 ? out : null;
}

/** 한국어 표기에 맞춘 단위 — 「発/分」→「발/분」, 「秒」 제거(정수는 .0) */
function koValue(v) {
  let s = String(v).replace(/発\/分/g, '발/분').replace(/発\/秒/g, '발/초');
  if (s.includes('秒')) {
    s = s.replace(/秒/g, '').trim();
    if (/^\d+$/.test(s)) s += '.0';
  }
  return s.trim();
}

const LCP = (x, y) => { let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++; return i; };
const LCS = (x, y) => { let i = 0; while (i < x.length && i < y.length && x[x.length - 1 - i] === y[y.length - 1 - i]) i++; return i; };
const AFFIX_MIN = 4;

/**
 * 한 기체 안에서 공식 무장 ↔ 위키 무장을 짝짓는다.
 *
 *   ① 이름이 같으면 짝이다.
 *   ② 앞 또는 뒤 4글자가 같고 후보가 하나면 짝이다(위키가 머리글자로 줄여 적는다).
 *   ③ **소거법** — ①② 를 떼고 양쪽에 하나씩만 남으면 그 둘이 서로의 짝이다.
 *      이름이 전혀 달라도 정해진다: 「로켓 런처」↔「R·런처」, 「더블 빔 라이플」↔「더블 B 라이플」.
 *      둘 이상 남으면 어느 쪽이 어느 쪽인지 알 수 없으므로 아무것도 정하지 않는다.
 *
 * 짝을 **미리 한 번에** 정하는 것이 중요하다. 줄마다 따로 찾으면 ③ 을 쓸 수 없다 —
 * 소거법은 그 기체의 무장 **전체**를 봐야 성립한다.
 */
function pairWeapons(offTails, wikiTails) {
  const pair = new Map();
  const usedW = new Set(), usedO = new Set();
  for (const t of offTails) if (wikiTails.includes(t)) { pair.set(t, t); usedO.add(t); usedW.add(t); }
  for (const t of offTails) {
    if (usedO.has(t)) continue;
    const near = wikiTails.filter(x => !usedW.has(x)
      && (LCP(t, x) >= AFFIX_MIN || LCS(t, x) >= AFFIX_MIN));
    if (near.length === 1) { pair.set(t, near[0]); usedO.add(t); usedW.add(near[0]); }
  }
  const restO = offTails.filter(t => !usedO.has(t));
  const restW = wikiTails.filter(t => !usedW.has(t));
  if (restO.length === 1 && restW.length === 1) pair.set(restO[0], restW[0]);
  return pair;
}

/** 색인에서 (무장, 키워드) 로 값 찾기. 무장은 **꼬리**로 맞춘다(위키가 기체명을 축약한다). */
function lookup(index, weaponTail, keyword, pair) {
  /* 미리 정해 둔 짝이 있으면 그 이름으로 본다 — 소거법으로 정한 것까지 쓴다. */
  if (pair && pair.has(weaponTail)) weaponTail = pair.get(weaponTail);
  const kws = Array.isArray(keyword) ? keyword : [keyword];
  const ok = r => kws.some(k => r.label.includes(k)) && r.value.includes('→');
  if (weaponTail) {
    const hit = index.find(r => r.tail && r.tail === weaponTail && ok(r));
    if (hit) return hit.value;
    /* 꼬리가 딱 안 맞으면 **앞 또는 뒤 4글자 이상이 같고 후보가 하나일 때만** 잇는다.
       위키가 머리글자로 줄여 적기 때문이다:
         공식 「샷 랜서 부속 헤비 머신건」   위키 「S・L 부속 헤비 머신건」
         공식 「더블 빔 라이플」           위키 「더블 B 라이플」
       유사도(Dice)로도 해 봤지만 **「실드 판넬[사격]」과 「실드 판넬[사출]」을 0.71 로
       같다고 했다** — 다른 무장이다. 앞/뒤 글자 규칙은 그 둘을 안 잇는다(공통 꼬리가 「]」뿐).
       3글자로 낮추면 「샷랜서」와 「샷랜서[타돌]」이 붙는다(이것도 다른 무장) — 그래서 4다.
       재서 고른 값이다: 4글자에서 54줄이 더 붙고, 눈으로 본 짝은 전부 맞았다. */
    const MIN = 4;
    const lcp = (x, y) => { let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++; return i; };
    const lcs = (x, y) => { let i = 0; while (i < x.length && i < y.length && x[x.length - 1 - i] === y[y.length - 1 - i]) i++; return i; };
    const near = [...new Set(index.filter(r => r.tail && (lcp(weaponTail, r.tail) >= MIN || lcs(weaponTail, r.tail) >= MIN)).map(r => r.tail))];
    if (near.length === 1) {
      const h2 = index.find(r => r.tail === near[0] && ok(r));
      if (h2) return h2.value;
      return null;   // 그 무장은 찾았는데 이 항목이 없다 — 다른 무장 값을 쓰면 안 된다
    }
    if (near.length > 1) return null;   // 애매하면 안 쓴다

    /* **변형 무장이 따로 있으면 안 쓴다.** 위키에 「샷랜서[타돌]」만 있는데 공식이
       「샷 랜서」를 말하고 있다면, 그 둘은 다른 무장이다(사격형/타돌형).
       아래 「후보가 하나면 쓴다」로 흘러가면 타돌형 값을 사격형에 붙인다.
       한쪽이 다른 쪽으로 시작하는데 4글자 규칙에 안 걸린 경우가 바로 그 꼴이다. */
    const variant = index.some(r => r.tail && r.tail !== weaponTail
      && (r.tail.startsWith(weaponTail) || weaponTail.startsWith(r.tail)));
    if (variant) return null;
  }
  /* 무장을 못 짚었으면 **키워드가 유일할 때만** 쓴다. 여럿이면 다른 무장 값을
     붙일 수 있어 아무것도 안 붙인다 — 틀린 수치는 없는 것만 못하다. */
  const cands = [...new Set(index.filter(ok).map(r => r.value))];
  return cands.length === 1 ? cands[0] : null;
}

/* **수치 줄이 아닌 것**. 「~할 수 있게 변경」·「스킬 … 추가」처럼 값이 오르내린 것이
   아니라 동작·스킬이 바뀐 줄이다. 항목어(슬러스터·고속 이동·재장전…)가 글자로는 들어 있어
   시도로 잡히지만 위키에도 수치가 없다 — 세어 봐야 「못 채움」만 늘려 비율을 흐린다. */
const NOT_VALUE = /(?:할 수 있게|할 수 있도록|가능하게|대응)\s*변경$|(?:추가|삭제|통합|변경)$/;

/** 공식 줄에 이미 수치가 들어 있는가 — 「200」→「220」 꼴 */
const HAS_NUM = /[「“][^」”]*\d[^」”]*[」”]\s*→\s*[「“][^」”]*\d[^」”]*[」”]/;
/** 줄에서 항목어를 찾아 위키 키워드로 */
/** 줄에서 항목어를 찾아 위키 키워드로. 후보가 여럿일 수 있다(위키가 줄여 적는 꼴). */
function keyOf(line) {
  const low = String(line);
  for (const [kr, ja] of ATWIKI_KEY) if (low.includes(kr)) return Array.isArray(ja) ? ja : [ja];
  return null;
}

/**
 * 한 기체의 공식 섹션들에 위키 수치를 단다.
 * 줄마다 `{ text, add: { from, to } }` 를 돌려주고, 못 찾으면 add 는 없다.
 * @param sections 공식 파싱 결과
 * @param wikiLines 위키 이력 줄 목록
 * @param jaToKo 일본어 무장명 → 한국어 (우리 무장 사전)
 */
function fillSections(sections, wikiLines, jaToKo) {
  const index = buildIndex(wikiLines);
  /* 색인의 일본어 무장명을 우리 사전으로 한글로 돌린 뒤 꼬리를 뽑아 둔다.
     사전에 없으면 꼬리가 없고, 그러면 그 줄은 무장으로 못 맞춘다(키워드 유일일 때만 쓴다). */
  /* 색인의 일본어 무장명을 우리 사전으로 한글로 돌린 뒤 꼬리를 뽑아 둔다.
     사전에 없으면 꼬리가 없고, 그 무장은 이름으로 못 맞춘다(짝짓기·유일 규칙으로만 간다).

     위키 **이력**이 표와 다른 이름을 쓰는 경우(이력 「ビーム・ガトリングx2」 / 표
     「ビーム・ガトリングガンx2」)를 표 이름으로 되돌려 보는 길을 넣었다가 **뺐다** —
     끄고 켜서 재 보니 살아나는 줄이 **0** 이었다. 그 자리들은 공식 쪽에 같은 이름의
     행이 둘(기본/리미터 해제)이라 어차피 애매하다. 쓰이지 않는 길은 나중에 틀리기만 한다. */
  for (const r of index) {
    const ko = r.weaponRaw ? jaToKo(r.weaponRaw) : '';
    r.tail = ko ? tailKey(ko) : '';
  }
  let filled = 0, tried = 0;
  /* 짝을 **먼저 한 번에** 정한다(소거법은 무장 전체를 봐야 한다). */
  const wikiTails = [...new Set(index.map(r => r.tail).filter(Boolean))];
  const offTails = [...new Set((sections || []).flatMap(sec => (sec.rows || [])
    .filter(r => r.weapon).map(r => tailKey(r.weapon))))];
  const pairMap = pairWeapons(offTails, wikiTails);   // 안쪽 pickPair 결과와 이름이 겹치지 않게
  /* 공식 줄(changes)은 **손대지 않는다.** 찾은 값은 나란한 배열 `fill` 에 담는다 —
     같은 자리의 줄에 붙는 값이고, 없으면 null 이다. 이렇게 두면 화면에서
     「공식이 쓴 말」과 「우리가 위키에서 가져온 값」이 갈려 보이고,
     옛 코드(줄을 글자로 읽는 곳)도 그대로 돈다. */
  const out = (sections || []).map(sec => ({
    ...sec,
    rows: (sec.rows || []).map(row => {
      const wTail = row.weapon ? tailKey(row.weapon) : '';
      let mode = null;                       // 【통상 사격】/【집속 사격】 소제목을 따라간다
      const fill = (row.changes || []).map(line => {
        if (/^[【[]/.test(line)) {
          mode = /집속/.test(line) ? '集束' : (/통상/.test(line) ? '非集束' : null);
          return null;
        }
        const kw = keyOf(line);
        if (!kw) return null;
        if (NOT_VALUE.test(line.trim())) return null;   // 값이 오르내린 줄이 아니다
        const hasNum = HAS_NUM.test(line);
        /* 「(더불어 상위 LV도 상승)」 줄은 공식이 대표 LV 하나만 적는다.
           위키는 LV 를 다 적으므로, **공식이 수치를 적은 줄이어도** LV 별 값을 찾아 붙인다.
           그 밖의 줄은 공식이 이미 적었으면 건드리지 않는다. */
        const wantsLv = /상위\s*LV/.test(line);
        if (hasNum && !wantsLv) return null;
        if (!hasNum) tried++;
        const val = lookup(index, wTail, kw, pairMap);
        if (!val) return null;
        const lv = wantsLv ? lvBreakdown(val) : null;
        if (hasNum) return lv ? { lv } : null;      // 수치는 공식 것을 쓰고 LV 만 덧붙인다
        const pair = pickPair(val, mode);
        if (!pair) return lv ? { lv } : null;
        filled++;
        return lv ? { from: koValue(pair[0]), to: koValue(pair[1]), lv }
          : { from: koValue(pair[0]), to: koValue(pair[1]) };
      });
      return fill.some(Boolean) ? { ...row, fill } : row;
    })
  }));
  return { sections: out, filled, tried };
}

module.exports = {
  ATWIKI_KEY, buildIndex, firstPair, modeSegment, pickPair, koValue,
  lookup, keyOf, fillSections, pairWeapons, lvBreakdown, HAS_NUM, isMetric, isContext, nrm, tailKey
};
