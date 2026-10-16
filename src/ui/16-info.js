  /* ui/16-info.js — 기체 정보 화면.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ===================== 기체 정보 화면 =====================
     기체 선택 화면의 **오른쪽 칸**이다. 왼쪽에서 고르면 여기가 채워진다 —
     화면을 옮겨 다니지 않으므로 기체를 여러 개 견주기 좋다.
     좁은 화면에서는 나란히 둘 폭이 없어 이 칸이 목록 위를 덮는다. */

  // 오른쪽 칸이 보여 주는 기체. state.ms(구성 중인 기체)와 따로 둔다 —
  // 여기서 LV 을 바꿔 보는 것이 아직 시작도 안 한 구성을 건드리면 안 된다.
  let infoMs = null;
  // 정보 칸의 무장 상태 필터. 무장 표와 따로 둔다 — 화면이 달라 같이 움직일 이유가 없다.
  let infoWpnMode = 'all';
  // 정보 칸의 스킬 상태 필터. 무장 쪽과 따로 둔다 — 보는 대상이 달라 같이 움직일 이유가 없다.
  let infoSkMode = 'all';
  // 스킬 분류 필터 — 'all' 또는 원문 분류 키(足回り·攻撃…).
  let infoSkCat = 'all';

  /** 기체 정보 칸을 닫는다. 고른 기체는 그대로 둔다 — 닫았다고 선택까지 풀면
   *  다시 열었을 때 빈 칸이 나와 당황스럽다. */
  function closeInfo() {
    pnRestoreInfo();          // 패치노트에서 열었으면 칸을 제자리에 돌려놓는다
    document.body.classList.remove('info-open');
    infoMs = null;
    renderMsList();          // 카드 테두리도 같이 푼다
  }

  /** 목록에서 이 기체 카드가 화면 어디에 있는지(세로). 없으면 null. */
  function cardTopOf(name) {
    const grid = $('#msList');
    if (!grid) return null;
    for (const c of grid.querySelectorAll('.ms-card')) {
      if (c.dataset.ms === name) return c.getBoundingClientRect().top;
    }
    return null;
  }

  function openInfo(m) {
    if (!m) return;
    /* 정보 칸이 열리면 왼쪽 목록이 좁아져 카드가 **통째로 재배치**된다 — 실측으로
       첫 카드가 102px 튀었다. 손가락 밑에서 누른 것이 움직이는 셈이라
       「i 를 눌렀는데 엉뚱한 게 눌렸다」는 느낌을 준다(전에는 여기에 0.18초 애니메이션까지
       얹혀 있었다). 누른 카드의 자리를 기억했다가 그린 뒤 스크롤로 되돌려 붙든다. */
    const wasTop = cardTopOf(m.MS名);
    infoMs = m;
    // 화면을 옮기지 않는다 — 오른쪽 칸을 채울 뿐이다.
    // 좁은 화면에서는 그 칸이 목록 위를 덮는다(CSS 가 body.info-open 을 본다).
    document.body.classList.add('info-open');
    $('#infoBody').hidden = false;
    renderInfo();
    // 고른 카드에 테두리를 준다. 목록을 다시 그려야 옛 선택이 풀린다.
    renderMsList();
    // 재배치로 카드가 움직인 만큼 스크롤을 되돌린다 — 누른 것이 제자리에 남는다.
    if (wasTop != null) {
      const nowTop = cardTopOf(m.MS名);
      const grid = $('#msList');
      if (nowTop != null && grid) grid.scrollTop += (nowTop - wasTop);
    }
    // 갤러리 구성은 칸을 여는 김에 받아 둔다(캐시가 있으면 그것부터 보인다)
    if (S && !galleryList.length) {
      galleryList = S.readCache();
      renderInfoBuilds();
      loadGallery().then(renderInfoBuilds);
    }
    // 표가 들어오면 순서가 바뀌므로 구성 목록을 다시 그린다.
    loadVotes('ms');
    loadVotes('build').then(renderInfoBuilds);
  }

  /** 「파츠 고르기」 — 오른쪽 칸에서 보던 LV 그대로 파츠 화면으로 넘어간다. */
  function infoGoBuild() {
    pnRestoreInfo();          // 화면을 떠나기 전에 칸을 제자리로
    if (!infoMs) return;
    selectMs(infoMs);
    setView('build');
  }

  function renderInfo() {
    const m = infoMs;
    if (!m) return;
    const img = $('#infoImg');
    if (img) {
      const box = img.parentNode;
      const thumb = () => {
        box.classList.remove('illust');
        img.onerror = () => { img.onerror = null; img.src = defaultImg('ms'); };
        img.src = msImg(m.MS名);
      };
      const url = illustUrl(m.MS名);
      if (url) {
        box.classList.add('illust');
        img.onerror = thumb;          // 공식에 없는 기체(84기)·오프라인이면 썸네일로
        img.src = url;
      } else thumb();
    }

    // 이름은 위키로 이어 준다 — 성능 머리와 같은 방식
    const nameBox = $('#infoName');
    nameBox.innerHTML = '';
    if (m.wiki_url) {
      const a = el('a', 'hero-wiki', T.msName(m.MS名));
      a.href = m.wiki_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.title = '위키에서 이 기체 보기 (새 창)';
      nameBox.append(a);
    } else nameBox.textContent = T.msName(m.MS名);

    // 속성 · 코스트 · 등급
    const tags = $('#infoTags');
    tags.innerHTML = '';
    tags.append(attrMark(m.属性), el('span', '', T.attrName(m.属性)));
    tags.append(el('span', 'cost-badge', '코스트 ' + m.コスト));
    const r = msRarity(m);
    if (r) tags.append(rarityChip(r));

    // LV 탭 — 여기서 바꾸면 이 화면만 바뀐다(구성은 아직 시작도 안 했다)
    const lvs = $('#infoLvs');
    lvs.innerHTML = '';
    const fam = msByBase.get(baseName(m.MS名)) || [m];
    if (fam.length > 1) for (const x of fam) {
      const b = el('button', 'mi-lv' + (x === m ? ' on' : ''), 'LV' + msLevel(x));
      b.onclick = () => { infoMs = x; renderInfo(); };
      lvs.append(b);
    }

    factsInto(m, $('#infoFacts'), $('#infoFacts2'));
    // 기체 추천·비추. 기체는 LV 마다 나누지 않고 **기체 단위**로 센다 —
    // LV 별로 갈라 두면 표가 흩어져 티어표 구실을 못 한다.
    const vb = $('#infoVote');
    vb.innerHTML = '';
    vb.append(el('span', 'mi-vote-lb', '이 기체'), voteBar('ms', baseName(m.MS名)));
    renderInfoStats(m);
    renderInfoStagger(m);
    renderInfoWeapons(m);
    renderInfoSkills(m);
    renderInfoFullst(m);
    renderInfoBuilds();
    renderInfoVideos();
    fitInfoHeights();
  }

  /* 막대의 기준값. 상한이 있는 스탯은 상한(core 의 DEFAULT_LIMITS)을 쓰고,
     상한이 없는 것(HP·고속이동·선회)은 데이터 전체의 최댓값을 쓴다.
     기준이 없으면 막대가 뜻을 잃는다 — 「이 기체가 전체에서 어디쯤인가」가 요점이다. */
  const MI_SCALE = (() => {
    const max = f => msData.reduce((a, x) => Math.max(a, Number(x[f]) || 0), 0);
    return {
      HP: max('HP'), 耐実弾補正: 50, 耐ビーム補正: 50, 耐格闘補正: 50,
      射撃補正: 100, 格闘補正: 100, スピード: 200,
      高速移動: max('高速移動'), スラスター: 100,
      旋回_地上_通常時: max('旋回_地上_通常時'), 旋回_宇宙_通常時: max('旋回_宇宙_通常時')
    };
  })();

  // 정보 칸의 성능을 통상으로 볼지 변형으로 볼지. 기체가 바뀌어도 유지한다.
  let infoForm = 'normal';

  /* 변형 수치는 네 가지만 따로 있다(스피드·고속이동·선회 지상/우주).
     트랜잠처럼 変形 스탯이 없는 기체는 override 의 _altMode 가 절댓값을 들고 있다
     — 거기엔 사격·격투 보정도 들어 있다. 둘 다 없으면 통상 값을 그대로 쓴다. */
  const INFO_ALT_KEY = {
    'スピード': 'speed', '高速移動': 'highSpeedMovement',
    '旋回_地上_通常時': 'turnPerformanceGround', '旋回_宇宙_通常時': 'turnPerformanceSpace',
    '射撃補正': 'shoot', '格闘補正': 'meleeCorrection'
  };
  const INFO_TF_FIELD = {
    'スピード': 'スピード_変形時', '高速移動': '高速移動_変形時',
    '旋回_地上_通常時': '旋回_地上_変形時', '旋回_宇宙_通常時': '旋回_宇宙_変形時'
  };
  function infoStatOf(m, field, form) {
    if (form !== 'alt') return m[field];
    const alt = m._altMode, k = INFO_ALT_KEY[field];
    if (alt && k && alt[k] != null) return alt[k];
    const tf = INFO_TF_FIELD[field];
    if (tf && m[tf] != null) return m[tf];
    return m[field];
  }

  function renderInfoStats(m) {
    const box = $('#infoStats');
    box.innerHTML = '';

    // 통상/변형 — 변형 수치가 있는 기체에만. 「모든 상태」는 없다(수치는 하나여야 한다).
    const alt = altModeOf(m);
    const seg = $('#infoStatMode');
    if (seg) {
      seg.innerHTML = '';
      seg.hidden = !alt;
      if (!alt) infoForm = 'normal';
      else for (const [v, label] of [['normal', '통상'], ['alt', alt.label]]) {
        const b = el('button', 'seg-btn' + (infoForm === v ? ' on' : ''), label);
        b.onclick = () => { infoForm = v; renderInfoStats(m); };
        seg.append(b);
      }
    }
    const row = (k, v, field) => {
      const d = el('div', 'mi-st');
      // 통상과 값이 다르면 눈에 띄게 — 변형으로 무엇이 달라지는지가 요점이다
      if (field && infoForm === 'alt' && infoStatOf(m, field, 'alt') !== m[field]) d.classList.add('alt');
      const ki = el('i', '', k);
      ICON.prepend(ki, MI_STAT_IC[k]);
      d.append(ki, el('b', '', v));
      // 막대는 기준이 있는 항목에만. 재출격처럼 '작을수록 좋은' 값엔 안 붙인다.
      const cap = field && MI_SCALE[field];
      const raw = field && Number(infoStatOf(m, field, infoForm));
      if (cap && raw) {
        const bar = el('span', 'mi-bar');
        const fill = el('i');
        fill.style.width = Math.min(100, (raw / cap) * 100).toFixed(1) + '%';
        bar.append(fill);
        d.append(bar);
      }
      box.append(d);
    };
    const n = v => (v == null ? '—' : Number(v).toLocaleString());
    const f = k => n(infoStatOf(m, k, infoForm));
    row('HP', f('HP'), 'HP');
    row('내실탄 보정', f('耐実弾補正'), '耐実弾補正');
    row('내빔 보정', f('耐ビーム補正'), '耐ビーム補正');
    row('내격투 보정', f('耐格闘補正'), '耐格闘補正');
    row('사격 보정', f('射撃補正'), '射撃補正');
    row('격투 보정', f('格闘補正'), '格闘補正');
    row('스피드', f('スピード'), 'スピード');
    row('고속이동', f('高速移動'), '高速移動');
    row('슬러스터', f('スラスター'), 'スラスター');
    row('선회(지상)', f('旋回_地上_通常時'), '旋回_地上_通常時');
    row('선회(우주)', f('旋回_宇宙_通常時'), '旋回_宇宙_通常時');
    row('재출격', m['再出撃時間'] == null ? '—' : m['再出撃時間'] + '초');

    renderInfoStagger(m);

    // 파츠 칸은 칸 수 자체가 뜻이라 막대가 아니라 **눈금**으로 그린다.
    // 「17칸」보다 ▮ 열일곱이 한눈에 들어온다(게임 화면도 그렇게 보여 준다).
    const sb = $('#infoSlots');
    sb.innerHTML = '';
    for (const [k, v] of [['근접', m['近スロット']], ['중거리', m['中スロット']], ['원거리', m['遠スロット']]]) {
      const d = el('div', 'mi-slot');
      const ki = el('i', '', k);
      ICON.prepend(ki, SLOT_IC[k]);
      d.append(ki, el('b', '', v == null ? '—' : String(v)));
      const pips = el('span', 'mi-pips');
      for (let i = 0; i < Math.min(Number(v) || 0, 30); i++) pips.append(el('u'));
      d.append(pips);
      sb.append(d);
    }
  }

  /**
   * 이 무장이 거는 것 — 경직 / 강경직 / 다운.
   * 한글 備考(noteText)에서 읽는다. 무장 상세의 칩과 **같은 말**을 봐야
   * 두 화면이 다른 말을 하지 않는다.
   * 강경직이 있으면 경직은 적지 않는다 — 둘 다 붙으면 줄만 길어진다.
   */
  /**
   * 이 무장이 **강경직**을 거는가, 그리고 그게 **조건부인가**.
   *   null · { cond: false } · { cond: true }
   *
   * 備考 는 ` / ` 로 끊어 적는데, 조건과 효과가 **다른 조각**에 있을 수 있다:
   *     … / 공격 대상이 공중에 있는 경우, 다음과 같은 효과를 발휘 / 강경직 있음 / …
   * 조각 하나만 보면 「강경직 있음」이라 조건이 안 보인다(F89 가 그랬다).
   * 그래서 앞 조각이 연 조건을 **물려받아** 본다.
   *
   * 한국어·일본어를 다 받는다 — 기체 정보는 한글 備考 를, 피탄 시뮬은 원문을 본다.
   * DB 전체로는 148개 중 33개가 조건부다(집속 30 · 공중의 적 3, 2026-10-10 실측).
   */
  const STAG2 = /강경직|大よろけ|強よろけ/;
  /** 뒤따르는 조각들에 걸리는 조건을 **여는** 조각 */
  const STAG2_OPENS = /(?:경우|때|중|시|場合|時)\s*[,、]?\s*(?:다음과 같은|아래|以下の)\s*(?:효과|効果)/;
  /** 조각 **자체**가 품은 조건 */
  const STAG2_SELF = /집속|集束|발동\s*중|発動中|변형|変形|경우|場合|때|이상|중일/;
  function stag2Of(text) {
    const t = String(text || "");
    if (!STAG2.test(t)) return null;
    let open = false, found = false, cond = false;
    for (const seg of t.split(/\s*\/\s*/)) {
      if (STAG2_OPENS.test(seg)) { open = true; continue; }
      if (!STAG2.test(seg)) continue;
      found = true;
      if (STAG2_SELF.test(seg) || open) cond = true;
    }
    /* 조각으로 안 끊긴 글(피탄 시뮬은 두 값을 이어 붙여 넘긴다)이면 통째로 본다. */
    if (!found) return { cond: STAG2_SELF.test(t) };
    return { cond };
  }

  function weaponTagsOf(w) {
    const t = noteText((w.info && w.info['備考']) || '');
    if (!t) return [];
    const out = [];
    const s2 = stag2Of(t);
    /* 조건부면 **조건부라고 적는다**(사용자 지시) — 그냥 「강경직」으로 두면
       늘 강경직인 무장과 구별이 안 된다(F89·걍 개량형은 공중의 적에게만 걸린다). */
    if (s2) out.push({ t: s2.cond ? '조건부 강경직' : '강경직', cls: 't-stag2' + (s2.cond ? ' cond' : ''), ic: 'stagger2', keepText: !!s2.cond });
    else if (/경직\s*있음|즉시\s*발사\s*경직|집속\s*시\s*경직/.test(t)) out.push({ t: '경직', cls: 't-stag', ic: 'stagger' });
    if (/다운/.test(t)) out.push({ t: '다운', cls: 't-down' });
    return out;
  }

  // I필드를 켜 두고 볼 것인가. 기체를 바꿔도 유지한다 — 보는 방식이지 구성이 아니다.
  let infoIField = false;

  /**
   * 높이의 기준은 **가운데 기둥**이다.
   *   · 오른쪽 — 그림을 늘렸다 줄여 기둥을 가운데에 맞춘다(공식 일러스트는 세로가 길어
   *     그냥 두면 혼자 튀어나간다).
   *   · 왼쪽 — 남는 높이를 무장 55 : 스킬 45 로 나눈다. 무장을 넓게 잡는 이유는
   *     눌러서 상세를 펼치면 길어지기 때문이다 — 짧은 기체라 남아도 그대로 둔다.
   * 한 번만 재고 끝낸다. 맞춘 뒤 다시 재면 값이 오가며 깜빡인다.
   */
  function fitInfoHeights() {
    const cols = [...document.querySelectorAll('.mi-cols > .mi-col')];
    if (cols.length < 3) return;
    const left = cols[0], mid = cols[1], right = cols[2];
    const img = $('#infoImg');
    const box = img && img.parentNode;
    // 좁은 화면에서는 기둥이 한 줄로 쌓여 맞출 것이 없다.
    // 「윗변이 같은가」로 봤더니 두 기둥만 나란한 중간 폭에서 넓은 화면으로 잘못 보고
    // 그림 높이를 박아 칸이 들쭉날쭉해졌다 — CSS 가 쌓기 시작하는 값과 같은 기준을 본다.
    if (window.innerWidth <= 1436) {
      if (box) box.style.removeProperty('height');
      left.style.removeProperty('--mi-h');
      return;
    }
    if (box) box.style.removeProperty('height');
    left.style.setProperty('--mi-h', '640px');
    const want = mid.getBoundingClientRect().height;

    // 오른쪽: 그림 높이를 조절해 기둥을 가운데에 맞춘다
    if (box) {
      const rest = right.getBoundingClientRect().height - box.getBoundingClientRect().height;
      const h = Math.max(120, Math.min(420, want - rest));
      box.style.height = h + 'px';
    }
    // 왼쪽: 머리·제목이 차지하는 몫을 뺀 나머지를 55:45 로 채운다.
    // 두 칸은 고정 높이(height)다 — max-height 로 두면 내용이 짧을 때 안 늘어나
    // 기둥이 짧게 끝난다(무장 5종 기체에서 534 vs 700 으로 벌어졌다).
    const head = left.getBoundingClientRect().height
      - ($('#infoWpn') ? $('#infoWpn').getBoundingClientRect().height : 0)
      - ($('#infoSk') ? $('#infoSk').getBoundingClientRect().height : 0);
    left.style.setProperty('--mi-h', Math.max(280, want - head) + 'px');
  }

  /** 누적치 내성 — 다섯 상황을 한 칸에. 값을 만든 스킬을 같이 적는다. */
  function renderInfoStagger(m) {
    const box = $('#infoStagger');
    if (!box) return;
    box.innerHTML = '';
    const cats = staggerByCategory(m, msLevel(m), infoIField);

    // I필드가 있는 기체에만 버튼을 띄운다.
    const bar = $('#infoStgBtns');
    if (bar) {
      bar.innerHTML = '';
      bar.hidden = !cats.iField;
      if (cats.iField) {
        const b = el('button', 'mi-sg-btn' + (infoIField ? ' on' : ''), 'I필드');
        b.title = cats.iField.ko + ' — 빔이 그 부위에 맞았을 때만 걸립니다.\n'
          + '켜면 다섯 칸 모두에 반영합니다.';
        b.onclick = () => { infoIField = !infoIField; renderInfoStagger(m); };
        bar.append(b);
      }
    }
    const top = Math.max(...cats.map(c => c.value));
    for (const c of cats) {
      const r = el('div', 'mi-sg' + (c.key === '최대' ? ' top' : ''));
      r.append(el('i', '', c.key));
      r.append(el('b', '', c.value + '%'));
      // 통상보다 높을 때만 무엇이 올렸는지 적는다 — 같은 값이면 적을 게 없다.
      const by = el('span', 'mi-sg-by');
      for (const x of c.picks) {
        const chip = el('span', 'mi-sg-chip', x.ko);
        chip.title = x.ko + ' · ' + x.cond;
        by.append(chip);
      }
      r.append(by);
      box.append(r);
    }
    const note = $('#infoStgNote');
    if (note) note.textContent = top > cats[0].value ? '통상 ' + cats[0].value + '% 기준' : '';
  }

  // 무장 속성 → 한글 한 낱말. 무장 표의 유형 칸과 같은 말을 쓴다.
  const MI_ATTR_KO = { beam: '빔', solid: '실탄', melee: '격투', shield: '실드', other: '기타' };

  function renderInfoWeapons(m) {
    const box = $('#infoWpn');
    box.innerHTML = '';
    const all = weaponsOfMs(m);
    renderWeaponModeSeg($('#infoWpnMode'), m, all, infoWpnMode, v => {
      infoWpnMode = v;
      renderInfoWeapons(m);
    });
    const list = all.filter(w => weaponInMode(w, infoWpnMode));
    $('#infoWpnH').textContent = '무장' + (all.length
      ? (list.length === all.length ? ' ' + all.length + '종' : ' ' + list.length + ' / ' + all.length + '종')
      : '');
    if (!list.length) { box.append(el('div', 'detail-empty', wikiPending(m) ? WIKI_PENDING_TXT : '무장 정보가 없습니다.')); return; }
    const lv = msLevel(m);
    for (const w of list) {
      const d = el('div', 'mi-w');
      const wn = T.weaponName ? T.weaponName(w.name) : w.name;
      const nmEl = el('span', 'nm', wn);
      nmEl.title = wn;              // 줄여 놓았으니 전체 이름은 올려 보면 나온다
      d.append(nmEl);
      // 무엇을 거는 무장인가 — 경직·강경직·다운. 목록에서 「눕히는 무장」을 바로 찾게 한다.
      for (const t of weaponTagsOf(w)) {
        const tg = el('span', 'mi-wtag ' + t.cls, t.t);
        /* 경직·강경직은 아이콘만(이름 자리를 넓힌다). 조건부는 「조건부」 글자가 정보라 글자를 둔다.
           다운은 정해 둔 아이콘이 없어 글자 그대로. */
        if (t.ic && !t.keepText) ICON.only(tg, t.ic); else if (t.ic) ICON.prepend(tg, t.ic);
        d.append(tg);
      }
      // 상태를 가리는 무장이면 어느 상태인지 적어 준다 — 합쳐 보고 있을 때 특히 필요하다
      const md = weaponModeOf(w);
      if (md) d.append(el('span', 'mi-wmode', md.label));
      // 실드는 attr 가 비어 있고 type 에만 들어 있다 — 무장 표와 같은 판정을 쓴다
      const at = (w.attr === 'shield' || w.type === 'shield') ? 'shield' : w.attr;
      const tyEl = el('span', 'ty', MI_ATTR_KO[at] || '—');
      ICON.only(tyEl, ICON.ATTR[at]);   // 실드·기타는 아이콘이 없어 글자 그대로
      d.append(tyEl);
      // 위력은 이 기체 LV 에 맞는 칸을 본다. 실드처럼 위력이 없는 무장은 「—」.
      // weaponLevel() 은 state.ms 를 보므로 여기서는 못 쓴다 — 아직 고르지 않은 기체다.
      const keys = Object.keys(w.levels || {}).map(Number).sort((a, b) => a - b);
      const fit = keys.filter(k => k <= lv);
      const lvl = keys.length ? w.levels[String(fit.length ? fit[fit.length - 1] : keys[0])] : null;
      const pw = lvl && (lvl.power || lvl.powerCharged);
      const onlyCharged = !!(lvl && !lvl.power && lvl.powerCharged);
      const pv = el('b', '', pw ? Number(pw).toLocaleString() : '—');
      if (onlyCharged) {
        pv.classList.add('charged');
        pv.title = '집속해야 쏘는 무장이라 집속 위력을 적습니다';
        d.append(el('span', 'mi-wchg', '집속'));
      }
      d.append(pv);

      // 눌러야 상세가 나온다. 파츠 화면의 무장 표와 **같은 상세**를 쓴다 —
      // 두 화면이 같은 무장을 다르게 설명하면 안 된다.
      d.onclick = () => {
        const open = d.classList.toggle('on');
        for (const x of box.querySelectorAll('.weapon-detail')) x.remove();
        for (const x of box.querySelectorAll('.mi-w.on')) if (x !== d) x.classList.remove('on');
        if (!open) return;
        d.after(weaponDetailBox(w, lvl || {}, keys.length ? (fit.length ? fit[fit.length - 1] : keys[0]) : lv, false));
      };
      box.append(d);
    }
  }

  function renderInfoSkills(m) {
    const box = $('#infoSk');
    box.innerHTML = '';
    const modes = msSkillsData[baseName(m.MS名)] || [];

    // 모든 상태 / 통상 / 변형 — 무장 쪽과 같은 말을 쓴다.
    const seg = $('#infoSkMode');
    if (seg) {
      seg.innerHTML = '';
      seg.hidden = modes.length < 2;
      if (modes.length >= 2) {
        const altMd = modes.find(isAltSkillMode);
        const altLb = (altMd && SKILL_MODE_KO[altMd.mode]) || '변형';
        const lb = /(중|시|후)$/.test(altLb) ? altLb : altLb + ' 시';
        // 「모든 상태」는 두지 않는다 — 스킬은 상태마다 아예 다른 묶음이라
        // 합쳐 놓으면 어느 쪽 스킬인지 알 수 없다(사용자 결정).
        if (infoSkMode === 'all') infoSkMode = 'normal';
        for (const [v, label] of [['normal', '통상'], ['alt', lb]]) {
          const b = el('button', 'seg-btn' + (infoSkMode === v ? ' on' : ''), label);
          b.onclick = () => { infoSkMode = v; renderInfoSkills(m); };
          seg.append(b);
        }
      } else infoSkMode = 'all';
    }
    // 「모든 상태」는 통상+변형을 합친 것이다. 첫 모드만 보면 변형 기체(64기)의
    // 변형 스킬이 통째로 안 보인다.
    const want = modes.filter(md => infoSkMode === 'all'
      || (infoSkMode === 'alt' ? isAltSkillMode(md) : !isAltSkillMode(md)));
    const skills = (want.length ? want : modes).flatMap(md => md.skills || []);
    if (!skills.length) {
      $('#infoSkH').textContent = '스킬';
      box.append(el('div', 'detail-empty', wikiPending(m) ? WIKI_PENDING_TXT : '스킬 정보가 없습니다.'));
      return;
    }
    // 스킬 목록 패널과 같은 규칙으로 이 LV 의 구간 하나씩만 고른다.
    const lv = msLevel(m);
    const groups = new Map();
    for (const sk of skills) {
      const key = sk.cat + '|' + sk.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(sk);
    }
    const picked = [];
    for (const cands of groups.values()) {
      const chosen = pickByMsLv(cands, lv);
      if (chosen) picked.push(chosen);
    }
    $('#infoSkH').textContent = '스킬' + (picked.length ? ' ' + picked.length + '종' : '');
    if (!picked.length) { box.append(el('div', 'detail-empty', '이 LV 에서 표시할 스킬이 없습니다.')); return; }

    const order = ['足回り', '攻撃', '防御', '移動', '格闘', '射撃', 'その他', ''];
    const byCat = new Map();
    for (const sk of picked) { if (!byCat.has(sk.cat)) byCat.set(sk.cat, []); byCat.get(sk.cat).push(sk); }
    const cats = [...byCat.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));

    // 분류 칩 — 스킬이 스물 가까이 되면 한 덩어리로는 못 읽는다.
    // 「기타」로 뭉뚱그리지 않고 이 기체에 실제로 있는 분류만 띄운다.
    const catBar = $('#infoSkCats');
    if (catBar) {
      catBar.innerHTML = '';
      catBar.hidden = cats.length < 2;
      if (cats.length >= 2) {
        if (infoSkCat !== 'all' && !cats.includes(infoSkCat)) infoSkCat = 'all';
        const mk = (v, label, n) => {
          const b = el('button', 'mi-skcatbtn' + (infoSkCat === v ? ' on' : ''), label);
          ICON.prepend(b, SKILL_CAT_IC[v]);
          b.append(el('u', '', String(n)));
          b.onclick = () => { infoSkCat = v; renderInfoSkills(m); };
          catBar.append(b);
        };
        mk('all', '전체', picked.length);
        for (const c of cats) mk(c, SKILL_CAT_KO[c] || c || '기타', byCat.get(c).length);
      } else infoSkCat = 'all';
    }

    for (const cat of cats) {
      if (infoSkCat !== 'all' && infoSkCat !== cat) continue;
      // 하나만 고른 상태에서는 소제목이 군더더기다
      if (infoSkCat === 'all') {
        const h = el('div', 'mi-skcat', SKILL_CAT_KO[cat] || cat || '기타');
        ICON.prepend(h, SKILL_CAT_IC[cat]);
        box.append(h);
      }
      // 칩을 하나씩 늘어놓으면 이름이 길 때 줄이 어긋난다 — 무장처럼 줄로 세운다.
      for (const sk of byCat.get(cat)) {
        const r = el('div', 'mi-skrow');
        r.append(el('span', 'nm', skTr(sk.name)));
        if (sk.lv) r.append(el('span', 'lv', sk.lv));
        r.onclick = () => {
          const open = r.classList.toggle('on');
          for (const x of box.querySelectorAll('.mi-skdesc')) x.remove();
          for (const x of box.querySelectorAll('.mi-skrow.on')) if (x !== r) x.classList.remove('on');
          if (!open) return;
          const d = el('div', 'mi-skdesc');
          if (sk.eff) d.append(el('div', 'mi-skeff', skTr(sk.eff)));
          if (sk.desc) d.append(el('div', 'mi-skdd', skTr(sk.desc)));
          if (!sk.eff && !sk.desc) d.append(el('div', 'mi-skdd', '설명이 없습니다.'));
          r.after(d);
        };
        box.append(r);
      }
    }
  }

  /**
   * 강화 리스트 — 풀강까지 6단계에 무엇이 붙는지.
   * 파츠 화면의 「강화 ?」 모달과 **같은 효과 변환기**(fullstEffText)를 쓴다.
   * 따로 만들면 한쪽만 표기가 어긋난다.
   */
  function renderInfoFullst(m) {
    const box = $('#infoFullst');
    if (!box) return;
    box.innerHTML = '';
    const list = Array.isArray(m.fullst) ? m.fullst : [];
    $('#infoFsNote').textContent = list.length ? list.length + '단계' : '';
    if (!list.length) {
      box.append(el('div', 'detail-empty', '이 기체는 강화 리스트 자료가 없습니다.'));
      return;
    }
    list.forEach((entry, i) => {
      const row = el('div', 'mi-fs');
      row.append(el('i', '', String(i + 1).padStart(2, '0')));
      const mid = el('span', 'mi-fs-mid');
      mid.append(el('b', '', T.fullstName(entry.name) + ' LV' + entry.level));
      const def = fullst.find(d => d.name === entry.name);
      const lv = def && (def.levels || []).find(l => Number(l.level) === Number(entry.level));
      const effs = lv ? fullstEffText(lv.effects) : [];
      mid.append(el('span', 'mi-fs-eff', effs.length ? effs.map(e => e.txt).join(' · ') : '값 없음'));
      row.append(mid);
      // 위키가 이 LV 의 필요 강화값을 안 적어 둔 기체가 있다. 0 으로 보이면 거짓이다.
      row.append(el('span', 'mi-fs-pt', entry.points == null ? '—' : entry.points.toLocaleString()));
      box.append(row);
    });
  }

  /**
   * 갤러리에 올라온 이 기체의 구성.
   * 지금은 **최근 순**이다 — 추천/비추 투표가 아직 없어 「추천 순」이라고 하면 거짓이 된다.
   * 투표가 붙으면 정렬과 제목만 바꾸면 된다.
   */
  function renderInfoBuilds() {
    const box = $('#infoBuilds');
    if (!box || !infoMs) return;
    box.innerHTML = '';
    // 같은 기체의 다른 LV 구성도 함께 보여 준다 — LV 만 다른 구성을 숨길 이유가 없다
    const base = baseName(infoMs.MS名);
    const list = (galleryList || [])
      .filter(b => baseName(String(b.ms || '')) === base)
      // 추천에서 비추를 뺀 점수. 같으면 추천이 많은 쪽, 그다음 최신순.
      .sort((a, b) => voteScore(b.id) - voteScore(a.id)
        || voteUp(b.id) - voteUp(a.id) || b.at - a.at);
    $('#infoBuildCnt').textContent = list.length ? list.length + '개' : '';
    if (!list.length) {
      box.append(el('div', 'detail-empty', galleryLoading
        ? '불러오는 중…'
        : '아직 이 기체로 올라온 구성이 없습니다.'));
      return;
    }
    for (const bld of list) {
      const otherLv = bld.ms !== infoMs.MS名;
      const sub = [relTime(bld.at), otherLv && T.msName(bld.ms)].filter(Boolean).join(' · ');
      box.append(buildSummaryCard(bld, {
        sub, uniform: true, desc: bld.desc, author: bld.author, vote: bld.id,
        onOpen: () => {
          fromGallery = false;
          const r = deserialize(bld);
          if (!r.ok) toast('이 구성의 기체가 내 데이터에 없습니다');
          else toast('「' + bld.name + '」 가져왔습니다' + loadNote(r));
        }
      }));
    }
  }

