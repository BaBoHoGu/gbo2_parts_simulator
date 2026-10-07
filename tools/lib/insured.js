// 추천 영상 **보험 대상**을 정하는 한 자리.
//
// 보험이 필요한 기체 = 「새 영상이 아직 조회수를 못 모은 기체」다. 그런 일이 생기는 자리가 셋:
//   · 밸런스 패치로 조정됨   — 오래된 인기 영상이 새 영상을 덮는다
//   · LV 이 새로 붙음        — 샤아 즈고크 LV2~4 처럼. 기체는 묵었는데 영상만 새것이다
//   · 기체가 새로 나옴       — 사실 영상이 전부 새것이라 보험이 거의 필요 없지만, 해롭지 않다
//
// **여기 한 군데서만 정한다.** build_worker_dict.js(생성)와 videos_check.js(검사)가 같은 것을
// 쓴다 — 셈을 두 군데 두면 언젠가 갈라지고, 그러면 검사가 제 짝이 아닌 것을 재게 된다.

/** 사건이 늙어 효력을 잃는 기간. 보험은 「최근 2달 영상」에만 효과가 있어 저절로 식지만,
 *  안 지우면 목록이 끝없이 길어지고 「왜 이 기체가 들어 있지」가 흐려진다. */
const TTL_DAYS = 90;

/**
 * @param patch  data/patch.json 의 내용 ({ mechs, events })
 * @param opts.now    기준 시각 (시험에서 고정하려고 받는다)
 * @param opts.live   지금 자료에 있는 기체 이름 Set. 주면 **없는 이름을 버린다** —
 *                    표기가 바뀐 옛 이름(ゲルググＲ 전각 등)은 어떤 영상과도 안 맞아
 *                    아무 일도 못 하면서 목록만 흐린다.
 * @returns {{ list:string[], patch:number, newLv:number, new:number, dropped:number }}
 */
function insuredFrom(patch, opts = {}) {
  const now = opts.now == null ? Date.now() : opts.now;
  const live = opts.live || null;
  const p = patch || {};
  const cut = now - TTL_DAYS * 86400e3;

  const evAll = Array.isArray(p.events) ? p.events : [];
  /* 날짜가 깨진 사건도 여기서 같이 떨어진다 — Date.parse 가 NaN 을 주고 NaN 비교는 늘 거짓이다.
     따로 Number.isFinite 로 한 번 더 보던 줄이 있었는데, 심어 보니 지워도 아무 일이
     안 일어났다(죽은 코드였다). 한 줄로 둔다. */
  const fresh = evAll.filter(e => e && e.ms && Date.parse(e.at) >= cut);

  const mechs = Array.isArray(p.mechs) ? p.mechs.filter(Boolean) : [];
  const all = [...new Set([...mechs, ...fresh.map(e => e.ms)])];
  const list = (live ? all.filter(n => live.has(n)) : all).sort();

  return {
    list,
    patch: mechs.length,
    newLv: fresh.filter(e => e.why === 'newLv').length,
    new: fresh.filter(e => e.why === 'new').length,
    dropped: all.length - list.length
  };
}

module.exports = { insuredFrom, TTL_DAYS };
