// 추천 영상 — **어느 기체의 영상인가**를 가리는 자.
//
// 유튜브 검색은 이름이 짧으면 다른 기체를 끌어온다. 「ドム」로 찾으면 RFドム·
// リック・ドムⅡ(GH)·ドム・トロピカルテストタイプ 가 섞이고, 「ガンダム」로 찾으면
// νガンダム·デスティニーガンダム 가 올라온다. 그래서 **제목에 들어 있는 기체 이름 중
// 가장 긴 것**이 찾던 기체와 같을 때만 남긴다.
//
// 실제로 밟은 함정 넷. 하나씩 다 피를 봤다:
//   ① 게임 이름 자체에 「ガンダム」가 들어 있다 — 안 떼면 「ガンダム」 검색이 전멸한다.
//   ② 표기가 갈린다 — 자료 「ドム・レゾナンス【TB】」 vs 제목 「ドムレゾナンス」,
//      자료 「RFドム」 vs 제목 전각 「ＲＦドム」. NFKC + 중점·괄호 제거가 필요하다.
//   ③ 괄호 안 끝말을 제목이 흘린다 — 자료 「ヘイズル・アウスラ［GAU装備］」 vs
//      제목 「ヘイズル・アウスラ GAU」. 装備 가 없어 긴 이름이 안 걸리고 **본체가 이겼다**.
//      그래서 끝말을 뗀 별명을 하나 더 둔다.
//   ④ 이름이 맞아도 게임 영상이 아닐 수 있다 — 「【ガンプラ】…MG ガンダムヘイズルアウスラ」
//      가 1.2만회로 4위에 들어왔다. 제목에 게임 낱말이 있어야 한다는 조건을 더 건다.
//
// 본체 이름(괄호를 통째로 뗀 꼴)은 **별명에 넣지 않는다.** 넣으면 변형이 본체로 묻혀,
// ③ 을 고친 것이 도로 풀린다.
import { MS } from './dict.js';

/** 끝에 붙은 괄호와 그 안의 글자 */
const BR = /[［\[（(【]([^］\]）)】]*)[］\]）)】]\s*$/;
/** 제목이 흘리기 쉬운 괄호 안 끝말 */
const TAIL = /(装備|仕様|型|改修|装着|換装)$/;

/** 게임 이름 상투어 — 기체 이름을 찾기 전에 먼저 뗀다(함정 ①) */
const GAME_TITLE = /機動戦士ガンダム\s*バトルオペレーション\s*[2２]|ガンダムバトルオペレーション\s*[2２]|バトルオペレーション\s*[2２]|バトオペ\s*[2２]|GBO\s*[2２]/g;

/** 이 영상이 이 게임 영상인가(함정 ④). 제목이든 채널명이든 한 번은 나와야 한다. */
const GAME_WORD = /バトオペ|バトルオペレーション|GBO\s*[2２]|Battle\s*Operation/i;

/** 표기 차이를 지운다(함정 ②) — 전각·중점·괄호·공백·대소문자 */
export const norm = (s) => String(s == null ? '' : s).normalize('NFKC')
  .replace(/[【】［］\[\]()（）・\s‐-―\-]/g, '').toLowerCase();

/** 한 기체가 제목에서 띨 수 있는 꼴들(함정 ③) */
export function aliasesOf(name) {
  const out = new Set([norm(name)]);
  const m = String(name).match(BR);
  if (m && TAIL.test(m[1])) {
    const short = m[1].replace(TAIL, '').trim();          // 「GAU装備」 → 「GAU」
    if (short) out.add(norm(String(name).replace(BR, '') + short));
  }
  return [...out].filter(k => k.length > 1);
}

/**
 * 유튜브에 넣을 검색어. 괄호는 검색을 망치므로 공백으로 편다.
 *
 * 끝말은 **괄호 안에서만** 뗀다. 이름 전체에서 떼면 괄호가 없는 「ザクⅡFS型」의 型까지
 * 떨어져 「ザクⅡFS」가 되고, 그러면 본체 「ザクⅡ」에 묻힌다 — 자가 점검에서 24건 잡혔다.
 */
export function queryOf(name) {
  const s = String(name);
  const m = s.match(BR);
  const body = m ? s.replace(BR, '') + ' ' + m[1].replace(TAIL, '') : s;
  return body.replace(/[［\[（(【］\]）)】]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* 기체 이름은 **LV 을 뗀 것**을 쓴다. 영상은 LV 별로 나뉘지 않는다.
   사전을 새로 만들지 않고 MS 에서 파생한다 — 두 곳에 같은 목록을 두면 언젠가 어긋난다
   (votes.js 의 MS_BASE 와 같은 규칙). */
export const MS_BASE = new Set([...MS].map(n => String(n).replace(/_LV\d+$/i, '')));

/**
 * 괄호를 **통째로** 뗀 꼴. 이것도 제목이 쓰는 꼴이다 —
 * 자료 「ドム・レゾナンス【TB】」, 제목 「ドムレゾナンス」. 【TB】 같은 출전 꼬리표는
 * 제목이 거의 안 적는다.
 *
 * 그런데 이걸 아무 데나 쓰면 **변형이 본체로 묻힌다** — 「ヘイズル・アウスラ［GAU装備］」의
 * 괄호를 떼면 본체 이름 그대로가 되어, 고쳐 놓은 ③ 이 도로 풀린다.
 * 그래서 **아무도 그 꼴을 안 쓸 때만** 쓴다(아래 weak).
 */
function bareOf(name) {
  const s = String(name);
  return BR.test(s) ? norm(s.replace(BR, '')) : null;
}

/* 별명 → 기체. 긴 별명부터 본다.
   두 걸음으로 짓는다:
     ① 확실한 별명(full · 끝말 뗀 것) — 먼저 자리를 잡는다.
     ② 괄호를 통째로 뗀 꼴 — ① 중 아무것도 그 자리를 안 썼고, 노리는 기체가
        **하나뿐일 때만** 받는다. 둘이 노리면 가를 수가 없으니 둘 다 버린다. */
const BY_ALIAS = new Map();
for (const n of MS_BASE) {
  for (const a of aliasesOf(n)) {
    if (!BY_ALIAS.has(a)) BY_ALIAS.set(a, n);
  }
}
/** 「어느 기체인지 못 고르겠다」는 표. 어떤 기체 이름과도 같지 않아 다 걸러진다. */
const AMBIG = '\u0000애매함';

{
  const want = new Map();                       // 괄호 뗀 꼴 → 그걸 노리는 기체들
  for (const n of MS_BASE) {
    const b = bareOf(n);
    if (!b || b.length < 2 || BY_ALIAS.has(b)) continue;   // ① 이 이미 쓰면 손대지 않는다
    if (!want.has(b)) want.set(b, []);
    want.get(b).push(n);
  }
  for (const [b, ns] of want) {
    /* 하나만 노리면 그 기체로 친다.
       **둘 이상이면 버리지 않고 「애매함」으로 둔다.** 버리면 더 짧은 이름이 이겨 버린다 —
       「ガンダム試作2号機」는 자료에 ［BB仕様］·［MLRS］ 둘로만 있어서, 이 자리를 비워 두니
       「ガンダム試作２号機」 영상이 **초대 ガンダム 칸으로 들어왔다**(실측).
       어느 쪽인지 모르는 것이지 초대 건담 영상인 것은 아니다. 모르면 아무 칸에도 안 넣는다. */
    BY_ALIAS.set(b, ns.length === 1 ? ns[0] : AMBIG);
  }
}
const ALIAS_SORTED = [...BY_ALIAS.keys()].sort((a, b) => b.length - a.length);

/** 해시태그는 **기체를 가릴 때 세지 않는다.**
 *  꼬리에 붙는 태그는 「#ガンダム」처럼 뭉뚱그린 말이 많다. 실제로
 *  「実装機の残弾、そろそろヤバい説…#ガンダム」 이라는 **전 기체 이야기** 영상이
 *  그 태그 하나 때문에 초대 ガンダム 칸으로 들어왔다. 본문에 이름이 있으면 그것으로 잡힌다.
 *  (게임 영상인지 보는 isGameVideo 는 태그를 그대로 본다 — 거기선 태그가 좋은 단서다.) */
const HASHTAG = /[#＃]\S+/g;

/** 제목에 들어 있는 기체 이름 중 가장 긴 것. 없으면 null, 못 고르겠으면 AMBIG. */
export function pickMs(title) {
  const t = norm(String(title == null ? '' : title)
    .replace(HASHTAG, ' ').replace(GAME_TITLE, ' '));
  const k = ALIAS_SORTED.find(x => t.includes(x));
  return k ? BY_ALIAS.get(k) : null;
}

/** 게임 영상인가 — 제목이나 채널명에 게임 낱말이 있어야 한다. */
export function isGameVideo(title, channel) {
  return GAME_WORD.test(String(title || '') + ' ' + String(channel || ''));
}

/* ===================== 걸러 내는 규칙 =====================
   이름이 맞고 게임 영상이어도 **파츠 참고에 쓸모없는 것**이 섞인다. 실제로 도무 칸
   3위가 「ギードムくんの日常(スパガン編) #shorts」 — 1분짜리 개그 쇼츠였다(1.8만회).
   조회수만 보면 올라오지만 보고 배울 것이 없다.

   값은 사용자가 정했다: 최소 1,000회 · 3분 하한. 한 군데 모아 둔다 —
   바꿀 일이 생기면 여기만 고치면 되고, 자(tools/videos_check.js)도 이것을 읽는다. */
export const RULES = {
  minViews: 1000,     // 거의 안 본 영상은 뺀다
  minSec: 180,        // 짧은 클립·쇼츠. 지금 뜨는 해설 영상은 8분대라 영향이 없다
  dropShorts: true,   // 길이가 길어도 쇼츠로 올린 것이 있다
  /* 제외할 채널. **이름을 그대로 적는다**(대소문자·앞뒤 공백은 안 따진다).
     지금은 비어 있다 — 뺄 채널이 생기면 여기에 적으면 된다. */
  blockChannels: []
};

/** 「#shorts」·「＃ショート」 꼴. 길이가 3분을 넘어도 쇼츠로 올린 것이 있다. */
const SHORTS = /[#＃]\s*(shorts?|ショート)\b/i;

/** 쓸모 규칙을 통과하는가. 통과 못 한 이유를 알고 싶으면 whyBlocked 를 쓴다. */
export function passesRules(v, rules = RULES) {
  return whyBlocked(v, rules) === null;
}

/** 막힌 이유 한 마디. 통과하면 null. (자에서 「왜 빠졌는지」를 집어 보려고 나눠 둔다) */
export function whyBlocked(v, rules = RULES) {
  const r = { ...RULES, ...(rules || {}) };
  const ch = String(v && v.ch || '').trim().toLowerCase();
  if (r.blockChannels && r.blockChannels.some(b => String(b).trim().toLowerCase() === ch)) return 'channel';
  if (r.dropShorts && SHORTS.test(String(v && v.title || ''))) return 'shorts';
  if (r.minViews > 0 && Number(v && v.views || 0) < r.minViews) return 'views';
  /* 길이를 모르는 영상은 **빼지 않는다.** videos.list 가 재생 시간을 못 주는 경우가
     있는데(라이브 등), 모른다고 버리면 멀쩡한 것을 잃는다. 아는 것만 잰다. */
  const sec = Number(v && v.sec);
  if (r.minSec > 0 && Number.isFinite(sec) && sec > 0 && sec < r.minSec) return 'short';
  return null;
}

/**
 * 이 기체의 영상만 남긴다.
 *
 * 비어 있을 수 있고, **그때 본체 영상으로 채우지 않는다**(사용자 결정 A).
 * 육전형 건담처럼 최근 1년 영상이 전부 WR 판인 기체가 실제로 있는데,
 * 거기에 WR 영상을 띄우면 사용자는 그것을 본체 영상으로 믿는다. 틀린 것보다 빈 것이 낫다.
 */
export function filterFor(ms, items, rules = RULES) {
  return (items || []).filter(v =>
    pickMs(v.title) === ms && isGameVideo(v.title, v.ch) && passesRules(v, rules));
}
