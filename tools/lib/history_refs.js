// 기체별 공식 참조 데이터(data/ms_refs.json)를 업데이트 이력(data/ms_history.json) 항목에 붙인다 — 빌드가 부른다.
//
// 공식 「유닛 관련 조정」 공지의 기체마다 붙은 표(COST · 승률 · 라이벌 승률 · 가한 대미지 · MS 손실 수 —
// 조정 전 LV 별 값, 다음 패치 때 덧붙는 「조정 후」 · 「상정 범위 안」)를 그 조정 항목 **아래**에 보인다(2026-11-16 사용자 지시).
//
// 붙이는 자리: 같은 위키 페이지에서 날짜가 ±3일 안인 「조정(adj)」 항목. 공식 공지일과 위키 이력 날짜는 대개 같지만
// 위키가 하루 어긋나게 적은 적이 있어 여유를 둔다. 맞는 항목이 없으면(위키가 그 조정을 안 적었다)
// 공식 조정 항목을 **따로 세운다** — 표를 버리지 않는다. 그 항목은 줄이 없고 머리만 「유닛 관련 조정」 이다.
'use strict';

const DAY = 86400e3;
const t = d => Date.parse(d + 'T00:00:00Z');

/**
 * @param {object} history  { pageId: [항목…] } — 최신이 위. 고치지 않고 새 객체를 돌려준다.
 * @param {object} byPage   ms_refs.json 의 byPage — { pageId: [{ d, ms, ko, ref, refJa? }] }
 * @returns {{ history: object, attached: number, standalone: number }}
 */
function attachRefs(history, byPage) {
  const out = {};
  for (const [id, es] of Object.entries(history || {})) out[id] = es.map(e => ({ ...e }));
  let attached = 0, standalone = 0;
  for (const [id, refs] of Object.entries(byPage || {})) {
    const es = out[id] || (out[id] = []);
    for (const r of refs) {
      const rec = { ko: r.ko, ref: r.ref, ...(r.refJa ? { refJa: r.refJa } : {}), ...(r.jpOnly ? { jpOnly: true } : {}) };
      let best = null, gap = Infinity;
      for (const e of es) {
        if (e.k !== 'adj' || e.src === 'official') continue;
        const g = Math.abs(t(e.d) - t(r.d));
        if (g <= 3 * DAY && g < gap) { best = e; gap = g; }
      }
      if (best) { (best.r || (best.r = [])).push(rec); attached++; continue; }
      /* 같은 날 공식 항목이 이미 있으면 거기 더한다(한 페이지에 LV 별 표가 둘 이상 올 때) */
      const same = es.find(e => e.src === 'official' && e.d === r.d);
      if (same) { same.r.push(rec); attached++; continue; }
      es.push({ d: r.d, k: 'adj', src: 'official', h: 'ユニット関連の調整', hk: '유닛 관련 조정', b: 0, l: [], r: [rec] });
      standalone++;
    }
    es.sort((x, y) => (x.d < y.d ? 1 : x.d > y.d ? -1 : 0));
  }
  return { history: out, attached, standalone };
}

module.exports = { attachRefs };
