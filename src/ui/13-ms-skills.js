  /* ui/13-ms-skills.js — 기체 스킬 목록 창.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 기체 스킬 목록 (무장 헤더 '스킬' 버튼) ---------- */
  const SKILL_MODE_KO = { '通常時': '통상', '変形時': '변형', '変身時': '변신', 'システム発動中': '시스템 발동 중', '飛行時': '비행', '': '통상' };
  const SKILL_CAT_KO = { '足回り': '기동', '攻撃': '공격', '防御': '방어', 'その他': '기타', '移動': '이동', '格闘': '격투', '射撃': '사격', '': '기타' };
  /** 스킬 텍스트 번역 (없으면 원문).
   *  번역 사전은 「・사격 보정 ＋25」처럼 **일본어 문장부호를 그대로 달고** 들어온다(318·206·181문장).
   *  무장 칸은 jaUnits 가 반각으로 맞춰 왔는데 스킬 글만 그 규칙 밖에 있어, 같은 앱 안에서
   *  「· 사격 보정 +25」와 「・사격 보정 ＋25」가 나란히 보였다. 여기서 같은 자로 맞춘다.
   *  사전을 고치지 않고 **낼 때** 맞추는 이유 — 사전은 생성물이라 다시 만들면 되돌아간다. */
  const skTr = s => (s ? jaPunct(skillText[s] || s) : '');
  // 활성 모드 탭은 따로 두지 않고 state.form(성능의 통상/변신 토글)에서 파생한다.
  // 따로 두면 성능은 변신인데 스킬 패널만 통상이 되어 같은 화면이 서로 다른 값을 보여 준다.
  const mskillModeIdx = modes => {
    if (modes.length < 2) return 0;
    const i = state.form === 'transform'
      ? modes.findIndex(isAltSkillMode)
      : modes.findIndex(m => !isAltSkillMode(m));
    return i >= 0 ? i : 0;
  };

  // 「LV1～3」「LV4～」「LV3」에 현재 기체 LV 이 드는지.
  // 물결(～) 유무가 중요하다 — 「LV3」은 **그 레벨 전용**이고 「LV3～」이 LV3 이상이다.
  // 둘을 같게 보면 리바우 LV2 처럼 「LV1」짜리 구간이 상위 LV 까지 따라와 낮은 스킬이 표시된다.
  // 다만 위키가 마지막 구간의 물결을 빼먹은 경우가 있어(10건), 어디에도 안 맞으면
  // 호출부에서 '가장 높은 구간'으로 폴백한다.
  function msLvHit(msLvStr, lv) {
    const m = String(msLvStr || '').match(/LV\s*(\d+)\s*([～~\-])?\s*(?:LV)?\s*(\d+)?/i);
    if (!m) return true;
    const from = Number(m[1]);
    if (!m[2]) return lv === from;                       // 물결 없음 = 그 레벨만
    return lv >= from && lv <= (m[3] ? Number(m[3]) : 99);
  }
  /** msLv 표기의 시작 레벨. */
  const msLvFrom = v => Number((String(v || '').match(/LV\s*(\d+)/i) || [])[1]) || 1;
  /** 이름별 후보 중 현재 LV 에 맞는 구간 하나. 없으면 가장 높은 구간으로 폴백(습득 전이면 null).
   *  구간이 겹칠 때는 **높은 쪽**을 쓴다 — 위키가 「LV1～」과 「LV2～」를 함께 적어 두면
   *  앞의 것은 사실상 다음 구간 전까지라는 뜻이라, 먼저 찾은 것을 쓰면 낮은 스킬이 잡힌다
   *  (리크 돔Ⅱ 다리 특수 완충재 LV2 = 15% 인데 10% 로 나오던 자리). */
  /** 스킬 자체의 LV(「LV3」) — 없으면 0. */
  const skillLvNum = v => Number((String(v || '').match(/LV\s*(\d+)/i) || [])[1]) || 0;
  /** 겹칠 때의 우선순위 — ① 스킬 LV 이 높은 쪽 ② 그다음 msLv 구간이 늦게 시작하는 쪽.
   *  위키에 「LV1」과 「LV1～」처럼 불규칙하게 적힌 자리가 있는데(5건), 그럴 때 msLv 만 보면
   *  기체 LV 이 올라갔는데 스킬이 낮아지는 결과가 나온다(수중형 건담 기동전 복합시스템).
   *  GBO2 에서 기체 LV 이 올라 스킬이 내려가는 일은 없으므로 스킬 LV 을 먼저 본다. */
  const byFromDesc = (a, b) => (skillLvNum(b.lv) - skillLvNum(a.lv)) || (msLvFrom(b.msLv) - msLvFrom(a.msLv));
  function pickByMsLv(cands, lv) {
    const hits = cands.filter(s => msLvHit(s.msLv, lv));
    if (hits.length) return hits.slice().sort(byFromDesc)[0];
    // 어디에도 안 맞으면 '현재 LV 이하'의 구간 중 가장 높은 것을 쓴다.
    // 그냥 최고 구간을 집으면 구간 사이에 빈틈이 있을 때 상위 스킬이 튀어나온다
    // (실바 바레트 서프레서 LV2 · 다리 특수 완충재 = 구간 [LV1, LV3～] 자리).
    const below = cands.filter(s => msLvFrom(s.msLv) <= lv);
    if (!below.length) return null;                       // 아직 습득 전
    return below.slice().sort(byFromDesc)[0];
  }

  function openMskill(open) {
    const panel = document.getElementById('mskillInline');
    const btn = document.getElementById('skillListBtn');
    if (panel) panel.hidden = !open;
    if (btn) btn.classList.toggle('on', open);
    if (open) { renderMskill(); if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' }); }
  }

  function renderMskill() {
    const body = $('#mskillBody'), tabs = $('#mskillTabs');
    $('#mskillMsName').textContent = state.ms ? T.msName(state.ms.MS名) : '';
    const modes = (state.ms && msSkillsData[baseName(state.ms.MS名)]) || [];
    body.innerHTML = '';
    if (!modes.length) { body.append(el('div', 'detail-empty', wikiPending(state.ms) ? WIKI_PENDING_TXT : '이 기체의 스킬 정보가 없습니다.')); tabs.hidden = true; return; }

    // 모드 탭 (다중모드일 때만)
    tabs.innerHTML = '';
    tabs.hidden = modes.length < 2;
    const curIdx = mskillModeIdx(modes);
    if (modes.length > 1) modes.forEach((md, i) => {
      const t = el('button', 'seg-btn' + (i === curIdx ? ' on' : ''), SKILL_MODE_KO[md.mode] || md.mode || '통상');
      // 탭 = 성능의 통상/변신 토글과 같은 값. 여기서 바꾸면 성능 쪽도 함께 바뀐다.
      t.onclick = () => { state.form = isAltSkillMode(md) ? 'transform' : 'normal'; renderAll(); };
      tabs.append(t);
    });

    const lv = state.ms ? msLevel(state.ms) : 1;
    const mode = modes[Math.min(curIdx, modes.length - 1)];
    // 스킬명별로 현재 기체 LV 에 맞는 구간 하나를 고른다.
    // 단일 닫힌 구간(예: 「LV1～2」)만 가진 스킬은 그 상한을 넘는 LV 에서 어떤 구간에도
    // 안 맞아 사라지므로, 그럴 땐 가장 높은 from 구간으로 폴백해 계속 보여 준다.
    const groups = new Map();
    for (const s of mode.skills) {
      const key = s.cat + '|' + s.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const fromOf = s => { const m = String(s.msLv || '').match(/LV\s*(\d+)/i); return m ? Number(m[1]) : 1; };
    const picked = new Map();
    for (const [key, cands] of groups) {
      // 구간 선택·폴백 규칙은 방어 스킬과 같은 것을 쓴다(pickByMsLv).
      //   · 아직 습득 전이면 안 보여 준다 (야크트 도가[소매] 데미지컨트롤 LV3·LV4～ 가 LV1 에 뜨던 문제)
      //   · 위키가 마지막 구간의 물결을 빼먹어 어디에도 안 맞으면 가장 높은 구간으로
      const chosen = pickByMsLv(cands, lv);
      if (chosen) picked.set(key, chosen);
    }
    // 분류별 그룹
    const order = ['足回り', '攻撃', '防御', '移動', '格闘', '射撃', 'その他', ''];
    const byCat = new Map();
    for (const s of picked.values()) { if (!byCat.has(s.cat)) byCat.set(s.cat, []); byCat.get(s.cat).push(s); }
    const cats = [...byCat.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (!cats.length) { body.append(el('div', 'detail-empty', '이 LV 에서 표시할 스킬이 없습니다.')); return; }

    for (const cat of cats) {
      const sec = el('div', 'msk-sec');
      sec.append(el('div', 'msk-cat', SKILL_CAT_KO[cat] || cat || '기타'));
      for (const s of byCat.get(cat)) {
        const row = el('div', 'msk-row');
        const head = el('div', 'msk-head');
        head.append(el('span', 'msk-name', skTr(s.name)));
        if (s.lv) head.append(el('span', 'msk-lv', s.lv));
        row.append(head);
        if (s.eff) row.append(el('div', 'msk-eff', skTr(s.eff)));
        if (s.desc) row.append(el('div', 'msk-desc', skTr(s.desc)));
        sec.append(row);
      }
      body.append(sec);
    }
  }

  function renameBuild(id) {
    const list = loadBuilds();
    const b = list.find(x => x.id === id);
    if (!b) return;
    const name = (prompt('새 이름을 입력하세요', b.name) || '').trim();
    if (!name) return;
    b.name = name; writeBuilds(list); renderSavedBuilds();
  }

  function deleteBuild(id) {
    const list = loadBuilds();
    const b = list.find(x => x.id === id);
    if (b && !confirm('「' + b.name + '」 구성을 삭제할까요?')) return;
    writeBuilds(list.filter(x => x.id !== id)); renderSavedBuilds();
  }

  /** 저장한 구성을 자동 구성 카드처럼 파츠 아이콘·스탯 요약으로 보여 준다. */
