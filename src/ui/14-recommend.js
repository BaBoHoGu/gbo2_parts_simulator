  /* ui/14-recommend.js — 추천 · 비추.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ===================== 추천 · 비추 =====================
     갈래가 둘이다 — 'build'(갤러리 구성)와 'ms'(기체).
     하루 한도(추천 5 · 비추 3)를 **갈래끼리 나눠 쓰지 않는다**(사용자 결정).
     집계·내 표·남은 횟수는 서버가 한 번에 준다 — 앱은 그대로 그린다. */
  const voteState = {
    build: { totals: {}, mine: {}, left: null, loaded: false },
    ms: { totals: {}, mine: {}, left: null, loaded: false }
  };
  // 같은 갈래를 두 화면이 동시에 쓰므로, 받아 오면 둘 다 다시 그린다.
  const voteRedraw = { build: [], ms: [] };

  const voteUp = id => (voteState.build.totals[id] || [0, 0])[0];
  const voteScore = id => {
    const [u, d] = voteState.build.totals[id] || [0, 0];
    return u - d;
  };

  async function loadVotes(kind, force) {
    if (!S || !S.votes) return;
    const st = voteState[kind];
    if (st.loaded && !force) return;
    const r = await S.votes(kind);
    if (!r.ok) return;                       // 못 받아도 앱은 그대로 돈다
    st.totals = r.totals || {};
    st.mine = r.mine || {};
    st.left = r.left || null;
    st.loaded = true;
    for (const fn of voteRedraw[kind]) { try { fn(); } catch (e) {} }
  }

  /**
   * 추천·비추 한 줄. 갤러리 카드와 기체 정보 화면이 **같은 것**을 쓴다.
   * @param {'build'|'ms'} kind
   * @param {string} target  구성 id 또는 기체 이름(일본어 원문)
   */
  function voteBar(kind, target) {
    const bar = el('div', 'vote-bar');
    const st = voteState[kind];
    const draw = () => {
      bar.innerHTML = '';
      const [up, down] = st.totals[target] || [0, 0];
      const my = st.mine[target] || 0;
      const mk = (dir, txt, n) => {
        const b = el('button', 'vote-btn' + (dir > 0 ? ' up' : ' down') + (my === dir ? ' on' : ''));
        b.append(el('i', '', txt), el('b', '', String(n)));
        b.title = my === dir
          ? '누르면 취소합니다'
          : (dir > 0 ? '추천' : '비추') + (st.left ? ` (오늘 ${dir > 0 ? st.left.up : st.left.down}번 남음)` : '');
        b.onclick = async ev => {
          ev.stopPropagation();          // 카드를 누른 것으로 새지 않게
          b.disabled = true;
          const r = await S.vote(kind, target, dir);
          b.disabled = false;
          if (!r.ok) { toast(r.msg); return; }
          st.totals = r.totals || {};
          st.mine = r.mine || {};
          st.left = r.left || null;
          for (const fn of voteRedraw[kind]) { try { fn(); } catch (e) {} }
        };
        return b;
      };
      bar.append(mk(1, '👍', up), mk(-1, '👎', down));
    };
    draw();
    bar._draw = draw;
    return bar;
  }

  /**
   * 구성 요약 카드 — 저장 목록과 공유 갤러리가 **같은 렌더러**를 쓴다.
   * (둘이 따로 그리면 한쪽만 지표가 어긋나는 일이 생긴다 — 실제로 그런 버그를 여러 번 고쳤다)
   * @param {object} bld  {name, ms, parts[], stage, expansion, expLevel}
   * @param {object} opt
   *   onOpen()          카드를 눌렀을 때
   *   onRename() onDel() 있으면 제목 클릭·✕ 버튼을 단다 (저장 목록 전용)
   *   sub               제목 아래 한 줄 (갤러리의 올린 날짜 등)
   *   vote              구성 id. 주면 카드 아래에 추천·비추 줄을 단다.
   */
  function buildSummaryCard(bld, opt = {}) {
    const ms = msData.find(m => m.MS名 === bld.ms);
    const parts = (bld.parts || []).map(n => partByName.get(n)).filter(Boolean);
    const card = el('div', 'auto-cand saved-card');

    const head = el('div', 'ac-head');
    const nm = el('span', 'ac-rank sc-name', bld.name);
    if (opt.onRename) {
      nm.title = '클릭해서 이름 변경';
      nm.onclick = ev => { ev.stopPropagation(); opt.onRename(); };
    }
    head.append(nm);
    if (opt.sub) head.append(el('span', 'sc-sub', opt.sub));
    if (opt.onDel) {
      const del = el('button', 'sc-del', '✕');
      del.title = '이 구성 삭제';
      del.onclick = ev => { ev.stopPropagation(); opt.onDel(); };
      head.append(del);
    }
    card.append(head);
    // 올린 사람이 스스로 적은 이름 (갤러리 전용) — 제목과 기체 사이에 한 줄로 둔다.
    // 서버가 신원을 보증하지 않으므로 제목만큼 강조하지 않는다.
    // uniform 이면 비어 있어도 자리를 차지한다(격자에서 아래 글 위치를 맞추려고).
    if (opt.author || opt.uniform) {
      const who = el('div', 'sc-author', opt.author || '');
      // 이름 뒤에 IP 앞자리를 적는다 — 서버가 붙인 값이라 사용자가 바꿀 수 없다.
      // 같은 사람이 이름만 갈아 가며 올리는 것이 드러난다(국내 게시판의 그 표기).
      if (opt.author && opt.ipHead) who.append(el('span', 'sc-ip', '(' + opt.ipHead + ')'));
      card.append(who);
    }

    // 기체 한 줄 (썸네일 + 이름 · 강화 · 확장)
    const msLine = el('div', 'sc-ms');
    msLine.append(img(msImg(bld.ms), 'ms', bld.ms));
    const meta = el('div', 'sc-meta');
    meta.append(el('span', 'sc-msname', ms ? T.msName(ms.MS名) : bld.ms));
    const tags = [STAGE_LABEL[bld.stage] || ''];
    if (bld.expansion && bld.expansion !== C.EXPANSION_NONE) tags.push(expShort(bld.expansion));
    const tagLine = el('span', 'sc-tags', tags.filter(Boolean).join(' · '));
    // 올린 사람이 「무과금」으로 표시한 구성 — 강화·확장 표기 오른쪽에 붙인다
    if (bld.free) {
      const badge = el('span', 'sc-free', '무과금');
      badge.title = '리사이클 티켓만으로 만들 수 있는 구성';
      tagLine.append(badge);
    }
    meta.append(tagLine);
    msLine.append(meta);
    card.append(msLine);
    // 올린 사람이 적은 한 줄 설명 (갤러리 전용 — 저장 목록에는 없다)
    if (opt.desc || opt.uniform) card.append(el('div', 'sc-desc', opt.desc || ''));

    // 파츠 아이콘
    const thumbs = el('div', 'ac-thumbs');
    for (const part of parts) {
      const th = el('div', 'ac-thumb');
      th.append(img(partImg(part.name), 'parts', part.name));
      const lv = lvOf(part.name);
      if (lv) th.append(el('span', 'ac-lv', lv));
      th.title = T.partName(part.name);
      thumbs.append(th);
    }
    card.append(thumbs);

    // 스탯 요약 (저장된 강화·확장으로 실제 계산) — gbo2.jp 성능표처럼 핵심 스탯 + 내구 지표
    if (ms) {
      const r = C.calcStats(ms, parts, bld.stage, bld.expansion, partsByCat, fullst, bld.expLevel);
      const stats = el('div', 'ac-stats');
      for (const k of SUMMARY_STAT_KEYS) {
        const cell = el('span', 'ac-stat');
        cell.append(el('span', 'ac-k', C.STAT_LABEL[k]));
        cell.append(el('span', 'ac-v', (r.total[k] ?? 0).toLocaleString()));
        stats.append(cell);
      }
      card.append(stats);

      // 내구 지표 — 파츠 피해경감까지 접는다(성능표·비교와 같은 규칙)
      const scCuts = damageCutsOf(parts, { lv: C.msLevel(ms.MS名) });
      const du = el('div', 'sc-dura');
      du.append(el('span', 'sc-dura-lb', '내구 지표'));
      for (const [dattr, , label] of DURA_ATTRS) {
        const cell = el('span', 'ac-stat');
        cell.append(el('span', 'ac-k', label));
        cell.append(el('span', 'ac-v', enduranceOf(r.total, dattr, scCuts).toLocaleString()));
        du.append(cell);
      }
      card.append(du);
    } else {
      card.append(el('div', 'ac-warn', '이 기체 데이터를 찾을 수 없습니다'));
    }

    // 내 데이터에 없는 파츠(밸런스 패치로 빠졌거나 상대가 더 최신 데이터일 때)를 밝힌다
    const lost = (bld.parts || []).length - parts.length;
    card.append(el('div', 'ac-parts', `파츠 ${parts.length}개` + (lost ? ` (없는 파츠 ${lost}개 제외)` : '')));

    // 추천·비추 (갤러리·기체 정보에서만. 내 저장 목록에는 붙이지 않는다)
    if (opt.vote) card.append(voteBar('build', opt.vote));

    card.title = '클릭해서 이 구성 불러오기';
    card.onclick = () => opt.onOpen && opt.onOpen();
    return card;
  }

  function renderSavedBuilds() {
    const box = $('#savedResults');
    box.innerHTML = '';
    const list = loadBuilds();
    $('#savedModalNote').textContent = list.length ? list.length + '개' : '';
    if (!list.length) {
      box.append(el('div', 'detail-empty', '저장된 구성이 없습니다.\n구성을 만든 뒤 상단 “저장”을 누르세요.'));
      return;
    }
    for (const bld of list) {
      box.append(buildSummaryCard(bld, {
        onRename: () => renameBuild(bld.id),
        onDel: () => deleteBuild(bld.id),
        onOpen: () => {
          const r = deserialize(bld);
          fromGallery = false;
          openSavedModal(false);
          toast(r.ok
            ? ('「' + bld.name + '」 불러왔습니다' + loadNote(r))
            : '이 구성의 기체를 찾을 수 없습니다');
        }
      }));
    }
  }

  /** @returns {{ok: boolean, missing?: number}} missing = 사전에 없어 제외된 파츠 수 */
  function deserialize(obj) {
    if (!obj || !obj.ms) return { ok: false };
    const ms = msData.find(m => m.MS名 === obj.ms);
    if (!ms) return { ok: false };
    state.ms = ms;
    // 손상된 저장본이 들어와도 계산이 어긋나지 않게 아는 값만 받는다
    state.stage = [0, 4, 6].includes(Number(obj.stage)) ? Number(obj.stage) : 6;
    state.expansion = C.EXPANSION_SKILLS.includes(obj.expansion) ? obj.expansion : C.EXPANSION_NONE;
    // 불러온 구성이 그대로 보이도록 변형·스킬 표시는 초기 상태로 되돌린다.
    // (스킬 선택은 기체별 인덱스라 다른 기체를 불러오면 어긋난다)
    // 기본 제외(banned)는 기체를 가리지 않는 영구 설정이므로 불러오기에서 건드리지 않는다.
    state.form = 'normal';
    state.openWeapons = [];
    state.skillPicks.clear();
    state.staggerOn.clear();    // 불러온 구성도 방어 스킬 체크는 새로 시작한다(이전 기체 것이 남지 않게)
    // 주무장 LV 는 **구성이 들고 있을 때만** 물려받는다. 공유·갤러리 구성에는 이 값이
    // 아예 없어서(serialize 가 안 싣는다) null 로 떨어진다 — 안 그러면 남이 올린 구성을
    // **내가 보던 LV** 로 그려 위력도 레벨링크 보너스도 그 구성의 값이 아니게 된다.
    // 내 저장 목록에서 온 것은 저장할 때의 LV 를 그대로 되살린다.
    state.weaponLv = Number.isInteger(obj.weaponLv) && obj.weaponLv >= 1 ? obj.weaponLv : null;
    state.thrusterOn.clear();
    clearAutoResults();         // 이전 기체의 자동 구성 후보가 남아 잘못 적용되지 않게 지운다
    clearTargets();             // 목표도 마찬가지 — 이전 기체 기준 절댓값이라 그대로 두면 못 맞춘다
    // expLevel 이 없던 시절의 저장본은 앱 기본값(최대 레벨)으로 맞춘다
    // 1~최대 사이의 정수만 받는다 — 2.5·99 를 그대로 두면 레벨 칸이 빈칸으로 보인다
    const xl = Math.floor(Number(obj.expLevel));
    state.expLevel = xl >= 1 && xl <= C.MAX_EXPANSION_LEVEL ? xl : C.MAX_EXPANSION_LEVEL;
    // 손상되거나 다른 기체·단계의 저장본이 들어와도 규칙(슬롯·중복·8개)을 지키도록,
    // 저장 순서대로 실제 장착 판정을 통과하는 파츠만 받는다.
    // 배열이 아니면 빈 것으로 — 저장 목록·갤러리 어디서 와도 여기서 한 번 더 막는다
    const wanted = Array.isArray(obj.parts) ? obj.parts : [];
    state.equipped = [];
    // 빠진 이유를 나눠 센다 — 「기본 제외」는 본인이 해 둔 설정인데 예전엔 이것까지
    // '알 수 없는 파츠' 로 뭉뚱그려서, 데이터가 잘못된 것처럼 읽혔다.
    let banned = 0;
    for (const n of wanted) {
      const p = partByName.get(n);
      if (p && state.banned.has(n)) { banned++; continue; }   // 기본 제외한 파츠는 불러온 구성에서도 빼둔다
      if (p && C.checkEquip(p, ms, state.equipped, C.calcSlots(ms, state.equipped, state.stage, fullst)).ok) {
        state.equipped.push(p);
      }
    }
    const missing = wanted.length - state.equipped.length - banned;
    state.locked.clear();
    syncStageSeg();
    $('#expansion').value = state.expansion;
    const expLv = $('#expLevel');
    expLv.value = String(state.expLevel);
    expLv.disabled = state.expansion === C.EXPANSION_NONE;
    renderAll();
    setView('build');
    return { ok: true, missing, banned };
  }

  /** 불러오기 결과에 덧붙일 안내. 빠진 이유를 구분해 준다 — 원인이 다르면 할 일도 다르다. */
  function loadNote(r) {
    const parts = [];
    if (r.missing) parts.push(`알 수 없는 파츠 ${r.missing}개`);
    if (r.banned) parts.push(`기본 제외한 파츠 ${r.banned}개`);
    return parts.length ? ' — ' + parts.join(' · ') + ' 제외' : '';
  }

  function syncStageSeg() {
    const seg = $('#stageSeg');
    if (seg) [...seg.children].forEach(c => c.classList.toggle('on', Number(c.dataset.v) === state.stage));
  }

  const STAGE_LABEL = { 0: '미강화', 4: '4단계', 6: '풀강' };

  /**
   * 강화 단계 변경.
   * 단계를 내리면 강화로 늘어난 슬롯이 줄어 기존 구성이 성립하지 않을 수 있으므로,
   * 확인을 받고 파츠를 초기화한다.
   * 6→4 도 예외가 아니다 — 슬롯 증가가 강화리스트 5·6번째 항목에 들어간 기체
   * (걈플란 TR-5 LV4, 바운드 독 LV2)는 6→4 에서도 슬롯이 줄어든다.
   * 레벨 전환과 규칙을 맞추기 위해 내리는 경우는 항상 초기화한다.
   */
  function setStage(v) {
    if (v === state.stage) return;
    const resets = v < state.stage && state.equipped.length > 0;
    if (resets && !confirm(
      `${STAGE_LABEL[v]}로 내리면 강화로 늘어난 슬롯이 줄어 지금 구성을 유지할 수 없습니다.\n\n`
      + `장착한 파츠 ${state.equipped.length}개를 모두 해제하고 진행할까요?`)) return;

    state.stage = v;
    if (resets) { state.equipped = []; state.locked.clear(); }
    syncStageSeg();
    renderAll();
    if (resets) toast(`${STAGE_LABEL[v]}로 변경해 장착 파츠를 초기화했습니다`);
  }

