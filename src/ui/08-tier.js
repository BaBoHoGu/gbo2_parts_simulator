  /* ui/08-tier.js — 기체 티어.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ===================== 기체 티어 =====================
     갤러리의 남은 반쪽이다 — 서버 투표가 이미 'build'(구성)와 'ms'(기체) 둘로 나뉘어 있고,
     기체 표는 **LV 을 가르지 않고 기체 단위**로 센다(그래야 표가 안 흩어진다).
     여기서는 그 집계를 순위로 세운다. 필터는 갤러리 것을 그대로 나눠 쓴다.

     등수를 매기는 값은 **순수 점수(👍−👎)** 를 기본으로 둔다.
     비율(👍/전체)은 표가 적을 때 거짓말을 한다 — 한 표만 받아도 100% 가 된다.
     그래서 비율 정렬은 따로 두되 **최소 표 수**를 걸고, 화면에 그 사실을 적는다. */
  let tierSort = 'net';        // 'net' 순수 점수 | 'ratio' 추천률 | 'count' 표 많은 순
  let tierShow = 'voted';      // 'voted' 표 있는 것만 | 'all' 전체
  const TIER_MIN_VOTES = 5;    // 추천률 정렬에서 「믿을 만하다」고 볼 최소 표 수

  /** 기체 base 이름 → 그 기체를 대표할 최고 LV 자료. 화면에 그림·코스트·등급을 적으려고 쓴다. */
  const tierRepOf = base => {
    const arr = msByBase.get(base) || [];
    return arr[arr.length - 1] || null;
  };

  function tierRows() {
    const st = voteState.ms;
    const tq = state.msQuery.trim().toLowerCase();
    const out = [];
    for (const [base, arr] of msByBase) {
      const rep = arr[arr.length - 1];
      if (!rep) continue;
      const [up, down] = st.totals[base] || [0, 0];
      const total = up + down;
      if (tierShow === 'voted' && total === 0) continue;
      /* 기체 선택 화면과 **같은 축**으로 거른다 — 레벨만 뺀다(표가 LV 을 안 가른다).
         즐겨찾기·최근은 LV 별로 저장돼 있으므로 「그 기체의 어느 LV 라도」로 본다. */
      if (state.msView === 'fav' && !arr.some(m => state.favorites.has(m.MS名))) continue;
      if (state.msView === 'recent' && !arr.some(m => state.recent.includes(m.MS名))) continue;
      if (state.msAttr && rep['属性'] !== state.msAttr) continue;
      if (state.msCost === 'low') { if (rep['コスト'] > 250) continue; }
      else if (state.msCost !== 'all' && rep['コスト'] !== state.msCost) continue;
      if (state.msRarity !== 'all' && msRarity(rep) !== state.msRarity) continue;
      // 목록과 **같은 검색**을 쓴다(matches + msSearchText) — 따로 두면 결과가 어긋난다.
      // 표는 기체 단위라 어느 LV 이름에든 걸리면 통과시킨다.
      if (tq && !arr.some(m => matches(msSearchText.get(m), tq))) continue;
      out.push({ base, rep, up, down, total, net: up - down,
        ratio: total ? up / total : 0 });
    }
    const by = {
      net: (a, b) => b.net - a.net || b.total - a.total,
      count: (a, b) => b.total - a.total || b.net - a.net,
      // 표가 적은 것은 뒤로 — 한 표짜리 100% 가 1위가 되면 표가 뜻을 잃는다
      ratio: (a, b) => {
        const qa = a.total >= TIER_MIN_VOTES, qb = b.total >= TIER_MIN_VOTES;
        if (qa !== qb) return qa ? -1 : 1;
        return b.ratio - a.ratio || b.total - a.total;
      }
    }[tierSort];
    out.sort(by);
    return out;
  }

  function renderTier() {
    const box = $('#tierResults'), note = $('#msCount');
    if (!box) return;
    box.innerHTML = '';
    if (!voteState.ms.loaded) {
      box.append(el('div', 'empty-state', '표를 받아 오는 중…'));
      loadVotes('ms');
      return;
    }
    const rows = tierRows();
    if (note) note.textContent = rows.length + '기';
    if (!rows.length) {
      box.append(el('div', 'empty-state',
        tierShow === 'voted'
          ? '아직 표를 받은 기체가 없습니다. 「범위: 전체」로 바꿔 마음에 드는 기체에 표를 놓아 주세요.'
          : '조건에 맞는 기체가 없습니다.'));
      return;
    }

    let rank = 0, prevKey = null;
    for (const r of rows) {
      // 같은 값이면 같은 등수 — 순위표에서 동점을 억지로 가르면 없는 차이를 만든다
      const key = tierSort === 'ratio' ? r.ratio + '|' + (r.total >= TIER_MIN_VOTES)
        : tierSort === 'count' ? r.total : r.net;
      if (key !== prevKey) { rank = rows.indexOf(r) + 1; prevKey = key; }

      const row = el('div', 'tier-row');
      row.append(el('div', 'tier-rank' + (rank <= 3 ? ' top' : ''), String(rank)));
      row.append(img(msImg(r.rep.MS名), 'ms', r.rep.MS名));

      const info = el('div', 'tier-info');
      const nm = el('div', 'tier-nm', T.msName(r.rep.MS名).replace(/\s*LV\d+$/i, ''));
      nm.title = r.base;
      info.append(nm);
      const meta = el('div', 'tier-meta');
      meta.append(attrMark(r.rep['属性']));
      meta.append(el('span', '', T.attrName(r.rep['属性']) || '-'));
      meta.append(el('span', 'cost-badge', r.rep['コスト']));
      const rr = msRarity(r.rep);
      if (rr) meta.append(rarityChip(rr));
      info.append(meta);
      row.append(info);

      const sc = el('div', 'tier-score');
      if (r.total) {
        sc.append(el('b', 'tier-net' + (r.net > 0 ? ' plus' : r.net < 0 ? ' minus' : ''),
          (r.net > 0 ? '+' : '') + r.net));
        sc.append(el('span', 'tier-sub', Math.round(r.ratio * 100) + '% · ' + r.total + '표'));
      } else {
        sc.append(el('span', 'tier-sub', '표 없음'));
      }
      row.append(sc);
      row.append(voteBar('ms', r.base));

      // 누르면 오른쪽 정보 칸이 열린다 — 목록의 ⓘ 와 같은 동작이라 배울 것이 없다
      row.onclick = ev => {
        if (ev.target.closest('.vote-bar')) return;
        openInfo(r.rep);
      };
      box.append(row);
    }
  }

  /** 기체 선택 화면의 보기(목록 / 티어)를 바꾼다. 고른 것은 기억한다. */
  let msViewTab = 'list';
  try { msViewTab = localStorage.getItem('gbo2.msViewTab') === 'tier' ? 'tier' : 'list'; } catch (e) {}
  function applyMsViewTab() {
    const isTier = msViewTab === 'tier';
    const set = (sel, on) => { const e = $(sel); if (e) e.hidden = !on; };
    set('#msList', !isTier);
    set('#tierResults', isTier);
    set('#tierSortGroup', isTier);
    set('#tierShowGroup', isTier);
    set('#msLvGroup', !isTier);          // 표는 LV 을 가르지 않는다
    const seg = $('#msViewSeg');
    if (seg) for (const b of seg.querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.t === msViewTab);
    }
    if (isTier) renderTier(); else renderMsList();
  }

  function renderGallery() {
    const box = $('#galleryResults'), note = $('#galleryNote');
    if (!box) return;
    box.innerHTML = '';
    if (galleryLoading) { box.append(el('div', 'detail-empty', '불러오는 중…')); return; }

    const q = ($('#galleryQuery').value || '').trim().toLowerCase();
    let list = galleryList;
    if (q) list = list.filter(b => {
      const ms = msData.find(m => m.MS名 === b.ms);
      const idx = searchIndex((ms ? T.msName(ms.MS名) : b.ms) + ' ' + b.ms + ' ' + b.name);
      return matches(idx, q);
    });
    if (gallerySort === 'ms') {
      list = [...list].sort((a, b) => {
        const an = T.msName(a.ms), bn = T.msName(b.ms);
        return an.localeCompare(bn, 'ko') || b.at - a.at;
      });
    } else if (gallerySort === 'vote') {
      // 추천에서 비추를 뺀 점수. 같으면 추천이 많은 쪽, 그다음 최신순.
      // 비추를 빼는 이유: 추천만 보면 표가 많이 오간 구성이 늘 위로 간다.
      list = [...list].sort((a, b) => voteScore(a.id) - voteScore(b.id)
        || voteUp(b.id) - voteUp(a.id) || b.at - a.at);
      list.reverse();
    }
    // 구성 자체의 성질 — 기체를 찾을 필요가 없다(옛 구성도 제대로 걸린다).
    // free 는 서버가 파츠 표로 정해 보낸 값이라 카드의 「무과금」 딱지와 늘 같다.
    if (galleryFree === 'free') list = list.filter(b => b.free);
    if (galleryStage !== 'all') list = list.filter(b => Number(b.stage) === galleryStage);
    // 기체 기준 필터들 — 카드의 기체를 찾아 한 번에 거른다
    if (galleryAttr || galleryCost !== 'all' || galleryLv !== 'all' || galleryRarity !== 'all') {
      list = list.filter(b => {
        const ms = msData.find(m => m.MS名 === b.ms);
        if (!ms) return false;
        if (galleryAttr && ms.属性 !== galleryAttr) return false;
        if (galleryCost === 'low') { if (ms.コスト > 250) return false; }
        else if (galleryCost !== 'all' && ms.コスト !== galleryCost) return false;
        if (galleryLv === '4+') { if (msLevel(ms) < 4) return false; }
        else if (galleryLv !== 'all' && msLevel(ms) !== galleryLv) return false;
        if (galleryRarity !== 'all' && msRarity(ms) !== galleryRarity) return false;
        return true;
      });
    }
    note.textContent = galleryList.length ? `${list.length} / ${galleryList.length}개` : '';

    if (!list.length) {
      box.append(el('div', 'detail-empty', galleryList.length
        ? '검색 결과가 없습니다.'
        : '아직 올라온 구성이 없습니다.\n상단 「↑ 내 구성 올리기」로 첫 구성을 올려 보세요.'));
      return;
    }
    for (const bld of list) {
      // 올린 날짜와 그때의 데이터 버전을 함께 보여 준다 — 오래된 구성은 파츠가 빠질 수 있다
      const sub = [relTime(bld.at), bld.ver && ('데이터 ' + bld.ver)].filter(Boolean).join(' · ');
      box.append(buildSummaryCard(bld, {
        sub,
        vote: bld.id,       // 추천·비추
        uniform: true,      // 격자라 카드마다 줄 위치가 어긋나면 읽기 나쁘다
        desc: bld.desc,
        author: bld.author,
        ipHead: bld.ipHead,
        // ✕ 는 두 경우에 붙는다 — 관리자이거나, 비밀번호가 걸린 구성이거나.
        // 버튼이 보인다고 지워지는 게 아니다. 관리자는 토큰을, 올린 사람은 비밀번호를
        // 서버가 다시 확인한다. 관리자로 로그인해 있으면 비밀번호를 묻지 않는다
        // — 관리자에게는 이 기능이 생기기 전과 똑같이 보인다.
        onDel: (S && (S.isAdmin() || bld.hasPw)) ? async () => {
          if (S.isAdmin()) {
            if (!confirm(`「${bld.name}」 구성을 갤러리에서 지울까요?`)) return;
            const r = await S.remove(bld.id);
            toast(r.msg);
            if (r.ok) { galleryList = galleryList.filter(x => x.id !== bld.id); renderGallery(); }
            return;
          }
          const pw = prompt(`「${bld.name}」 구성을 내립니다.\n올릴 때 정한 비밀번호를 입력하세요.`);
          if (pw == null) return;                       // 취소
          const r = await S.remove(bld.id, pw.trim());
          toast(r.msg);
          if (r.ok) { galleryList = galleryList.filter(x => x.id !== bld.id); renderGallery(); }
        } : null,
        onOpen: () => {
          // deserialize 가 화면을 바꾸면서 「기체 변경」 문구를 정하므로 **먼저** 세운다.
          // 뒤에 세우면 이미 그려진 버튼이 옛 문구를 달고 있다.
          fromGallery = true;
          const r = deserialize(bld);
          // 성공하면 deserialize 가 이미 파츠 적용 화면을 띄웠다 — 여기서 화면을 또
          // 옮기면 「들어오기 전 화면」으로 돌아가 버린다. 실패했을 때만 갤러리에 남는다.
          if (!r.ok) { fromGallery = false; openGallery(false); }
          toast(r.ok
            ? ('「' + bld.name + '」 가져왔습니다' + loadNote(r))
            : '이 구성의 기체가 내 데이터에 없습니다');
        }
      }));
    }
  }

  async function loadGallery() {
    if (!S) return;
    galleryLoading = true;
    renderGallery();
    const r = await S.list();
    galleryList = r.list || [];
    galleryLoading = false;
    renderGallery();
    if (!r.ok) {
      toast(galleryList.length
        ? '목록을 받지 못해 마지막으로 받아 둔 것을 보여 줍니다'
        : '갤러리에 연결하지 못했습니다 — 인터넷 연결을 확인하세요');
    }
  }

  /**
   * @param {boolean} open
   * @param {boolean} [back] 「‹ 갤러리로」처럼 **되돌아오는** 경우.
   *   갤러리에서 구성을 열고 다시 갤러리로 돌아온 것이므로 '들어오기 전 화면' 은
   *   그대로 둬야 한다. 안 그러면 그 구성이 '들어오기 전' 이 돼, 「돌아가기」가
   *   기체 선택이 아니라 방금 보던 구성으로 되돌아가는 고리가 생긴다.
   */
  function openGallery(open) {
    if (!open) { setView(AUX_BACK); return; }
    setView('gallery');
    // 캐시가 있으면 먼저 보여 주고(오프라인에서도 열린다) 새로 받아 온다
    if (!galleryList.length && S) galleryList = S.readCache();
    updateAdminBtn();
    renderGallery();
    loadGallery();
    loadVotes('build');
  }

  // 스킬명을 긴 것부터. 짧은 이름이 긴 이름을 잘라먹지 않게 한다.
  let _skNames = null;
  const skillNamesByLen = () => (_skNames ||= Object.keys(skillText).sort((a, b) => b.length - a.length));

