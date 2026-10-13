// 점검 도구가 **대결 시뮬을 몰아 재는** 공용 손잡이.
//
// 왜 한 곳에 두나 — 피탄 시뮬을 지우면서 자 11개를 이 화면으로 옮겼다. 몰아 가는
// 코드를 열한 벌 두면 화면이 조금 바뀔 때마다 열한 군데를 고쳐야 하고, 그러다
// 몇 개는 조용히 아무것도 안 재는 상태가 된다(이번 세션에서 실제로 밟았다).
//
// **재는 값은 DOM 이 아니라 GBO2Duel.attack() 에서 받는다.** 화면 글자를 긁으면
// 글자가 바뀔 때마다 자가 깨지고, 더 나쁘게는 반올림된 글자를 재게 된다.
'use strict';

/**
 * 양쪽을 세우고 공격 측 무장을 골라 attack() 결과를 받는다.
 * open() 이 seed 로 왼쪽을 앱 구성으로 덮으므로 **열고 난 뒤** 세운다 — 순서가 중요하다.
 *
 * @param pg            puppeteer 페이지
 * @param o.me          왼쪽 기체 이름 (MS名, 없으면 base 이름 중 최고 LV).
 *                      **비워 두면 앱이 지금 편집 중인 구성을 그대로 쓴다** — 자동 구성을
 *                      적용한 뒤 그 구성으로 재야 할 때 쓴다(파츠를 손으로 옮기지 않는다).
 * @param o.foe         오른쪽 기체 이름
 * @param o.myParts     왼쪽 파츠 이름 배열
 * @param o.foeParts    오른쪽 파츠 이름 배열
 * @param o.stage       강화 단계 (기본 6)
 * @param o.from        공격 측 'L' | 'R'  (기본 'L')
 * @param o.weapon      무장 고르기 — 정규식 문자열. 없으면 첫 무장
 * @param o.weaponExact 무장 이름 그대로 (정규식 이스케이프를 부르는 쪽에서 안 하도록)
 * @param o.melee       true 면 격투 무장만, false 면 사격만, 없으면 아무거나
 * @param o.dir         격투 방향 라벨 ('下格' 등)
 * @param o.air         공중 격투 켜기
 * @param o.shield      맞는 쪽 「실드로 막음」 켜기
 * @param o.defs        맞는 쪽이 켤 방어 스킬 이름 배열
 * @param o.buffs       공격 측이 켤 버프 스킬 이름 배열
 * @param o.exp         확장 스킬 (양쪽 모두)
 * @param o.corr        공격 측 보정 직접 입력 {shoot, melee} — null 이면 구성값(자동)
 * @returns {Promise<object|null>} attack() 결과를 JSON 으로 옮긴 것 (+ 고른 것들)
 */
async function measure(pg, o) {
  return pg.evaluate(async q => {
    const w = x => new Promise(r => setTimeout(r, x));
    const G = window.GBO2_DATA, C = window.GBO2Core;
    const Duel = window.GBO2Duel;
    if (!Duel) return { 오류: 'GBO2Duel 이 없다' };
    const S = Duel.state;
    /* 이름은 **정규화해서** 맞춘다. 자는 data/msData.json 에서 읽은 문자열을 넘기는데
       묶음에 들어간 쪽과 결합 문자 형태(NFC/NFD)가 달라 `===` 가 조용히 안 맞는다 —
       「アトラスガンダム（BC）」가 그래서 「기체를 못 찾음」이 됐다. */
    const nz = x => String(x).normalize('NFC');
    const base = x => nz(x).replace(/_LV\d+$/, '');
    const pick = n => G.msData.find(m => nz(m.MS名) === nz(n))
      || G.msData.filter(m => base(m.MS名) === base(n)).pop();
    const byName = nm => {
      const all = [].concat(...Object.values(G.parts).filter(Array.isArray));
      return (nm || []).map(x => all.find(p => p.name === x)).filter(Boolean);
    };
    const keepMine = !q.me;            // 앱 구성을 그대로 쓸 것인가
    const me = keepMine ? null : pick(q.me), foe = pick(q.foe);
    if ((!keepMine && !me) || !foe) return { 오류: '기체를 못 찾음: ' + (me || keepMine ? q.foe : q.me) };

    Duel.open();                       // **먼저 연다** — open 이 seed 로 왼쪽을 앱 구성으로 덮는다
    await w(500);
    const stage = q.stage == null ? 6 : q.stage;
    if (!keepMine) { S.L.ms = me; S.L.stage = stage; S.L.parts = byName(q.myParts); }
    if (!S.L.ms) return { 오류: '왼쪽에 기체가 없다 (앱에서 기체를 먼저 고를 것)' };
    S.R.ms = foe; S.R.stage = stage;
    S.R.parts = byName(q.foeParts);
    S.L.wKey = null; S.R.wKey = null; S.L.air = false; S.R.air = false;
    // 앱 구성을 쓸 때는 왼쪽 확장도 앱 값을 그대로 둔다 — 아래 exp 설정에서 되돌리지 않게
    S.L.buffs.clear(); S.R.buffs.clear(); S.L.defs.clear(); S.R.defs.clear();
    S.L.shieldOn = false; S.R.shieldOn = false;
    /* 보정 직접 입력도 **매번 비운다.** 호출 사이에 남겨 두면 앞 호출의 값이 따라와,
       「사격 칸을 흔들어도 안 바뀐다」가 앞 호출의 격투 250 때문에 바뀌어 보인다
       (실제로 그렇게 걸렸다 — 1,965 → 5,376). 세우는 값은 전부 여기서 초기화한다. */
    S.L.corr = { shoot: null, melee: null };
    S.R.corr = { shoot: null, melee: null };
    if (!keepMine) S.L.exp = q.exp || C.EXPANSION_NONE;
    S.R.exp = q.exp || C.EXPANSION_NONE;
    S.L.posture = 'stand'; S.R.posture = 'stand'; S.L.scope = false; S.R.scope = false;
    const from = q.from || 'L';
    const A = from === 'L' ? S.L : S.R, B = from === 'L' ? S.R : S.L;
    if (q.shield) B.shieldOn = true;
    if (q.corr) for (const k of ['shoot', 'melee']) if (k in q.corr) A.corr[k] = q.corr[k];
    for (const n of (q.defs || [])) B.defs.add(n);
    for (const n of (q.buffs || [])) A.buffs.add(n);
    Duel.use({});                      // 다시 그린다 (renderAll 은 밖으로 안 나와 있다)
    await w(500);

    // 무장 고르기 — 화면의 줄을 **실제로 눌러서** 고른다
    const re = q.weapon ? new RegExp(q.weapon) : null;
    const rows = [...document.querySelectorAll('.duel-side[data-side="' + from + '"] .ds-w')];
    let got = null, tried = [];
    for (const e of rows) {
      e.click(); Duel.use({});
      const a = Duel.attack(A, B);
      if (!a) continue;
      tried.push(a.wp.w.name);
      if (q._list) continue;                       // 훑기만 — 이름을 다 모은다 (tried 에 쌓인다)
      if (q.melee === true && !a.wp.melee) continue;
      if (q.melee === false && a.wp.melee) continue;
      if (q.weaponExact && a.wp.w.name !== q.weaponExact) continue;
      if (re && !(re.test(a.wp.w.name) || re.test(e.textContent || ''))) continue;
      got = a; break;
    }
    if (q._list) return { 무장목록: tried };
    if (!got) return { 오류: '무장을 못 골랐다', 후보: tried.slice(0, 12) };

    if (q.dir && got.wp.variants) {
      const d = (got.wp.variants[0].direction || []).findIndex(x => x.label === q.dir);
      if (d >= 0) { A.dir = d; Duel.use({}); }
    }
    if (q.air) {
      const ab = [...document.querySelectorAll('.duel-side[data-side="' + from + '"] .ds-cond .d-btn')]
        .find(b => /공중 격투/.test(b.textContent));
      if (ab) { ab.click(); Duel.use({}); }
    }
    await w(300);
    const r = Duel.attack(A, B);
    if (!r) return { 오류: '계산이 안 나왔다' };
    const out = {
      무장: r.wp.w.name, 무장ko: window.GBO2i18n.weaponName(r.wp.w.name),
      속성: r.wp.attr, 격투: !!r.wp.melee,
      위력: r.power, 보정: r.corr, 구성보정: r.autoCorr, 직접입력: r.manual,
      상성: r.att, 한발: r.per, HP눈금: r.perHp,
      히트: r.n, 고정: r.fixed, 발수: r.shots, 내구: r.eff, HP: r.hp,
      경감배수: r.factor, 파츠피해: r.partPct, 스킬피해: r.skPcts,
      적내성깎기: r.foeCut, 무장깎기: r.fa ? r.fa.wCut : null, 스킬깎기: r.fa ? r.fa.sCut : null,
      내성: r.armor, 방향: r.dirTxt, 구간: !!r.bands, 집속: !!r.charged, 모드: r.mode,
      집속필수: !!(r.wp.modes && r.wp.modes.length && !r.wp.modes[0].ok),
      공중: r.air ? r.air.pct : null,
      실드: r.shield ? { 이름: r.shield.name, HP: r.shield.hp, 발수: r.shield.hits, 메모: r.shield.note } : null,
      경직: r.stg ? { 히트: r.stg.hits, 값: r.stg.value, 설명: r.stg.note } : null,
      경감목록: (r.cuts || []).map(c => c.scope + ':' + c.pct)
    };
    /* 어느 방향 카드를 읽어야 하는지 알려 준다 — 첫 카드는 늘 L→R 이라,
       오른쪽에서 쏘게 세운 자가 그걸 읽으면 **빈 안내문**을 읽는다(실제로 그랬다). */
    out.카드 = '#duelModal .dc-card[data-dir="' + (from === 'L' ? 'LR' : 'RL') + '"]';
    // 화면에 뜬 것도 함께 — 칸이 있는지(값이 보이는지)까지 재려고
    out.방어칩 = [...document.querySelectorAll('.duel-side[data-side="' + (from === 'L' ? 'R' : 'L') + '"] .ds-chip.def')]
      .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim());
    out.보정칸 = [...document.querySelectorAll('.duel-side[data-side="' + from + '"] .ds-corr')]
      .map(e => ({ ko: (e.querySelector('i') || {}).textContent,
        값: (e.querySelector('input') || {}).value,
        구성값: (e.querySelector('input') || {}).placeholder,
        켜짐: e.classList.contains('on') }));
    out.내구칸 = [...document.querySelectorAll('.duel-side[data-side="' + (from === 'L' ? 'R' : 'L') + '"] .ds-dura .ds-dcell')]
      .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim());
    out.목표줄 = [...document.querySelectorAll('#duelModal .goal-row')]
      .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim());
    return out;
  }, o);
}

/** 대결 창을 닫는다. */
const close = pg => pg.evaluate(() => { if (window.GBO2Duel) window.GBO2Duel.close(); });

/**
 * 그 쪽에서 쓸 수 있는 무장 이름 목록 — 자가 무장을 훑을 때.
 *
 * **measure 와 같은 설정을 쓴다.** 예전에는 따로 세우면서 `S.L.parts = []` 를 했는데,
 * `me: null`(앱 구성 그대로)로 쓰는 자에서 그 한 줄이 내 파츠를 지웠다 —
 * 그러면 「이 파츠가 깎는 무장을 찾는다」가 아무것도 못 찾는다(실제로 그렇게 깨졌다).
 * 설정은 한 곳(measure)만 있어야 한다.
 */
async function weaponsOf(pg, o) {
  const r = await measure(pg, { ...o, weapon: null, weaponExact: null, melee: undefined, _list: true });
  return r.오류 ? [] : (r.무장목록 || []);
}

module.exports = { measure, close, weaponsOf };
