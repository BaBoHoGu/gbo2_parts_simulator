  /* ui/18-init.js — 초기화 · 모달 · 좁은 화면 표시 · 점검용 손잡이.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 초기화 ---------- */

  function buildControls() {
    // 대표 이미지. imgUrl 을 거치므로 오프라인판은 인라인, 사이트판은 images/ 파일이 된다.
    $('#brandImg').src = imgUrl('ui/brand-wide.webp');

    // 강화리스트 — 세그먼트 버튼 (미강화 / 4단계 / 풀강)
    const seg = $('#stageSeg');
    for (const [v, label] of [[0, '미강화'], [4, '4단계'], [6, '풀강']]) {
      const b = el('button', 'seg-btn' + (state.stage === v ? ' on' : ''), label);
      b.dataset.v = String(v);
      b.onclick = () => setStage(v);
      seg.append(b);
    }

    const exp = $('#expansion');
    for (const name of C.EXPANSION_SKILLS) exp.append(new Option(C.EXPANSION_LABEL[name] || name, name));

    // 확장 스킬 레벨 (LV1~LV5) — 스킬을 고르지 않았을 땐 비활성
    const expLv = $('#expLevel');
    for (let lv = 1; lv <= C.MAX_EXPANSION_LEVEL; lv++) expLv.append(new Option('LV' + lv, String(lv)));
    expLv.value = String(state.expLevel);
    const syncExpLv = () => { expLv.disabled = state.expansion === C.EXPANSION_NONE; };
    syncExpLv();
    exp.onchange = () => { state.expansion = exp.value; state.autoExpansion = false; syncExpLv(); renderAll(); };
    expLv.onchange = () => { state.expLevel = Number(expLv.value); renderAll(); };

    const preset = $('#preset');
    preset.append(new Option('— 프리셋 선택 —', ''));
    for (const name of Object.keys(O.PRESETS)) preset.append(new Option(name, name));
    preset.onchange = () => {
      if (!preset.value) return;
      state.weights = {};
      for (const k of C.STAT_KEYS) state.weights[k] = 0;
      Object.assign(state.weights, O.PRESETS[preset.value]);
      state.weightsTouched = true;
      renderAutoGrid();
    };

    // 필터 칩 공통 빌더 — 한 줄의 칩을 만들고 선택 상태를 state[key]에 반영한다
    /* 같은 필터를 두 곳에 그린다(기체 선택 화면 · 「기체 변경」 서랍). 예전처럼 누른 칩에만
       손으로 `.on` 을 붙였다 간, 한쪽에서 고른 것이 **다른 쪽 칩에는 안 보인다** —
       필터는 하나인데 화면이 둘이라고 말하는 셈이다. 그래서 상태에서 다시 칠한다. */
    const chipGroups = [];
    paintMsChips = paintChips;
    function paintChips() {
      for (const g of chipGroups) {
        const box = $(g.sel);
        if (!box) continue;
        [...box.children].forEach((c, i) => c.classList.toggle('on', state[g.key] === g.items[i].v));
      }
    }
    function buildChips(boxSel, items, key, extraClass) {
      const box = $(boxSel);
      if (!box) return;
      chipGroups.push({ sel: boxSel, items, key });
      for (const it of items) {
        const cls = 'chip'
          + (extraClass ? ' ' + extraClass(it) : '')
          + (state[key] === it.v ? ' on' : '');
        const chip = el('button', cls, it.label);
        chip.onclick = () => {
          state[key] = it.v;
          state.msLimit = 80;
          paintChips();
          renderMsList();
        };
        box.append(chip);
      }
    }

    // 속성: 전체 · 강습 · 범용 · 지원
    buildChips('#attrChips',
      [{ label: '전체', v: '' }, { label: T.attrName('強襲'), v: '強襲' },
       { label: T.attrName('汎用'), v: '汎用' }, { label: T.attrName('支援'), v: '支援' }],
      'msAttr', it => 'attr-' + it.v);
    for (const c of document.querySelectorAll('#attrChips .chip')) {
      const v = ([...c.classList].find(x => x.startsWith('attr-')) || '').slice(5);
      if (v) ICON.prepend(c, ICON.MS_ATTR[v], 'a-' + v);
    }
    buildChips('#costChips', COST_CHIPS, 'msCost');
    buildChips('#levelChips', LEVEL_CHIPS, 'msLv');
    buildChips('#rarityChips', RARITY_CHIPS, 'msRarity');
    // 티어 전용 칩 — 이 둘만 state 가 아니라 티어 쪽 변수를 본다
    const tierChips = (sel, items, get, set) => {
      const box = $(sel);
      if (!box) return;
      for (const it of items) {
        const chip = el('button', 'chip' + (get() === it.v ? ' on' : ''), it.label);
        chip.onclick = () => {
          set(it.v);
          [...box.children].forEach(c => c.classList.remove('on'));
          chip.classList.add('on');
          renderTier();
        };
        box.append(chip);
      }
    };
    tierChips('#tierSortChips',
      [{ label: '추천순', v: 'net' }, { label: '추천률', v: 'ratio' }, { label: '표 많은 순', v: 'count' }],
      () => tierSort, v => { tierSort = v; });
    tierChips('#tierShowChips',
      [{ label: '표 있는 것만', v: 'voted' }, { label: '전체', v: 'all' }],
      () => tierShow, v => { tierShow = v; });
    const msSeg = $('#msViewSeg');
    if (msSeg) msSeg.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-t]');
      if (!b) return;
      msViewTab = b.dataset.t;
      try { localStorage.setItem('gbo2.msViewTab', msViewTab); } catch (e) {}
      applyMsViewTab();
    });
    // 표가 들어오면 티어도 다시 그린다 — 갤러리 카드와 같은 훅을 쓴다
    voteRedraw.ms.push(() => { if (msViewTab === 'tier') renderTier(); });
    applyMsViewTab();
    // 서랍에도 같은 필터를 단다 — 같은 state 를 보므로 두 벌이 늘 같은 것을 가리킨다.
    buildChips('#dAttrChips',
      [{ label: '전체', v: '' }, { label: T.attrName('強襲'), v: '強襲' },
       { label: T.attrName('汎用'), v: '汎用' }, { label: T.attrName('支援'), v: '支援' }],
      'msAttr', it => it.v ? 'attr-' + it.v : '');
    buildChips('#dCostChips', COST_CHIPS, 'msCost');
    buildChips('#dLevelChips', LEVEL_CHIPS, 'msLv');
    buildChips('#dRarityChips', RARITY_CHIPS, 'msRarity');

    // 기체 선택 화면의 목록을 등록한다. 여기가 기본 동작(정보 칸 열기)을 가진다.
    addMsListView({ box: '#msList', count: '#msCount' });

    /* 빠르게 이어 치는 글자는 모아서 한 번 그린다(2026-10-16 실측 — 느린 폰에서 한 글자 0.18초,
       한글은 자모마다 입력이 와서 「건담」 한 번에 대여섯 번 다시 그렸다).
       잠깐 쉬었다 친 첫 글자는 **바로** 그린다 — 쳐 놓고 곧장 카드를 누르는 흐름(검사 도구 포함)이
       빈 목록을 보지 않게. 이어 친 것만 0.12초 뒤 한 번. */
    const coalesce = (fn, wait = 120) => {
      let last = 0, timer = 0;
      return () => {
        clearTimeout(timer);
        const now = performance.now();
        if (now - last > wait) { last = now; fn(); return; }
        last = now;
        timer = setTimeout(() => { last = performance.now(); fn(); }, wait);
      };
    };
    const msListSoon = coalesce(() => renderMsList());
    // 검색창도 둘이다. 어느 쪽에 쳐도 같은 필터를 움직이고, 반대쪽 칸의 글자도 맞춰 준다.
    for (const sel of ['#msQuery', '#msDrawerQuery']) {
      const inp = $(sel);
      if (!inp) continue;
      inp.oninput = e => {
        state.msQuery = T.norm(e.target.value);
        state.msLimit = 80;
        for (const other of ['#msQuery', '#msDrawerQuery']) {
          const o = $(other);
          if (o && o !== e.target) o.value = e.target.value;
        }
        msListSoon();
      };
    }
    const partListSoon = coalesce(() => renderPartList());
    $('#partQuery').oninput = e => { state.partQuery = T.norm(e.target.value); partListSoon(); };

    const tabs = $('#tabs');
    for (const cat of [C.CATEGORY_ALL, ...C.CATEGORIES]) {
      const b = el('button', 'chip' + (state.partTab === cat ? ' on' : ''),
        cat === C.CATEGORY_ALL ? '전체' : C.CATEGORY_LABEL[cat]);
      ICON.prepend(b, PART_CAT_IC[cat]);
      b.onclick = () => {
        state.partTab = cat;
        [...tabs.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderPartList();
      };
      tabs.append(b);
    }


    // 기체 스킬 드롭다운 — 바깥을 누르면 닫는다
    $('#skillBtn').onclick = ev => {
      ev.stopPropagation();
      const menu = $('#skillMenu');
      menu.hidden = !menu.hidden;
    };
    $('#skillMenu').onclick = ev => ev.stopPropagation();

    /* 「4분 경과」 — 그때 효과가 **바뀌는** 파츠를 어느 쪽으로 볼지.
       수치·자동 구성이 같은 값을 보므로 renderAll 로 통째로 다시 그린다. */
    $('#lateChk').onchange = ev => {
      state.lateMode = !!ev.target.checked;
      renderAll();
    };
    /* 전역 클릭마다 이 메뉴를 닫는다 — **없을 수도 있다고** 보고 건드린다.
       무조건 건드리면 그 요소가 사라진 순간부터 페이지의 모든 클릭이 터진다
       (점검 도구가 메뉴를 지웠다가 그 꼴을 봤다). */
    document.addEventListener('click', () => { const m = $('#skillMenu'); if (m) m.hidden = true; });

    // 사격 자세 — 선 자세 / 앉기·정지 / 엎드리기 중 하나. 스코프는 자세와 별개 토글.
    const sortSeg = $('#weaponSort');
    if (sortSeg) for (const [v, label] of [['default', '기본순'], ['power', '위력'], ['dps', 'DPS'], ['stagger', '누적치']]) {
      const b = el('button', 'seg-btn' + (state.weaponSort === v ? ' on' : ''), label);
      b.onclick = () => {
        state.weaponSort = v;
        [...sortSeg.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderWeapons();
      };
      sortSeg.append(b);
    }
    // 자세·스코프는 버튼 4개가 가로를 크게 먹어(폰에선 표 머리를 밀어냈다)
    // 성능의 「스킬 ▾」 와 같은 드롭다운 하나로 묶었다. 자세는 라디오, 스코프는 체크.
    updatePostureButton();
    $('#postureBtn').onclick = ev => {
      ev.stopPropagation();
      if (document.querySelector('.posture-menu')) { document.querySelector('.posture-menu').remove(); return; }
      openPostureMenu(ev.currentTarget);
    };

    // 갤러리에서 들어왔으면 갤러리로 돌려보낸다. 검색어·필터는 그대로 남아 있다
    // (모두 화면 상태로 들고 있어 다시 그리기만 하면 된다).
    // 기체 목록으로 **돌아간다.** setView('select') 만 하면 body 의 info-open 이 그대로 남아
    // 기체 정보 칸이 목록을 덮은 채로 열린다 — 버튼에 「기체 리스트로」라고 적고 정보 칸을
    // 내미는 꼴이라, 닫기와 같은 정리를 여기서도 한다.
    $('#backToSelect').onclick = () => {
      if (fromGallery) { openGallery(true); return; }
      closeInfo();
      setView('select');
    };

    // 스텝퍼: 1단계는 언제든 클릭해 기체 목록으로, 2단계는 기체가 있을 때만
    $('#stepper').querySelectorAll('li[data-step]').forEach(li => {
      li.onclick = () => {
        if (li.dataset.step === 'build' && !state.ms) { toast('먼저 기체를 선택하세요'); return; }
        setView(li.dataset.step);
      };
    });

    $('#openAuto').onclick = () => openDrawer(true);
    $('#closeAuto').onclick = () => openDrawer(false);
    $('#drawerBack').onclick = () => openDrawer(false);
    $('#msSwapBtn').onclick = () => openMsDrawer(true);
    $('#msDrawerClose').onclick = () => openMsDrawer(false);
    $('#msDrawerBack').onclick = () => openMsDrawer(false);
    $('#runAuto').onclick = runAuto;
    $('#clearTargets').onclick = () => {
      const n = clearTargets();
      if (n) toast(`목표 ${n}개를 지웠습니다`);
    };
    // 결과 모달 — 더보기(최대 10개)·닫기·배경 클릭
    $('#autoMore').onclick = () => {
      state.autoShown = Math.min(10, (state.autoCandidates || []).length);
      renderAutoResults(state.autoCandidates || []);
    };
    $('#autoModalClose').onclick = () => openResultModal(false);   // 상세로 되돌림(후보는 유지)
    $('#autoResultShow').onclick = () => openResultModal(true);     // 남아 있는 결과 다시 보기
    $('#clearParts').onclick = () => {
      if (!state.equipped.length) { toast('장착한 파츠가 없습니다'); return; }
      const snap = snapshotEquip();
      state.equipped = [];
      state.locked.clear();
      renderAll();
      undoToast('파츠 ' + snap.equipped.length + '개를 모두 해제', snap);
    };

    // 강화 플랜
    $('#planBtn').onclick = () => openPlan(true);
    $('#planBack').onclick = () => openPlan(false);
    initPlan();

    // 저장: 이름을 지정해 목록에 담는다 / 불러오기: 저장 목록을 카드로 연다
    $('#save').onclick = saveCurrentBuild;
    $('#load').onclick = () => openSavedModal(true);
    // 공유 갤러리 (전체 화면)
    $('#codexBtn').onclick = () => openCodex(true);
    $('#codexBack').onclick = () => openCodex(false);
    // 토큰 계산기 — 화면만 바꾼다. 계산기는 제 스크립트가 알아서 돈다(token.js).
    $('#tokenBtn').onclick = () => setView('token');
    $('#tokenBack').onclick = () => setView(AUX_BACK);
    $('#codexSearch').oninput = ev => { codexQ = ev.target.value; renderCodexList(); };
    // 보기 전환 — 고른 것·검색·분류는 보기마다 뜻이 달라 함께 비운다
    for (const b of document.querySelectorAll('#codexView .seg-btn')) {
      b.onclick = () => {
        codexView = b.dataset.v;
        codexCat = '전체'; codexQ = ''; codexSel = null;
        $('#codexSearch').value = '';
        $('#codexSearch').placeholder = codexView === 'unmod'
          ? '효과·이유·기체 검색' : '스킬 이름·효과 검색';
        $('#codex2col').classList.remove('sel');
        for (const x of document.querySelectorAll('#codexView .seg-btn')) x.classList.toggle('on', x === b);
        renderCodexChips(); renderCodexList(); renderCodexPane();
      };
    }
    // 게임 패치노트 (전체 화면)
    $('#patchBtn').onclick = () => openPatch(true);
    $('#patchBack').onclick = () => openPatch(false);
    $('#pnBalBtn').onclick = () => pnSetBalOnly(!pnBalOnly);
    $('#galleryBtn').onclick = () => openGallery(true);
    $('#galleryBack').onclick = () => openGallery(false);
    $('#galleryReload').onclick = () => { galleryList = []; loadGallery(); };

    // ── 기체 정보 칸 ──
    $('#infoClose').onclick = closeInfo;   // 좁은 화면에서만 보이는 닫기
    $('#infoGo').onclick = infoGoBuild;

    // 표가 들어오거나 바뀌면 지금 보고 있는 화면만 다시 그린다.
    // 투표 줄마다 콜백을 달지 않는 이유: 화면을 다시 그릴 때마다 줄이 새로 생겨
    // 옛 줄의 콜백이 쌓인다. 화면 단위로 한 번만 걸어 두면 그럴 일이 없다.
    voteRedraw.build.push(() => {
      if (state.view === 'gallery') renderGallery();
      else if (infoMs) renderInfoBuilds();
    });
    voteRedraw.ms.push(() => { if (infoMs) renderInfo(); });
    $('#stageHelp').onclick = () => openStageHelp(true);
    $('#stageHelpClose').onclick = () => openStageHelp(false);
    $('#stageHelpBack').onclick = () => openStageHelp(false);
    $('#expHelp').onclick = () => openExpHelp(true);
    $('#expHelpClose').onclick = () => openExpHelp(false);
    $('#expHelpBack').onclick = () => openExpHelp(false);
    $('#galleryUpload').onclick = uploadCurrent;
    $('#uploadBtn').onclick = uploadCurrent;
    $('#uploadGo').onclick = uploadSubmit;
    $('#uploadCancel').onclick = () => openUpload(false);
    $('#uploadBack').onclick = () => openUpload(false);
    $('#uploadTitle').onkeydown = ev => { if (ev.key === 'Enter') $('#uploadDesc').focus(); };
    $('#uploadDesc').onkeydown = ev => { if (ev.key === 'Enter') $('#uploadAuthor').focus(); };
    $('#uploadAuthor').onkeydown = ev => { if (ev.key === 'Enter') uploadSubmit(); };
    // 남은 글자 수 — 규칙이 길이를 막으므로 미리 보여 준다
    const cnt = (inp, out, max) => {
      const f = () => { $(out).textContent = ($(inp).value || '').length + '/' + max; };
      $(inp).oninput = f; f();
    };
    cnt('#uploadTitle', '#uploadTitleCount', 20);
    cnt('#uploadDesc', '#uploadDescCount', 60);
    cnt('#uploadAuthor', '#uploadAuthorCount', 12);
    $('#updateBtn').onclick = checkUpdateNow;
    $('#galleryQuery').oninput = () => renderGallery();
    // 정렬·속성은 기체 선택 화면과 같은 칩으로 (버튼 모양·조작을 통일한다)
    const galChips = (boxSel, items, get, set) => {
      const box = $(boxSel);
      for (const it of items) {
        const chip = el('button', 'chip' + (get() === it.v ? ' on' : '') + (it.cls ? ' ' + it.cls : ''), it.label);
        chip.onclick = () => {
          set(it.v);
          [...box.children].forEach(c => c.classList.remove('on'));
          chip.classList.add('on');
          renderGallery();
        };
        box.append(chip);
      }
    };
    galChips('#gallerySortChips',
      [{ label: '최신순', v: 'new' }, { label: '추천순', v: 'vote' }, { label: '기체순', v: 'ms' }],
      () => gallerySort, v => { gallerySort = v; });
    galChips('#galleryAttrChips',
      [{ label: '전체', v: '' },
       { label: T.attrName('強襲'), v: '強襲', cls: 'attr-強襲' },
       { label: T.attrName('汎用'), v: '汎用', cls: 'attr-汎用' },
       { label: T.attrName('支援'), v: '支援', cls: 'attr-支援' }],
      () => galleryAttr, v => { galleryAttr = v; });
    // 코스트·레벨·등급은 기체 선택 화면과 **같은 목록**을 쓴다(따로 두면 어긋난다)
    galChips('#galleryCostChips', COST_CHIPS, () => galleryCost, v => { galleryCost = v; });
    galChips('#galleryLvChips', LEVEL_CHIPS, () => galleryLv, v => { galleryLv = v; });
    galChips('#galleryRarityChips', RARITY_CHIPS, () => galleryRarity, v => { galleryRarity = v; });
    galChips('#galleryFreeChips',
      [{ label: '전체', v: 'all' }, { label: '무과금', v: 'free' }],
      () => galleryFree, v => { galleryFree = v; });
    // 칩 글자를 STAGE_LABEL 에서 가져온다 — 카드 꼬리표와 **같은 말**이어야 한다.
    // 여기만 「0강·4강·6강」으로 적으면 카드는 「미강화」인데 칩은 「0강」이라 둘이 다른
    // 것을 고르는 것처럼 보인다.
    galChips('#galleryStageChips',
      [{ label: '전체', v: 'all' }].concat([0, 4, 6].map(v => ({ label: STAGE_LABEL[v], v }))),
      () => galleryStage, v => { galleryStage = v; });
    $('#galleryAdmin').onclick = adminSignIn;
    $('#adminGo').onclick = adminSubmit;
    $('#adminCancel').onclick = () => openAdmin(false);
    $('#adminBack').onclick = () => openAdmin(false);
    // 비밀번호 칸에서 Enter 로 바로 로그인
    $('#adminPw').onkeydown = ev => { if (ev.key === 'Enter') adminSubmit(); };
    $('#savedModalClose').onclick = () => openSavedModal(false);
    $('#savedModalBack').onclick = () => openSavedModal(false);
    // 빌드 A/B 비교
    $('#compareBtn').onclick = () => { if (!state.ms && !loadBuilds().length) { toast('먼저 기체를 고르거나 구성을 저장하세요'); return; } openCompareModal(true); };
    $('#compareModalClose').onclick = () => openCompareModal(false);
    $('#compareModalBack').onclick = () => openCompareModal(false);
    // 비교 칸의 select 는 개수가 바뀌므로 renderComparePick 이 그때그때 연결한다

    // 무장 헤더 '스킬' — 이 기체의 스킬 목록·설명 (무장 칸 안에서 토글)
    $('#weaponFold').onclick = toggleWeaponFold;
    $('#skillListBtn').onclick = () => {
      if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
      // 모바일에선 별도 시트로 연다(무장 표와 섞이면 보기 어렵다). 데스크톱은 기존 인라인 토글.
      if (isMobileView() && openMobileSheet) openMobileSheet('mskill-inline');
      else openMskill($('#mskillInline').hidden);   // 토글
    };
    // 패널 안 '닫기' — 모바일에선 시트로 떠 있으므로 시트까지 닫아야 백드롭이 사라진다
    $('#mskillClose').onclick = () => {
      if (isMobileView() && $('#mskillInline').classList.contains('sheet-open')) closeMobileSheets();
      else openMskill(false);
    };

    // 불러오기 결과 안내 — 제외된 파츠가 있으면 조용히 넘기지 않는다 (가져오기에서 사용)
    const loadedMsg = (r, okText) => okText + loadNote(r);
    $('#share').onclick = () => {
      if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
      const code = encodeShare();
      // 실패 시(파일 열람 등 비보안 컨텍스트) 직접 복사할 수 있도록 프롬프트로 대체
      const fallback = () => { toast('아래 코드를 복사하세요'); prompt('공유 코드 (Ctrl+C 로 복사)', code); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(() => toast('공유 코드를 복사했습니다'), fallback);
        } else fallback();
      } catch { fallback(); }
    };
    $('#importBtn').onclick = () => {
      // 옛 JSON 도 decodeShare 가 그대로 받는다(하위 호환). 다만 앱이 더 이상 JSON 을
      // 만들지 않으므로, 안내에는 지금 쓰는 것만 적는다.
      const text = prompt('공유 코드를 붙여넣으세요');
      if (!text) return;
      const obj = decodeShare(text);
      if (!obj) { toast('공유 코드 형식이 올바르지 않습니다'); return; }
      const r = deserialize(obj);
      toast(r.ok ? loadedMsg(r, '구성을 불러왔습니다') : '알 수 없는 기체입니다');
    };

    // PNG 이미지 배출 — 요약/상세 중 선택 (요약: 성능만 · 상세: 무장 피해까지)
    $('#pngBtn').onclick = ev => {
      ev.stopPropagation();
      const old = document.querySelector('.png-menu'); if (old) { old.remove(); return; }
      const menu = el('div', 'png-menu');
      const mk = (t, s, mode) => {
        const b = el('button', 'png-menu-item');
        b.append(el('span', 'pm-t', t));
        b.append(el('span', 'pm-s', s));
        b.onclick = () => { menu.remove(); exportPng(mode); };
        return b;
      };
      menu.append(mk('요약 카드', '기체 · 파츠 · 성능', 'summary'));
      menu.append(mk('상세 카드', '+ 무장 피해량', 'detail'));
      document.body.append(menu);
      const rc0 = ev.currentTarget.getBoundingClientRect();
      // 모바일에선 이 버튼이 「⋯」 안에 접혀 있어 rect 가 0 이다 — 그때는 「⋯」를 기준으로.
      const rc = rc0.width ? rc0 : ($('#topbarMore') || document.body).getBoundingClientRect();
      menu.style.top = (rc.bottom + 4) + 'px';
      menu.style.left = Math.max(6, Math.min(rc.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
      setTimeout(() => document.addEventListener('click', function h(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); }
      }), 0);
    };

    $('#pngSave').onclick = savePngShot;
    $('#pngCopy').onclick = copyPngShot;
    $('#pngClose').onclick = () => openPngModal(false);
    $('#pngModalBack').onclick = () => openPngModal(false);

    // 기본 파츠 설정 — 기본 제외 파츠 관리 (영구 저장, 우클릭과 동일 세트)
    $('#ownedBtn').onclick = () => openOwnedModal(true);
    $('#ownedModalClose').onclick = () => openOwnedModal(false);
    $('#ownedModalBack').onclick = () => openOwnedModal(false);
    $('#ownedQuery').oninput = () => renderOwnedList();
    $('#ownedClear').onclick = () => {
      if (!state.banned.size) return;
      state.banned.clear();
      saveBanned();
      renderOwnedList();
      updateOwnedUi();
    };

    // 창 크기가 바뀌면 예산(vh)이 달라지므로 줄 맞춤을 다시 한다
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        /* 보기 모드를 **먼저** 다시 건다. 회전하면 기기 폭이 바뀌어 viewport 배율과
           폰 전용 표시(vm-wide·wnarrow)가 달라지는데, 여태 여기서 안 불러
           돌린 뒤에도 세로 설정이 그대로 남아 있었다. */
        applyViewMode();
        fitTopbar();
        fitBuildBand(); fitWholeRows($('#partList'));
        markWeaponScroll();     // 가로↔세로 회전으로 넘침 여부가 바뀐다
        /* 패치노트 레일도 다시 잰다. 안 하면 창을 줄여 넘치게 돼도 자리와 마스크가
           옛 크기 그대로 남는다 — 폰을 돌리면 그대로 어긋난다(자가 잡았다). */
        if (state.view === 'patch') pnPlaceRail();
      }, 120);
    });

    /** 한 걸음 뒤로. 닫거나 돌아갈 것이 있었으면 true, 더 갈 곳이 없으면 false.
     *
     *  Esc 와 **안드로이드 하드웨어 뒤로가기가 같은 것을 쓴다.** 예전에는 자바 쪽이
     *  「열려 있는 모달」의 선택자 목록을 따로 들고 있었는데, 화면이 늘 때마다 그 목록을
     *  같이 고쳐야 해서 어긋났다 — 실제로 기체 정보 칸(body.info-open)이 빠져 있어,
     *  정보를 열어 둔 채 뒤로가기를 누르면 **앱이 그냥 죽었다.**
     *  판단은 화면을 아는 이쪽이 하고, 자바는 묻기만 한다.
     *
     *  @param {Element|null} focused 입력칸에서 눌렀는지 — Esc 는 ev.target,
     *         하드웨어 뒤로가기는 그런 것이 없으므로 null 이 온다. */
    function navBack(focused) {
      if (mobileSheetOpen()) { closeMobileSheets(); return true; }   // 모바일 슬라이드 시트 먼저 닫기
      if (!$('#mskillInline').hidden) { openMskill(false); return true; }
      if (!$('#stageHelpModal').hidden) { openStageHelp(false); return true; }
      if (!$('#expHelpModal').hidden) { openExpHelp(false); return true; }
      if (!$('#uploadModal').hidden) { openUpload(false); return true; }
      if (!$('#adminModal').hidden) { openAdmin(false); return true; }
      /* 플랜 모달이 열려 있으면 그것이 먼저다. 단, 그 위에 기체 서랍이 또 열려 있으면
         서랍이 먼저다 — 아래의 서랍 처리는 화면 검사보다 뒤에 있어서 여기서 같이 본다
         (순서를 위로 옮기면 피탄·비교 모달보다 앞서게 되므로 건드리지 않는다). */
      if (!$('#planEditModal').hidden) {
        if ($('#msDrawer').classList.contains('open')) { openMsDrawer(false); return true; }
        closePlanEdit();
        return true;
      }
      if (state.view === 'codex') { openCodex(false); return true; }
      if (state.view === 'gallery') { openGallery(false); return true; }
      if (state.view === 'plan') { openPlan(false); return true; }
      /* 패치노트 화면도 **여기 없었다** — 토큰 화면과 똑같은 함정을 다시 밟았다(실측:
         Esc 전후 모두 view-patch). 안드로이드에서는 return false 로 떨어져 앱이 닫힌다.
         정보 칸이 열려 있으면 **그것부터** 닫는다 — 한 번에 화면까지 나가면
         무엇이 닫힌 건지 알 수 없다. */
      if (state.view === 'patch') {
        if (document.body.classList.contains('info-open')) { closeInfo(); return true; }
        openPatch(false); return true;
      }
      /* 토큰 화면이 여기 **없었다** — 뒤로가기를 누르면 돌아가지 않고 앱이 닫혔다
         (돌아가는 길이 「‹ 돌아가기」 버튼 하나뿐이었다). 화면을 하나 더 붙이면서 같이 고친다. */
      if (state.view === 'token') { setView(AUX_BACK); return true; }
      /* 대결 시뮬 — 피탄 시뮬이 있던 자리. 창은 duel.js 가 만들므로 없을 수도 있다. */
      {
        const d = document.getElementById('duelModal');
        if (d && !d.hidden) { window.GBO2Duel.close(); return true; }
      }
      if (!$('#compareModal').hidden) { openCompareModal(false); return true; }
      if (!$('#ownedModal').hidden) { openOwnedModal(false); return true; }
      if (!$('#savedModal').hidden) { openSavedModal(false); return true; }
      if (!$('#autoResultPanel').hidden) { openResultModal(false); return true; }
      if ($('#msDrawer').classList.contains('open')) { openMsDrawer(false); return true; }
      if ($('#autoDrawer').classList.contains('open')) { openDrawer(false); return true; }

      // 입력 중이면 화면을 벗어나지 않는다 — 내용이 있으면 비우고, 없으면 포커스만 해제
      if (focused && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName)) {
        if (focused.value) { focused.value = ''; focused.dispatchEvent(new Event('input')); }
        else focused.blur();
        return true;
      }

      if (state.view === 'build') { setView('select'); return true; }
      // 기체 정보 칸 — 폰에서는 화면을 통째로 덮으므로, 이것이 열려 있으면
      // 뒤로가기는 「닫기」여야 한다. 목록보다 **뒤**에 둔다(파츠 화면이 먼저다).
      if (document.body.classList.contains('info-open')) { closeInfo(); return true; }
      return false;                     // 더 갈 곳이 없다 — 여기서가 시작 화면이다
    }

    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') navBack(ev.target);
      /* 키보드로 고르기 — role=button 을 단 div(기체 카드·파츠 타일)는 Enter/Space 를
         스스로 받지 못한다(진짜 <button> 만 받는다). 여기서 클릭으로 바꿔 준다.
         Space 는 그냥 두면 **화면을 내린다** — 막아야 한다. */
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.matches
        && ev.target.matches('[data-kbd-press]')) {
        ev.preventDefault();
        ev.target.click();
      }
    });

    /* 안드로이드 껍데기가 부르는 한 곳. 'back' 이면 처리했고, 'exit' 면 시작 화면이라
       더 갈 곳이 없다는 뜻이다(그때 껍데기가 종료할지 묻는다). */
    window.GBO2Back = () => (navBack(null) ? 'back' : 'exit');

    /* ── 브라우저·홈 화면 바로가기의 뒤로가기 ──────────────────────────
       APK 는 자바가 뒤로가기를 가로채 위 GBO2Back 을 부른다. 그런데 **크롬으로 열면**
       그 길이 없다 — 이 앱은 화면이 바뀌어도 주소를 바꾸지 않는 한 페이지짜리라
       히스토리에 아무것도 쌓이지 않고, 그래서 뒤로가기가 곧바로 「페이지 떠나기」가 됐다.
       파츠 화면에서 눌러도 기체 목록으로 가는 대신 **앱이 그냥 닫혔다**(사용자 지적).

       히스토리에 빈 칸 하나를 덫으로 놓아 둔다. 뒤로가기가 그 칸을 밟으면 popstate 가
       오고, 그때 APK 와 **같은 navBack()** 으로 한 걸음 물러난 뒤 덫을 다시 놓는다.
       (file:// 에서도 pushState·popstate 가 동작하는 것을 확인했다.) */
    const pushTrap = () => { try { history.pushState({ gbo2: 1 }, ''); } catch { /* 막히면 옛 동작 */ } };
    let leaveAt = 0;
    pushTrap();
    window.addEventListener('popstate', () => {
      if (navBack(null)) { pushTrap(); return; }      // 한 걸음 물러났다 — 덫을 다시 놓는다
      /* 더 갈 곳이 없다. 한 번에 닫지 않는다 — 만들던 구성이 오조작 한 번에 사라진다.
         (APK 에서 「종료하시겠습니까?」를 띄우는 것과 같은 뜻이다. 브라우저에서는
         네이티브 대화상자를 띄울 수 없어 한 번 더 누르게 한다.) */
      if (Date.now() - leaveAt < 2000) { history.back(); return; }   // 두 번째 — 떠난다
      leaveAt = Date.now();
      toast('한 번 더 누르면 닫힙니다');
      pushTrap();
    });
  }

  // 모바일 슬라이드 시트 — 성능·무장·상세를 오른쪽에서 열고 닫는다(하단 액션바로 토글).
  // ESC/뒤로가기가 이 함수들을 참조하므로 모듈 스코프에 둔다.
  let closeMobileSheets = () => {};
  let mobileSheetOpen = () => false;
  let openMobileSheet = null;                      // 모바일 시트 열기(설치되면 채워진다)
  const isMobileView = () => window.matchMedia('(max-width: 700px), (max-height: 560px) and (pointer: coarse), (max-height: 560px) and (max-width: 1100px)').matches
    && document.body.classList.contains('view-build');
  /** 모바일 상단바 — 버튼 9개가 390px 폭에 1,211px 로 깔려 가로 스크롤로만 닿았다.
   *  자주 쓰는 것(피탄 시뮬·자동 구성)만 남기고 나머지는 「⋯」 메뉴로 접는다.
   *  메뉴 항목은 원래 버튼을 그대로 click() 하므로 동작·상태는 한 벌만 유지된다. */
  /* ── 폰 화면 모드 ──────────────────────────────────────────
     폰 세로는 폭이 390px 안팎이라 성능표(368px)와 파츠 목록을 나란히 둘 수 없다.
     그래서 화면 폭을 768px 로 잡아 태블릿 2단 규칙을 그대로 태우고, 브라우저가
     축소해 보여 준다. 폰이 세로로 길어 CSS 높이가 1,600px 을 넘으므로 오히려
     태블릿보다 많이 들어간다(파츠 카드 6 → 14장).
       넓게 보기(기본) — 폭 768px. 본문 글자가 약 1.3mm 로 절반이 된다.
       크게 보기      — 폭 = 기기 폭. 지금까지의 폰 화면.
     핀치 줌을 열어 두어 작으면 손가락으로 키울 수 있다. */
  const WIDE_W = 768;
  // 메타를 바꾸면 innerWidth 가 따라 바뀐다 — 기기 본래 폭은 처음 한 번만 잰다
  /* 기기 폭은 **잴 때마다** 본다. 예전에는 로드 시점 innerWidth 를 const 로 얼려 뒀는데,
     폰을 돌려도 그 값이 그대로라 「넓게 보기」가 세로 배율(0.51)을 유지한 채 가로를 덮었다 —
     레이아웃 폭이 768 → 1662px 로 벌어지고 글자가 절반이 됐다.

     innerWidth 를 쓰면 안 된다. 「넓게 보기」는 viewport 폭을 768 로 **잡아 버리므로**
     innerWidth 는 기기 폭이 아니다(실측: 세로 768 · 가로 1662).
     screen.width 는 두 보기·두 방향 모두에서 실제 기기 폭과 같았다(390 / 844).

     innerWidth 도 함께 보는 이유는 데스크톱이다 — 창을 좁히면 screen 은 그대로지만
     사람이 보는 폭은 좁다. 둘 중 하나라도 좁으면 좁은 것으로 친다.
     폰 가로(screen 844 · inner 1662)는 어느 쪽도 걸리지 않아 그대로 넓은 화면이 된다 —
     가로에서 새로 열었을 때와 같은 결과다(그게 옳다). */
  const deviceCssW = () => Number((window.screen || {}).width) || window.innerWidth;
  const isPhoneWidth = () => deviceCssW() <= 700 || window.innerWidth <= 700;
  const VIEW_KEY = 'gbo2.viewMode';
  let viewMode = 'large';
  try { viewMode = localStorage.getItem(VIEW_KEY) || 'wide'; } catch (e) { viewMode = 'wide'; }

  /* ---------- 모달 — <dialog> (CSS 10단계) ----------
     아홉 모달을 div + 뒤판 div 에서 <dialog> + showModal() 로 바꿨다(대결 창과 같은 길).
       · 최상위 층에 떠 z-index 를 고르지 않는다 · 뒤 화면이 inert 라 Tab 이 새지 않는다
       · 닫으면 포커스가 연 단추로 돌아간다 · Esc / 폰 뒤로가기(cancel) · 뒤판 누르기로 닫힌다
     닫는 길은 **뒤판 div 의 onclick** 하나로 모은다 — 모달마다 닫을 때 하는 일(입력 지우기·
     다시 그리기)이 거기 이미 걸려 있다. showModal 이 없는 곳(jsdom)은 예전처럼 뒤판 div 를 쓴다.
     hidden 은 그대로 같이 움직인다 — 앱·검사가 「열렸나」를 그것으로 본다. */
  function setModal(m, b, open) {
    if (!m) return;
    m.hidden = !open;
    const modal = typeof m.showModal === 'function';
    if (b) b.hidden = !open || modal;
    if (!modal) return;
    if (!m.dataset.dlg) {
      m.dataset.dlg = '1';
      m.tabIndex = -1;
      const shut = () => { if (b && typeof b.onclick === 'function') b.onclick(); else setModal(m, b, false); };
      m.addEventListener('cancel', e => { e.preventDefault(); shut(); });
      m.addEventListener('click', e => {
        if (e.target !== m) return;
        const r = m.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) shut();
      });
    }
    if (open && !m.open) {
      m.showModal();
      /* 떠 있던 토스트를 다시 맨 위로 — 안 그러면 새 모달의 뒤판 밑에 깔려 흐려진다
         (예전엔 z-index 60 > 모달 51 이라 늘 위였다. 모달 사진 대조가 잡았다). */
      const t = document.getElementById('toast');
      if (t && t.classList.contains('show')) raiseToTop(t);
      /* 첫 단추(닫기)가 아니라 창 자체에 — 폰에서 「닫기」 에 고리가 그려졌다(대결 창에서 잰 것).
         제 칸에 포커스를 주는 모달(관리자 비밀번호)은 뒤에서 다시 옮긴다. */
      m.focus();
    } else if (!open && m.open) m.close();
  }
  /* 모달 위에 서랍을 열 때(강화 플랜 → 기체 고르기) — 모달 dialog 위의 것은 **inert** 라
     서랍을 못 누른다(Chrome 실측: 위에 띄운 popover 도 클릭이 안 먹었다). 서랍이 열려 있는 동안만
     모달을 비모달(show)로 내려 예전 z-index 쌓임(모달 51 < 서랍 52·53)으로 돌린다. */
  function modalYield(m, yieldIt) {
    if (!m || typeof m.showModal !== 'function' || !m.open) return;
    if (yieldIt && m.matches(':modal')) { m.close(); m.show(); }
    else if (!yieldIt && !m.matches(':modal')) { m.close(); m.showModal(); m.focus(); }
  }
  /* 토스트를 **맨 위**로 — 모달 dialog 가 최상위 층에 있으니 z-index 60 으로는 그 뒤에 숨는다.
     popover 로 다시 띄우면 최상위 층의 맨 끝(가장 위)에 붙는다. 보이기만 하면 된다
     (모달 위에서는 inert 라 눌리지 않지만, 「되돌리기」 토스트는 빌드 화면에서만 뜬다). */
  function raiseToTop(e) {
    if (!e || typeof e.showPopover !== 'function') return;
    if (!e.hasAttribute('popover')) e.setAttribute('popover', 'manual');
    try {
      if (e.matches(':popover-open')) e.hidePopover();
      e.showPopover();
    } catch { /* 지원 안 함 — 예전 z-index 로 둔다 */ }
  }

  /** 키보드로 누를 수 있게 — Tab 으로 가고 Enter/Space 로 누른다.
   *  기체 카드·파츠 타일이 div 라 Tab 이 거기 가지 않았다(가이드 #12, 실측 0/164).
   *  <button> 으로 바꾸지 않는 이유: 카드 안에 ★·ⓘ 단추가 있어 단추 안의 단추가 되고,
   *  스타일도 다시 맞춰야 한다. 이름은 aria-label 로 — 안 주면 낭독기가 카드 안 글자를
   *  통째로(LV·코스트·속성까지) 읽는다. */
  function kbdPressable(elm, name) {
    elm.tabIndex = 0;
    elm.setAttribute('role', 'button');
    elm.dataset.kbdPress = '1';
    if (name) elm.setAttribute('aria-label', name);
  }

  /* ■ 누르는 div 를 **알아서** 키보드에 닿게 한다(CSS 10단계, 가이드 #12 나머지).
     5단계에서 기체 카드·파츠 타일은 손으로 kbdPressable 을 달았는데, 재 보니 그 밖에도
     onclick 만 있고 Tab 이 안 가는 것이 화면마다 있었다 — 무장 줄 · 장착 칸 · 잠금 · 상세의 장착 단추 ·
     갤러리 카드 · 스킬 도감 302줄 · 패치노트 카드 · 단계 표시 · 강화 플랜 카드 · 기본 파츠 타일 …
     하나씩 다는 목록은 새 화면이 생길 때마다 빠진다(손으로 적은 목록은 어긋난다). 그래서
     **onclick 을 가진 것이 문서에 붙는 순간** 한 곳에서 단다. 뒤판(누르면 닫히는 덮개)은 뺀다 —
     그것에 Tab 이 가면 「닫기」 를 두 번 지나게 된다. 이미 tabindex/role 을 정한 것은 건드리지 않는다. */
  const KBD_NATIVE = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY|DIALOG|OPTION|DETAILS)$/;
  const KBD_SKIP = '.auto-modal-back, .drawer-back, .duel-back, .sheet-backdrop, [id$="Back"], [data-no-kbd]';
  function kbdAuto(e) {
    if (typeof e.onclick !== 'function' || KBD_NATIVE.test(e.tagName)) return;
    if (e.hasAttribute('tabindex') || e.dataset.kbdPress || e.matches(KBD_SKIP)) return;
    const name = e.getAttribute('aria-label') || (e.title || '').split('\n')[0].trim()
      || (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    kbdPressable(e, name);
    if (!e.hasAttribute('role')) e.setAttribute('role', 'button');
  }
  function kbdAutoTree(root) {
    if (root.nodeType !== 1) return;
    kbdAuto(root);
    for (const e of root.querySelectorAll('*')) kbdAuto(e);
  }
  function setupKbdAuto() {
    kbdAutoTree(document.body);
    if (typeof MutationObserver !== 'function') return;
    /* 콜백은 마이크로태스크라 그리기가 끝난 **뒤** 돈다 — 요소를 붙인 다음 줄에서 onclick 을
       다는 코드(무장 줄)도 이미 onclick 이 있다. */
    new MutationObserver(list => {
      for (const m of list) for (const n of m.addedNodes) kbdAutoTree(n);
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- 좁은/낮은 화면 표시 ----------
     이 조건이 CSS 안에 **21번** 똑같이 적혀 있었다 — 하나를 고치려면 스물한 군데를
     같이 고쳐야 했고, 실제로 몇 군데는 빠진 채 달라져 있었다. 조건은 여기 한 곳에만 두고,
     CSS 는 `:where(body.compact)` 로 받는다.

     **:where() 를 쓰는 이유** — `body.compact .x` 로 쓰면 특이도가 (0,1,0) → (0,2,0) 으로
     올라, 뒤에 오는 다른 규칙과의 승부가 조용히 뒤집힌다. :where() 는 특이도가 0 이라
     `.x` 그대로여서 @media 안에 있던 때와 **똑같이** 겨룬다. (84장 사진으로 확인했다)

     폰 「넓게 보기」는 768px 로 잡아 보여 주므로 max-width 로는 폰인지 알 수 없다 —
     그래서 vm-wide 는 아래에서 따로 단다. compact 는 **실제 창 크기**를 본다. */
  /* matchMedia 가 **없을 수도 있다** — 점검 도구의 jsdom 에는 없다. 그냥 부르면
     이 줄에서 스크립트가 죽어 **앱이 통째로 안 그려진다**(smoke 가 그걸로 울었다).
     없으면 표시를 안 달 뿐이다 — CSS 를 그리지 않는 자리라 그걸로 충분하다. */
  const COMPACT_MQ = typeof window.matchMedia === 'function' ? window.matchMedia(
    '(max-width: 700px), (max-height: 560px) and (pointer: coarse),'
    + ' (max-height: 560px) and (max-width: 1100px)') : null;
  const syncCompact = () => document.body.classList
    .toggle('compact', !!(COMPACT_MQ && COMPACT_MQ.matches));
  if (COMPACT_MQ && COMPACT_MQ.addEventListener) COMPACT_MQ.addEventListener('change', syncCompact);
  else if (COMPACT_MQ && COMPACT_MQ.addListener) COMPACT_MQ.addListener(syncCompact);   // 옛 사파리
  syncCompact();

  function applyViewMode() {
    syncCompact();              // 회전·창 크기 변화가 여기를 지나간다
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const wide = isPhoneWidth() && viewMode === 'wide';
    const want = wide
      ? `width=${WIDE_W}, initial-scale=${(deviceCssW() / WIDE_W).toFixed(4)},`
        + ' user-scalable=yes, viewport-fit=cover'
      : 'width=device-width, initial-scale=1, viewport-fit=cover';
    /* **바뀐 때만** 아래에서 resize 를 다시 쏜다. 무조건 쏘면, 회전 때문에 resize 에서
       이 함수를 부르는 지금 구조에서 서로를 끝없이 부른다(120ms 마다 영원히). */
    const changed = meta.getAttribute('content') !== want;
    meta.setAttribute('content', want);
    /* 「넓게 보기」는 폭을 768px 로 **잡아** 보여 주는 것이라, CSS 의 max-width 로는
       폰인지 알 수 없다(768px 은 태블릿 구간이다). 몸통에 표시를 달아 준다 —
       이 표시가 없어서 「이름이 길면 줄바꿈」 규칙이 넓게 보기에만 안 걸렸다. */
    document.body.classList.toggle('vm-wide', isPhoneWidth() && viewMode === 'wide');
    /* 무장표의 왼쪽 고정 두 칸을 좁히는 표시. **두 보기 모두** 폰이면 켠다 —
       크게 보기는 390px 라 화면이 좁고, 넓게 보기는 768px 로 잡아 축소하므로
       어느 쪽이든 그 264px 이 보이는 폭의 대부분을 먹는다. */
    document.body.classList.toggle('wnarrow', isPhoneWidth());
    const b = $('#viewModeBtn');
    if (b) {
      // 글자는 '지금 상태'가 아니라 '누르면 되는 것'을 적는다
      b.textContent = viewMode === 'wide' ? '크게 보기' : '넓게 보기';
      b.title = viewMode === 'wide'
        ? '글자를 키웁니다 — 성능은 아래 「성능」 버튼으로 봅니다'
        : '한 화면에 넓게 봅니다 — 성능·파츠가 같이 보이고 글자는 작아집니다';
    }
    // 폭이 바뀌었을 때만 높이를 다시 잰다(띠·줄 맞춤)
    if (changed) setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  }

  function toggleViewMode() {
    viewMode = viewMode === 'wide' ? 'large' : 'wide';
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch (e) {}
    applyViewMode();
    toast(viewMode === 'wide' ? '넓게 보기 — 두 손가락으로 키울 수 있습니다' : '크게 보기');
  }

  /* 상단바를 뜻으로 나눈다.
       왼쪽 = 이 구성에 하는 일 · 오른쪽 = 다녀오는 곳.
     버튼 14개(폭 1,282px)가 1500·1280px 에서 두 줄로 접히던 것을 7개로 줄인다.

     `in-menu` 는 **상단바에 절대 안 보이고** 메뉴 항목의 원본으로만 쓴다.
     `in-more` 는 좁은 화면에서만 접힌다(기존 규칙 그대로).
     어느 쪽이든 메뉴 항목이 원본을 click() 하므로 동작·비활성 상태가 한 벌이다. */
  const EXPORT_MENU = ['#save', '#share', '#pngBtn', '#uploadBtn'];
  const MORE_MENU = ['#load', '#importBtn', '#ownedBtn', '#updateBtn', '#viewModeBtn'];
  // 좁은 화면에서는 이것들도 「⋯」로 접는다 — 폰 상단바에 여덟 개는 못 선다
  /* #duelBtn 은 duel.js 가 뒤에 다는 버튼이다. 목록에 안 넣었더니 폰 상단바가
     **두 줄(91px)** 이 됐다 — topbar_check 가 잡았다. 메뉴는 누를 때 선택자를 다시 찾으므로
     나중에 생기는 버튼도 여기 적어 두면 ⋯ 로 닿는다. */
  const MOBILE_FOLD = ['#compareBtn', '#galleryBtn', '#codexBtn', '#tokenBtn', '#planBtn', '#duelBtn'];
  /** 「⋯」 메뉴에 들어갈 접힌 버튼인가 — 메뉴(openTopbarMenu)와 숫자 배지(fitTopbar)가 **같은 판정**을 쓴다.
   *  예전엔 배지가 폭 0 만 봐서, 기체 선택 화면에서 뜻이 없어 숨은 「비교」(step-only)까지 세어
   *  메뉴에는 없는 버튼 「1」 을 띄웠다(2026-10-20 사용자 질문). */
  const isMenuFolded = sel => {
    const b = $(sel);
    if (!b || b.getBoundingClientRect().width !== 0) return false;
    return !(document.body.classList.contains('view-select') && b.classList.contains('step-only'));
  };

  /** 원본 버튼들을 항목으로 하는 메뉴를 연다. 이미 열려 있으면 닫는다. */
  function openTopbarMenu(anchor, selectors) {
    const old = document.querySelector('.more-menu');
    const wasMine = old && old.dataset.for === anchor.id;
    if (old) old.remove();
    if (wasMine) return;
    const menu = el('div', 'png-menu more-menu');
    menu.dataset.for = anchor.id;
    const onSelect = document.body.classList.contains('view-select');
    let n = 0;
    for (const sel of selectors) {
      const src = $(sel);
      if (!src) continue;
      if (onSelect && src.classList.contains('step-only')) continue;   // 기체 선택 화면에선 뜻이 없다
      if (src.dataset.phoneOnly && !isPhoneWidth()) continue;          // 태블릿·PC 에선 의미 없는 항목
      const it = el('button', 'png-menu-item');
      const pt = el('span', 'pm-t', src.textContent.trim());
      const sic = src.querySelector(':scope > svg.ic');   // 상단바 단추의 아이콘을 메뉴에도
      if (sic) pt.prepend(sic.cloneNode(true));
      it.append(pt);
      if (src.title) it.append(el('span', 'pm-s', src.title));
      it.onclick = () => { menu.remove(); src.click(); };
      menu.append(it);
      n++;
    }
    if (!n) return;
    document.body.append(menu);
    const rc = anchor.getBoundingClientRect();
    menu.style.top = (rc.bottom + 4) + 'px';
    menu.style.left = Math.max(6, Math.min(rc.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    setTimeout(() => document.addEventListener('click', function h(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); }
    }), 0);
  }

  /* ■ 상단바 접기 — **재서** 접는다(CSS 7단계).
     여태는 폭 기준을 손으로 적었다(1399 · 1560px). 버튼이 하나 늘 때마다 그 수가 어긋났다 —
     대결 버튼이 붙은 뒤 1600px 과 900~1100px 에서 상단바가 2~3줄(91·99px)이 됐는데
     검사는 1920·1500·1280 만 봐서 몰랐다. 그래서 수를 적지 않고 **넘치는지 직접 본다**:
     다 펴 놓고, 넘치면 덜 쓰는 것부터 하나씩 접는다. 접힌 버튼은 폭이 0 이 되어
     「⋯」 메뉴가 주워 담는다(그 규칙은 아래 btn.onclick 그대로).
     순서: 장식(제목 글자) → 강화 플랜 → 토큰 → 스킬 도감 → 갤러리 → 대결 → 비교.
     자동 구성 · 내보내기 · 패치노트는 접지 않는다(패치노트는 사용자 지시). */
  const TB_FOLD_ORDER = ['.brand span', '.brand > div', '#planBtn', '#tokenBtn', '#codexBtn',
    '#galleryBtn', '#duelBtn', '#compareBtn'];
  function topbarOverflows(bar) {
    if (bar.scrollWidth > bar.clientWidth + 1) return true;          // 한 줄로 묶인 폰 바
    const items = [...bar.children].filter(x => {
      const r = x.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !x.classList.contains('spacer');
    });
    if (!items.length) return false;
    const rects = items.map(x => x.getBoundingClientRect());
    const firstBottom = Math.min(...rects.map(r => r.bottom));
    return rects.some(r => r.top >= firstBottom - 1);                 // 첫 줄 아래로 내려간 것
  }
  function fitTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const folds = TB_FOLD_ORDER.flatMap(sel => [...bar.querySelectorAll(sel)]);
    folds.forEach(e => e.classList.remove('tb-fold'));
    for (const e of folds) {
      if (!topbarOverflows(bar)) break;
      e.classList.add('tb-fold');
    }
    /* 넘침 표시 — 「⋯」 안에 버튼이 몇 개 들어 있는지 숫자로 알린다.
       접혀 사라진 버튼을 찾는 사람이 「⋯」 를 열어 볼 이유를 준다. */
    const more = document.getElementById('topbarMore');
    if (more) {
      const n = MOBILE_FOLD.filter(isMenuFolded).length;
      more.dataset.folded = n ? String(n) : '';
      more.setAttribute('aria-label', n ? '더보기 — 접힌 버튼 ' + n + '개' : '더보기');
    }
  }

  function setupTopbarOverflow() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    for (const sel of MORE_MENU.concat(EXPORT_MENU)) {
      const b = $(sel);
      if (b && sel !== '#viewModeBtn') b.classList.add('in-menu');
    }
    const vm = $('#viewModeBtn');
    if (vm) { vm.onclick = toggleViewMode; vm.classList.add('in-menu'); }
    applyViewMode();
    for (const sel of MOBILE_FOLD) { const b = $(sel); if (b) b.classList.add('in-more'); }

    const ex = $('#exportMenuBtn');
    if (ex) ex.onclick = ev => { ev.stopPropagation(); openTopbarMenu(ex, EXPORT_MENU); };

    const btn = el('button', 'btn-ghost topbar-more');
    btn.id = 'topbarMore'; btn.textContent = '⋯';
    btn.title = '저장 목록 · 가져오기 · 기본 파츠 설정 · 업데이트 확인';
    btn.setAttribute('aria-label', '더보기');
    bar.append(btn);
    btn.onclick = ev => {
      ev.stopPropagation();
      /* 상단바에서 **지금 안 보이는 것**을 앞에 붙인다 — 사라진 것이 여기 있어야 한다.
         예전엔 「폰 폭이냐」로 전부냐 아니냐를 정했는데, 그러면 중간 폭(바가 두 줄로
         넘칠 만큼만 좁은 자리)에서 접힌 버튼이 메뉴에도 없어 **아무 데서도 못 누르는**
         버튼이 된다. 폭이 0 인지 직접 보는 쪽이 접힘 규칙과 어긋나지 않는다. */
      const list = MOBILE_FOLD.filter(isMenuFolded).concat(MORE_MENU);
      openTopbarMenu(btn, list);
    };
    fitTopbar();
    /* 글꼴이 늦게 붙으면 버튼 폭이 바뀐다 · duel.js 는 load 때 버튼을 단다 — 둘 다 다시 잰다 */
    window.addEventListener('load', () => setTimeout(fitTopbar, 0), { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTopbar);
  }


  function setupMobileSheets() {
    // 파츠 상세는 인라인(장착↔파츠 사이)로 두고, 성능·무장만 슬라이드 시트로.
    const sheets = [
      { cls: 'build-stats', label: '📊 성능' },
      { cls: 'build-weapons', label: '🗡 무장' },
      // 스킬은 원래 무장 칸 안 인라인인데, 모바일에선 무장 표와 섞여 보기 어려워 시트로 뗀다.
      { cls: 'mskill-inline', label: '🛠 스킬' }
    ];
    const target = c => document.querySelector('.' + c);
    const backdrop = el('div', 'sheet-backdrop');
    const bar = el('div', 'm-actionbar');
    const btns = {};
    // 시트를 열 때 body 로 옮긴다 — transform 있는 조상(.build-bottom 등)이 fixed 의 기준이 되어
    // 시트가 어긋나던 버그를 원천 차단. 닫히면(슬라이드 아웃 후) 원위치로 되돌린다.
    const origPos = {};
    const toBody = cls => {
      const t = target(cls);
      if (!t || t.parentElement === document.body) return;
      origPos[cls] = { parent: t.parentElement, next: t.nextSibling };
      document.body.appendChild(t);
    };
    const restoreClosed = () => {
      for (const s of sheets) {
        const t = target(s.cls), o = origPos[s.cls];
        if (t && o && t.parentElement === document.body && !t.classList.contains('sheet-open')) {
          o.parent.insertBefore(t, o.next); origPos[s.cls] = null;
        }
      }
    };
    // 스킬 패널만 hidden 속성으로 여닫히므로(데스크톱 인라인 동작) 시트로 쓸 때도 함께 맞춘다.
    const SKILL = 'mskill-inline';
    const close = () => {
      let any = false;
      for (const s of sheets) { const t = target(s.cls); if (t) { if (t.classList.contains('sheet-open')) any = true; t.classList.remove('sheet-open'); } btns[s.cls].classList.remove('on'); }
      backdrop.classList.remove('on');
      const sp = target(SKILL);
      if (sp && !sp.hidden) { sp.hidden = true; const sb = document.getElementById('skillListBtn'); if (sb) sb.classList.remove('on'); }
      if (any) setTimeout(restoreClosed, 320);   // 슬라이드 아웃 애니메이션 후 원위치
    };
    const open = cls => {
      const already = target(cls) && target(cls).classList.contains('sheet-open');
      close();
      if (already || !target(cls)) return;
      if (cls === SKILL) { target(cls).hidden = false; renderMskill(); }
      toBody(cls); target(cls).classList.add('sheet-open'); btns[cls].classList.add('on'); backdrop.classList.add('on');
    };
    openMobileSheet = open;
    for (const s of sheets) {
      const b = el('button', 'btn-ghost', s.label);
      b.onclick = () => open(s.cls);
      btns[s.cls] = b;
      bar.append(b);
    }
    backdrop.onclick = close;
    document.body.append(backdrop, bar);
    // 각 시트에 닫기(✕) 버튼 — 시트가 열렸을 때만 보인다(CSS).
    for (const s of sheets) {
      const tgt = target(s.cls);
      if (tgt) { const x = el('button', 'sheet-close', '✕'); x.title = '닫기'; x.onclick = close; tgt.appendChild(x); }
    }

    // ── 스와이프 제스처 — '성능' 시트에만 둔다 ─────────────────────────────
    // 무장 시트는 가로로 훑어 볼 내용(무장 표)이 있어 그 드래그가 닫기로 잡혀 창이
    // 멋대로 닫혔다. 그래서 무장은 버튼 전용(하단 버튼·✕·배경 탭)으로 두고,
    // 가로로 끌 일이 없는 성능 시트만 제스처를 유지한다.
    //   열기 — 오른쪽 가장자리에서 왼쪽으로 / 닫기 — 오른쪽으로 밀기
    const STATS = 'build-stats', EDGE = 30, OPEN_AT = 0.32;
    let drag = null;
    const isMob = () => window.matchMedia('(max-width: 700px), (max-height: 560px) and (pointer: coarse), (max-height: 560px) and (max-width: 1100px)').matches && document.body.classList.contains('view-build');
    const isOpen = cls => { const t = target(cls); return !!(t && t.classList.contains('sheet-open')); };

    document.addEventListener('touchstart', ev => {
      if (drag || !isMob() || ev.touches.length !== 1) return;
      // 성능 외의 시트(무장·스킬…)가 떠 있으면 제스처가 일절 개입하지 않는다.
      // 시트를 새로 추가할 때 여기 조건을 빠뜨리기 쉬워, 이름을 하나씩 적지 않고 목록에서 뽑는다.
      if (sheets.some(x => x.cls !== STATS && isOpen(x.cls))) return;
      const x = ev.touches[0].clientX, y = ev.touches[0].clientY;
      if (isOpen(STATS)) {
        drag = { mode: 'close', x0: x, y0: y, sheet: target(STATS), size: target(STATS).getBoundingClientRect().width, prog: 0, axis: null };
      } else if (x >= window.innerWidth - EDGE) {
        drag = { mode: 'open', x0: x, y0: y, sheet: null, size: 0, prog: 0, axis: null };   // 셋업은 실제로 끌 때
      }
    }, { passive: true });

    document.addEventListener('touchmove', ev => {
      if (!drag) return;
      const dx = ev.touches[0].clientX - drag.x0, dy = ev.touches[0].clientY - drag.y0;
      if (!drag.axis) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dx) <= Math.abs(dy)) { drag = null; return; }   // 세로 우세 → 스크롤이지 제스처가 아니다
        drag.axis = 'go';
        if (drag.mode === 'open') {
          toBody(STATS);
          drag.sheet = target(STATS);
          drag.size = drag.sheet.getBoundingClientRect().width || Math.min(window.innerWidth * 0.94, 480);
          drag.sheet.style.transition = 'none';
          drag.sheet.style.transform = 'translateX(100%)';
          backdrop.classList.add('on'); backdrop.style.transition = 'none'; backdrop.style.opacity = '0';
        } else { drag.sheet.style.transition = 'none'; backdrop.style.transition = 'none'; }
      }
      const prog = Math.min(1, Math.max(0, drag.mode === 'open' ? -dx : dx) / drag.size);
      drag.prog = prog;
      drag.sheet.style.transform = `translateX(${(drag.mode === 'open' ? (1 - prog) : prog) * 100}%)`;
      backdrop.style.opacity = String(drag.mode === 'open' ? prog : (1 - prog));
    }, { passive: true });

    function endDrag(commit) {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.axis) return;                        // 탭이었을 뿐 — 손댄 게 없으니 정리도 불필요
      if (d.sheet) { d.sheet.style.transition = ''; d.sheet.style.transform = ''; }
      backdrop.style.transition = ''; backdrop.style.opacity = '';
      if (!commit) { if (d.mode === 'open') close(); return; }
      if (d.mode === 'open') {
        if (d.prog > OPEN_AT) { d.sheet.classList.add('sheet-open'); btns[STATS].classList.add('on'); backdrop.classList.add('on'); }
        else close();
      } else if (d.prog > OPEN_AT) close();
    }
    document.addEventListener('touchend', () => endDrag(true), { passive: true });
    document.addEventListener('touchcancel', () => endDrag(false), { passive: true });

    closeMobileSheets = close;
    mobileSheetOpen = () => sheets.some(s => target(s.cls) && target(s.cls).classList.contains('sheet-open'));
  }

  buildControls();
  renderAutoGrid();
  setupTopbarOverflow();  // 모바일: 상단바 보조 버튼을 「⋯」 메뉴로 접는다
  setupKbdAuto();         // onclick 만 있는 div 를 키보드에 닿게
  setupMobileSheets();    // 모바일: 성능·무장·상세 슬라이드 시트 + 하단 액션바
  loadBanned();           // 저장된 기본 제외 파츠 복원
  loadFavRecent();        // 즐겨찾기·최근 기체 복원
  renderViewChips();
  renderDataFresh();
  updateOwnedUi();        // 버튼 배지·모달 노트 초기화
  // 빌드 화면이 곧바로 채워지도록 기본 기체를 잡아두되, 시작 화면은 ① 기체 선택.
  state.ms = msData.find(m => T.msName(m.MS名).startsWith('건담 ')) || msData[0];
  renderAll();
  setView('select');

  /* 점검 도구용 최소 창구. 화면을 거치지 않고는 전 기체를 훑을 수 없는데,
     파서를 도구 쪽에 베껴 두면 앱과 조용히 갈라진다(09-08 교훈의 같은 부류).
     여기로 내보내는 것은 **읽기 전용 조회**뿐이다 — 상태를 바꾸는 것은 넣지 않는다. */
  window.GBO2UiTest = {
    msData: () => msData,
    msLevel,
    // foeArmorOf 는 지금 고른 기체를 본다 — 게이트가 기체를 바꿔 가며 훑으려고 연다.
    setMs: m => { state.ms = m; },
    cardFit: () => cardFit,  // 카드 무장표가 칸을 넘었는가 — 캔버스는 밖에서 못 읽는다
    weaponIgnoresShield,    // 실드를 무시하는 무장인가
    weaponFoeArmorCut,      // 무장이 적 내성을 깎는 몫 — 게이트에서 재려고
    skillFoeArmorCut,       // 발동시킨 스킬이 깎는 몫
    foeArmorOf,
    durabilityOf,
    parseStagger,           // 누적치 배수 — 게이트에서 재려고
    fireMult,               // 전탄(동시발사) 배수 — 누적치 쪽과 어긋나지 않는지 대조하려고
    weaponData: () => weaponData,
    thrusterSkillsOf,
    thrusterUnmodelled,     // 「계산 안 함」에 든 것과 그 이유를 게이트에서 재려고
    /* 그 기체·그 LV 에서 앱이 **실제로 고른** 스킬 목록.
       게이트가 「스러스터를 건드리는 스킬이 말없이 사라지지 않았는가」를 재려면
       앱이 무엇을 골랐는지 알아야 한다. 게이트가 그 고르기를 흉내 내면
       재는 대상을 베끼는 셈이라 둘이 같이 틀려도 통과한다. */
    pickedSkills: (ms, lv, form) => {
      if (!ms) return [];
      const modes = skillModesFor(msSkillsData[baseName(ms.MS名)] || [], form);
      const byName = new Map();
      for (const mo of modes) for (const sk of (mo.skills || [])) {
        if (!byName.has(sk.name)) byName.set(sk.name, []);
        byName.get(sk.name).push(sk);
      }
      const out = [];
      for (const cands of byName.values()) {
        const sk = pickByMsLv(cands, lv);
        // 원문도 함께 넘긴다 — 그 LV 이 스러스터를 말하는지 게이트가 스스로 가려야 한다
        if (sk) out.push({ name: sk.name, lv: sk.lv || '', eff: sk.eff || '', desc: sk.desc || '' });
      }
      return out;
    },
    thrusterSkillFx,
    thrusterMetrics,        // 파츠·스킬 경감이 겹치는 방식(곱)을 게이트에서 재려고
    /* 방어 스킬의 발동 조건 라벨 — 조건부인 것이 '상시' 로 새면 늘 걸리는 값이 된다.
       게이트가 스스로 원문을 읽어 맞대 보려고 연다(라벨만 보면 수에 안 먹히는 것을 놓친다). */
    staggerSkillsOf,
    /* 공중 격투 제어 — 대결 화면과 게이트가 **같은 판정**을 쓰게 한다.
       두 군데에 두면 한쪽만 고쳐져 갈린다. */
    airMeleeOf,
    airMeleeWeapon,
    airPower,
    // 주무장 LV 왕복 점검용 — 읽기만 한다
    weaponLv: () => state.weaponLv,
    encodeShare: () => encodeShare()
  };
