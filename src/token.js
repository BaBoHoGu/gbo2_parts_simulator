
(function () {
  const $ = id => document.getElementById(id);
  // 날짜 문자열(YYYY-MM-DD)을 로컬 자정 Date로 파싱 (UTC 파싱으로 인한 시간 어긋남 방지)
  const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  // 오늘 날짜를 로컬 기준 YYYY-MM-DD로 (toISOString은 UTC라 KST 새벽에 하루 어긋남)
  const todayStr = () => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); };
  const MAX_RANGE_DAYS = 3660;  // 계산 범위 상한(약 10년) — 먼 날짜로 인한 브라우저 프리징 방지
  // 주간 토큰 지급일(1·11·21일 주기의 3·5·7번째 = 매월 이 날짜들에 각 1토큰)
  const WEEKLY_DAYS = [3, 5, 7, 13, 15, 17, 23, 25, 27];
  // 내역 구성 막대용: [키, 라벨] — 양(+) 기여 항목만 (U3)
  const BD_SEGS = [['current', '기존'], ['daily', '일일 임무'], ['weekly', '주간'], ['quests', '특수 임무'], ['gold', '금상자'], ['log', '예정 수급'], ['plat', '백금장']];
  const currentTokenVal = () => Math.max(0, parseInt($('currentToken').value) || 0);
  const currentDateInput = $('currentDate');
  const currentTokenInput = $('currentToken');
  const targetDateInput = $('targetDate');
  const dailyTaskCheckbox = $('dailyTaskDone');
  const questCheckboxes = document.querySelectorAll('.questCheckbox');
  const questCounts = document.querySelectorAll('.questCount');

  currentDateInput.value = todayStr();
  $('logDate').value = todayStr();

  // 금상자 카운터
  let goldCount = 0;
  function renderGold() { $('goldCount').textContent = goldCount; }
  $('goldPlus').addEventListener('click', () => { goldCount++; renderGold(); calc(); });
  $('goldMinus').addEventListener('click', () => { if (goldCount > 0) goldCount--; renderGold(); calc(); });

  function renderDeps() {
    renderGoals();
    renderPlatinum();
    renderReach();
    renderSolve();
  }
  function calc() {
    $('bdBar').innerHTML = '';
    $('bdBarCap').style.display = 'none';
    $('questMax').textContent = '우측 숫자 = 적용 횟수(달 수). 범위가 여러 달이면 최대 그 개월 수만큼 반복 적용';
    if (!currentDateInput.value || !targetDateInput.value || !currentTokenInput.value) {
      $('resultToken').textContent = '-';
      $('resultDays').textContent = '';
      renderDeps();
      return;
    }

    const start = pd(currentDateInput.value);
    const target = pd(targetDateInput.value);
    const currentToken = currentTokenVal();

    if (isNaN(start) || isNaN(target)) {
      $('resultToken').textContent = '날짜 확인';
      $('resultDays').textContent = '';
      renderDeps();
      return;
    }

    // 오늘 포함 남은 일수
    const daysLeft = Math.floor((target - start) / 86400000) + 1;
    if (daysLeft < 1) {
      $('resultToken').textContent = '날짜 확인';
      $('resultDays').textContent = '목표 날짜가 오늘보다 빠릅니다';
      renderDeps();
      return;
    }
    if (daysLeft > MAX_RANGE_DAYS) {
      $('resultToken').textContent = '범위 초과';
      $('resultDays').textContent = '목표 날짜가 너무 멉니다 (최대 약 10년)';
      renderDeps();
      return;
    }

    // 일일 임무: 오늘은 체크 시에만, 이후 매일 +3
    let daily = 0;
    for (let i = 0; i < daysLeft; i++) {
      if (i === 0) { if (dailyTaskCheckbox.checked) daily += 3; }
      else daily += 3;
    }

    // 주간: 매월 WEEKLY_DAYS(3·5·7·13·15·17·23·25·27일)에 각 1토큰 (매일 접속 가정)
    let weekly = 0;
    const d = new Date(start);
    while (d <= target) {
      if (WEEKLY_DAYS.includes(d.getDate())) weekly += 1;
      d.setDate(d.getDate() + 1);
    }

    // 특수 임무: 체크 시 (토큰 × 적용 횟수). 최대 횟수 = 범위가 걸친 개월 수
    const monthSpan = (target.getFullYear() * 12 + target.getMonth()) - (start.getFullYear() * 12 + start.getMonth()) + 1;
    let quests = 0;
    questCheckboxes.forEach((c, idx) => {
      const cntEl = questCounts[idx];
      cntEl.max = monthSpan;
      let cnt = parseInt(cntEl.value) || 1;
      if (cnt < 1) cnt = 1;
      if (cnt > monthSpan) cnt = monthSpan;
      if (c.checked) quests += (parseInt(c.getAttribute('data-tokens')) || 0) * cnt;
    });
    $('questMax').textContent = `우측 숫자 = 적용 횟수 · 현재 범위 ${monthSpan}개월 → 임무별 최대 ${monthSpan}회`;

    const gold = goldCount * 3;

    // 범위 내 날짜 판정 (현재 날짜 ~ 목표 날짜, 양끝 포함)
    const inRange = ds => {
      if (!ds) return false;
      const dd = pd(ds);
      return dd >= start && dd <= target;
    };

    // 예정 수급: 기록 장부에서 범위 내 날짜 항목의 증감 합산
    let logSum = 0;
    (logs || []).forEach(l => { if (inRange(l.date)) logSum += Number(l.change) || 0; });

    // 목표 소모: 픽업 기간이 계산기 범위와 겹치는 목표의 필요 토큰만큼 차감
    const overlaps = (s, e) => {
      if (!s || !e) return false;
      return pd(s) <= target && pd(e) >= start;
    };
    let goalSpend = 0;
    (goals || []).forEach(g => { if (overlaps(g.start, g.end)) goalSpend += Math.max(0, Number(g.need) || 0); });

    // 백금장: 달성일 기준 + 이후 주기 자동 생성, 범위 내 날짜만 합산
    let platSum = 0;
    (platinum || []).forEach(p => {
      platinumAllTokenDays(p.date, target).forEach(td => { if (td >= start && td <= target) platSum++; });
    });

    const total = currentToken + daily + weekly + quests + gold + logSum - goalSpend + platSum;

    $('resultToken').textContent = total;
    $('resultDays').textContent = daysLeft + '일간 수급 (오늘 포함)';
    $('bdCurrent').textContent = currentToken;
    $('bdDaily').textContent = '+' + daily;
    $('bdWeekly').textContent = '+' + weekly;
    $('bdQuests').textContent = '+' + quests;
    $('bdGold').textContent = '+' + gold;
    $('bdLog').textContent = (logSum >= 0 ? '+' : '') + logSum;
    $('bdGoal').textContent = goalSpend > 0 ? '-' + goalSpend : '0';
    $('bdPlatinum').textContent = '+' + platSum;
    $('bdTotal').textContent = total;
    const barVals = { current: currentToken, daily: daily, weekly: weekly, quests: quests, gold: gold, log: Math.max(0, logSum), plat: platSum };
    const gross = BD_SEGS.reduce((s, seg) => s + barVals[seg[0]], 0);
    if (gross > 0) {
      $('bdBar').innerHTML = BD_SEGS.filter(seg => barVals[seg[0]] > 0)
        .map(seg => `<span class="seg seg-${seg[0]}" style="width:${(barVals[seg[0]] / gross * 100).toFixed(2)}%" title="${seg[1]}: ${barVals[seg[0]]}"></span>`).join('');
      $('bdBarCap').style.display = '';
    }

    renderDeps();
  }

  currentDateInput.addEventListener('change', () => { questCounts.forEach(clampQuest); calc(); });
  currentTokenInput.addEventListener('input', calc);
  targetDateInput.addEventListener('change', () => { questCounts.forEach(clampQuest); calc(); });
  dailyTaskCheckbox.addEventListener('change', calc);
  // 현재 범위가 걸친 개월 수 (날짜 미입력 시 제한 없음)
  function currentMonthSpan() {
    if (!currentDateInput.value || !targetDateInput.value) return Infinity;
    const s = pd(currentDateInput.value), t = pd(targetDateInput.value);
    if (isNaN(s) || isNaN(t)) return Infinity;
    return Math.max(1, (t.getFullYear() * 12 + t.getMonth()) - (s.getFullYear() * 12 + s.getMonth()) + 1);
  }
  function clampQuest(el) {
    const ms = currentMonthSpan();
    el.max = isFinite(ms) ? ms : '';
    const v = parseInt(el.value);
    if (!isNaN(v) && isFinite(ms) && v > ms) el.value = ms;
  }
  questCheckboxes.forEach(c => c.addEventListener('change', calc));
  questCounts.forEach(c => c.addEventListener('input', () => { clampQuest(c); calc(); }));

  /* ---------- 저장소 ---------- */
  // 손상 데이터 정제: 배열 안에 null/문자열 같은 비정상 요소가 하나라도 있으면
  // 렌더가 예외로 죽고, 그 상태가 저장돼 새로고침해도 반복된다(사용자 복구 불가).
  // → 로드/가져오기 양쪽에서 반드시 통과시켜, 이미 오염된 저장본도 자가 치유되게 한다.
  const sanitizeList = (v, keys) => {
    if (!Array.isArray(v)) return [];
    return v.filter(o => o && typeof o === 'object' && !Array.isArray(o))
      .map(o => { const r = {}; keys.forEach(k => { if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; }); return r; });
  };
  const GOAL_KEYS = ['name', 'need', 'start', 'end'];
  const LOG_KEYS = ['date', 'desc', 'change', 'banked'];
  const PLAT_KEYS = ['date'];

  // 저장 실패를 조용히 넘기면 안 된다 — file:// 에서 브라우저가 저장을 막으면
  // 사용자는 아무것도 보관되지 않는다는 걸 다음 실행 때까지 모른다.
  let storeWarned = false;
  function warnStorage() {
    if (storeWarned) return;
    storeWarned = true;
    const el = $('storeWarn');
    if (el) el.style.display = '';
  }
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { console.warn('저장 데이터 파싱 실패, 기본값 사용:', k, e); return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('저장 실패(용량/시크릿 모드?):', k, e); warnStorage(); } }
  };

  // 입력을 시작하기 전에 알리려고 로드 시점에 저장 가능 여부를 미리 확인한다.
  try { localStorage.setItem('__tc_probe', '1'); localStorage.removeItem('__tc_probe'); } catch (e) { warnStorage(); }

  /* ---------- 목표 관리 ---------- */
  const dkey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  // 특수 임무 토큰을 '지급 날짜'별로 배분. 적용 횟수 N = N개월에 걸쳐 매달 1회분(시작일 기준).
  // (day0에 전액 선불하면, 종료가 이른 픽업도 미래 월분까지 가진 것으로 착각 → 달성 판정 과대평가)
  function questTallyFrom(start) {
    const tally = {};
    questCheckboxes.forEach((c, idx) => {
      if (!c.checked) return;
      const tok = parseInt(c.getAttribute('data-tokens')) || 0;
      const cnt = Math.max(1, parseInt(questCounts[idx].value) || 1);
      for (let n = 0; n < cnt; n++) {
        const kk = dkey(new Date(start.getFullYear(), start.getMonth() + n, start.getDate()));
        tally[kk] = (tally[kk] || 0) + tok;   // n=0은 시작일에 지급
      }
    });
    return tally;
  }
  // 일자별 누적 시뮬레이션. needN이 주어지면 도달한 첫 Date(없으면 null), 없으면 horizon까지의 총 토큰 반환
  function simulate(horizon, needN) {
    const wantDate = needN != null;
    if (!currentDateInput.value || isNaN(horizon) || (wantDate && isNaN(needN))) return null;
    const start = pd(currentDateInput.value);
    if (isNaN(start)) return null;
    let running = currentTokenVal() + goldCount * 3;
    if (wantDate && running >= needN) return start;
    if (horizon < start) return wantDate ? null : running;
    const platTally = {}, logTally = {}, questTally = questTallyFrom(start);
    (platinum || []).forEach(p => { platinumAllTokenDays(p.date, horizon).forEach(td => { const k = dkey(td); platTally[k] = (platTally[k] || 0) + 1; }); });
    (logs || []).forEach(l => { if (l.date && !isNaN(pd(l.date))) { const lk = dkey(pd(l.date)); logTally[lk] = (logTally[lk] || 0) + (Number(l.change) || 0); } });
    const d = new Date(start); let guard = 0;
    while (d <= horizon && guard++ < MAX_RANGE_DAYS + 40) {
      if (d.getTime() === start.getTime()) { if (dailyTaskCheckbox.checked) running += 3; }
      else running += 3;
      if (WEEKLY_DAYS.includes(d.getDate())) running += 1;
      const k = dkey(d);
      if (platTally[k]) running += platTally[k];
      if (logTally[k]) running += logTally[k];
      if (questTally[k]) running += questTally[k];
      if (wantDate && running >= needN) return new Date(d);
      d.setDate(d.getDate() + 1);
    }
    return wantDate ? null : running;
  }
  // 필요 토큰 도달 첫 날짜(없으면 null)
  const predictAchieveDate = (needN, horizon) => simulate(horizon, needN);
  // horizon까지 누적 예상 토큰 (목표 소모 미반영)
  const predictedTokensAt = (horizon) => simulate(horizon, null);
  // 특수 임무 메타(이름·토큰·체크 상태)
  const QUESTS = Array.from(questCheckboxes).map(c => ({
    el: c,
    tok: parseInt(c.getAttribute('data-tokens')) || 0,
    name: ((c.parentElement && c.parentElement.textContent) || '').replace(/\s*\+\d+\s*$/, '').trim()
  }));

  // 픽업까지 D-day 배지 (오늘 날짜 입력 기준)
  function ddayBadge(g) {
    if (!g.start && !g.end) return '';
    const today = pd(currentDateInput.value || todayStr());
    if (isNaN(today)) return '';
    const s = g.start ? pd(g.start) : null;
    const e = g.end ? pd(g.end) : null;
    if (s && today < s) {
      const days = Math.round((s - today) / 86400000);
      return `<div class="dday dday-wait">픽업까지 D-${days}</div>`;
    }
    if (e && today > e) return `<div class="dday dday-end">픽업 종료</div>`;
    return `<div class="dday dday-active">픽업 진행중</div>`;
  }

  let goals = sanitizeList(store.get('tc_goals', []), GOAL_KEYS);
  function renderGoals() {
    const body = $('goalBody');
    if (!goals.length) { body.innerHTML = '<tr><td class="empty" colspan="5">등록된 목표가 없습니다</td></tr>'; return; }
    // 순차 판정: 픽업 시기(시작→종료) 순으로, 앞 목표가 쓴 토큰을 차감하며 판정
    const order = goals.map((g, i) => ({ g, i }))
      .filter(o => o.g.need !== '' && o.g.end && !isNaN(Number(o.g.need)) && !isNaN(pd(o.g.end)))
      .sort((a, b) => (a.g.start || a.g.end).localeCompare(b.g.start || b.g.end) || a.g.end.localeCompare(b.g.end));
    const judge = {};  // index -> { ok, date, short }
    let committed = 0;
    order.forEach((o, rank) => {
      const need = Math.max(0, Number(o.g.need)), end = pd(o.g.end);
      const eff = need + committed;                 // 앞선 목표 소모를 더한 실질 필요량
      const ad = predictAchieveDate(eff, end);
      if (ad) { judge[o.i] = { ok: true, date: ad, rank: rank + 1 }; committed += need; }
      else {
        const have = predictedTokensAt(end);
        judge[o.i] = { ok: false, rank: rank + 1, short: eff - (have == null ? 0 : have) };
      }
    });

    body.innerHTML = goals.map((g, i) => {
      const period = esc(g.start || '?') + ' ~ ' + esc(g.end || '?');
      let badge = '-';
      const j = judge[i];
      if (j) {
        badge = j.ok
          ? `<span class="badge-ok">가능</span><div class="goal-eta">${dkey(j.date)} 예상</div>`
          : '<span class="badge-no">부족</span>';
      }
      return `<tr>
        <td>${esc(g.name)}</td><td>${period}${ddayBadge(g)}</td>
        <td class="num">${g.need ? esc(g.need) : '-'}</td>
        <td>${badge}</td>
        <td><button class="btn" data-gi-edit="${i}">수정</button> <button class="btn danger" data-gi="${i}">삭제</button></td>
      </tr>`;
    }).join('');

    // 픽업 기간 내 달성 불가 목표에 대한 추천 (순차 판정 기준 부족분)
    const recs = [];
    goals.forEach((g, i) => {
      const j = judge[i];
      if (!j || j.ok) return;
      const short = j.short;
      if (!isFinite(short) || short <= 0) return;
      const gold = Math.ceil(short / 3);
      let rem = short; const picks = [];
      QUESTS.filter(q => !q.el.checked && q.tok > 0).sort((a, b) => b.tok - a.tok).forEach(q => {
        if (rem > 0) { picks.push(`${q.name}(+${q.tok})`); rem -= q.tok; }
      });
      const questText = picks.length ? picks.join(', ') + (rem > 0 ? ' 등' : '') : '없음(임무 모두 완료됨)';
      recs.push(`<div class="rec-item">
        <b>${esc(g.name)}</b> — 픽업 종료(${esc(g.end)})까지 <b class="rec-short">${short}토큰 부족</b>
        <div class="rec-sub first">· 금상자 <b>${gold}개</b> 추가 획득</div>
        <div class="rec-sub">· 또는 미완료 임무 완료: ${questText}</div>
      </div>`);
    });
    $('goalRecommend').innerHTML = recs.length
      ? `<div class="rec-box"><b>💡 달성 추천</b><div class="rec-list">${recs.join('')}</div></div>`
      : '';
  }
  let goalEditIdx = -1;
  function resetGoalForm() {
    goalEditIdx = -1;
    $('goalName').value = $('goalNeed').value = $('goalStart').value = $('goalEnd').value = '';
    $('goalAdd').textContent = '목표 추가';
    $('goalCancel').style.display = 'none';
  }
  $('goalAdd').addEventListener('click', () => {
    const name = $('goalName').value.trim();
    if (!name) { alert('목표 이름을 입력하세요'); return; }
    const gs = $('goalStart').value, ge = $('goalEnd').value;
    if (gs && ge && pd(ge) < pd(gs)) { alert('픽업 종료일이 시작일보다 빠릅니다.'); return; }
    const obj = { name, need: $('goalNeed').value, start: gs, end: ge };
    if (goalEditIdx >= 0 && goalEditIdx < goals.length) goals[goalEditIdx] = obj; else goals.push(obj);
    store.set('tc_goals', goals); resetGoalForm(); renderGoals(); calc();
  });
  $('goalCancel').addEventListener('click', resetGoalForm);
  $('goalBody').addEventListener('click', e => {
    const ei = e.target.getAttribute('data-gi-edit');
    if (ei !== null) {
      const g = goals[+ei]; if (!g) return;
      $('goalName').value = g.name || ''; $('goalNeed').value = g.need || '';
      $('goalStart').value = g.start || ''; $('goalEnd').value = g.end || '';
      goalEditIdx = +ei;
      $('goalAdd').textContent = '목표 저장';
      $('goalCancel').style.display = '';
      $('goalName').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const i = e.target.getAttribute('data-gi');
    if (i !== null && confirm('이 목표를 삭제할까요?')) { goals.splice(+i, 1); resetGoalForm(); store.set('tc_goals', goals); renderGoals(); calc(); }
  });

  /* ---------- 픽업 예고(콘솔) + 스팀 실제 공지 (run.bat이 자동 갱신) ---------- */
  // 픽업 데이터는 data/pickups.json 에 있다 — 갱신기(update_pickups.ps1)가 만드는
  // 산출물이라 코드에 박아 두지 않는다. 빌드가 window.GBO2_PICKUPS 로 심는다.
  const PK = window.GBO2_PICKUPS || {};
  const PICKUPS_UPDATED = PK.pickupsUpdated || '';
  const PICKUPS = PK.pickups || [];
  const STEAM_NEWS_UPDATED = PK.steamUpdated || '';
  const STEAM_NEWS = PK.steamNews || [];
  // 자동 갱신은 사이트 포맷이 바뀌면 기존 데이터를 지키며 조용히 실패한다(의도된 안전장치).
  // 며칠째 갱신이 안 됐는지 보여야, 낡은 픽업 일정으로 계획을 세우는 걸 막을 수 있다.
  const STALE_DAYS = 14;
  function setUpdated(elId, dateStr) {
    const el = $(elId);
    if (!el) return;
    if (typeof dateStr !== 'string' || !dateStr || isNaN(pd(dateStr))) { el.textContent = '-'; el.className = ''; return; }
    const days = Math.round((pd(todayStr()) - pd(dateStr)) / 86400000);
    const stale = days >= STALE_DAYS;
    const ago = days <= 0 ? '오늘' : days + '일 전';
    el.textContent = dateStr + ' (' + ago + (stale ? ' · 갱신 필요' : '') + ')';
    el.className = stale ? 'stale' : '';
  }
  /* ---------- 미래시 ----------
   * 콘솔 공지에서 온 「스팀 예상 일정」을 달력처럼 편다. 아래 표와 **같은 데이터**다 —
   * 표는 줄을 읽어야 알고, 이건 언제가 비고 언제가 몰리는지를 본다.
   *
   * 「미래시에서 벗어난 것」도 같이 짚는다. 콘솔 일정은 추정이라 실제 스팀이 앞당겨지거나
   * 밀린다. 실제로 건담 DX 가 예보 10-29 인데 스팀에는 08-27 에 나왔다 — 스팀 쪽 이름에
   * 「【가을 축제 전월제】:」 같은 접두사가 붙어 계산기의 이름 대조가 빗나갔기 때문이다.
   * 그래서 여기서는 **느슨하게** 맞춘다(장식·괄호·공백을 떼고 한쪽이 다른 쪽을 품는지).
   */
  const MS_DAY = 86400000;

  /** 이름 대조용 열쇠 — 장식을 다 떼고 남는 글자. */
  function looseKey(s) {
    return pickName(s)
      .replace(/【[^】]*】/g, '')            // 【8주년 대감사제】 같은 머리표
      .replace(/^[^:：]*[:：]/, '')          // 「가을 축제 전월제:」 같은 접두사
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[\s·・()（）]/g, '')
      .toLowerCase();
  }

  /* 기체 이름 사전 — 파츠 시뮬레이터가 이미 들고 있는 것을 빌려 쓴다(GBO2_I18N.ms).
     왜 필요한가: 이름만 맞춰 「벗어남」을 잡으면 **커스텀 파츠·정비사 증원 티켓·개량 키트**
     처럼 몇 주마다 되풀이되는 품목이 매번 걸린다. 그건 벗어난 게 아니라 원래 반복이다.
     사용자가 말한 것은 「벗어난 **기체**」이므로, 기체로 아는 이름만 본다.
     목록을 새로 만들지 않는다 — 두 곳에 같은 목록을 두면 언젠가 어긋난다. */
  const MS_NAMES = (() => {
    const out = new Set();
    const src = (window.GBO2_I18N && window.GBO2_I18N.ms) || {};
    for (const ja of Object.keys(src)) {
      const ko = src[ja];
      if (typeof ko === 'string' && ko) out.add(looseKey(ko));
    }
    return out;
  })();

  /* 이력에서 「약속한 날이 지났는데 스팀에 안 나온 기체」를 찾는다.
   *
   * 왜 이력이 필요한가 — 갱신기는 지난 항목을 예보에서 지운다. 그래서 스냅샷만 보면
   * 그런 기체는 **흔적도 없이 사라진다.** 기라 줄루(CM) 가 그랬다: 8/29 예보에 09-10 로
   * 있었는데, 9/17 에는 예보에도 스팀에도 없다(그 주 스팀에는 다른 기체가 나왔다).
   *
   * 판정은 보수적으로 둔다 — 아직 예보에 남아 있으면 건드리지 않고, 스팀 목록은 최근
   * 한 달치뿐이라 **그보다 오래된 것은 판단하지 않는다.** 모르는 것을 단정하지 않는다.
   */
  function missedFromHistory() {
    const H = (window.GBO2_PICKUPS && window.GBO2_PICKUPS.history) || null;
    if (!H || !H.seen) return [];
    const today = pd(todayStr());
    const live = new Set(PICKUPS.map(p => looseKey(p.name)));
    // 스팀 목록이 덮는 가장 이른 날 — 이보다 전은 나왔는지 알 길이 없다
    const steamFrom = STEAM_NEWS.length
      ? STEAM_NEWS.map(s => s.start).filter(Boolean).sort()[0] : null;
    if (!steamFrom) return [];
    const out = [];
    for (const name of Object.keys(H.seen)) {
      const h = H.seen[name];
      if (!h || !h.start) continue;
      if (!isMech(name)) continue;                 // 되풀이되는 티켓·키트는 뺀다
      const k = looseKey(name);
      if (live.has(k)) continue;                   // 아직 예보에 있으면 지켜보는 중이다
      const when = pd(h.start);
      if (when >= today) continue;                 // 아직 안 지났다
      if (h.start < steamFrom) continue;           // 스팀 목록이 안 닿는 옛날 — 모른다
      if (STEAM_NEWS.some(s => {
        const sk = looseKey(s.name);
        return sk && (sk === k || sk.includes(k) || k.includes(sk));
      })) continue;                                // 이름이 달라도 실제로 나왔다
      out.push({ name: pickName(name), want: h.start,
        days: Math.round((today - when) / MS_DAY) });
    }
    return out.sort((a, b) => b.days - a.days);
  }

  /** 이 이름이 기체인가. 사전에 없으면 티켓·키트·이벤트 배너로 본다. */
  function isMech(name) {
    const k = looseKey(name);
    if (!k) return false;
    if (MS_NAMES.has(k)) return true;
    // 「데스티니 건담 LV1 & LV2」처럼 뒤에 LV 가 붙는 표기 — 그 부분을 떼고 다시 본다
    const bare = k.replace(/lv\d+(&lv\d+)?$/,'').replace(/&$/, '');
    return bare.length > 1 && MS_NAMES.has(bare);
  }

  /** 예보 하나가 실제 스팀에 이미 나왔는가. 나왔으면 그 스팀 항목을 돌려준다. */
  function alreadyOnSteam(p) {
    const k = looseKey(p.name);
    if (k.length < 2) return null;
    for (const s of STEAM_NEWS) {
      const sk = looseKey(s.name);
      if (!sk) continue;
      if (sk === k || sk.includes(k) || k.includes(sk)) return s;
    }
    return null;
  }

  /** 픽업을 달(YYYY-MM)별로 묶는다. 시작일이 낀 달에 넣는다 —
   *  주가 달을 걸치는 경우가 많아 끝일로 나누면 같은 픽업이 두 달에 걸쳐 보인다. */
  function byMonth(list) {
    const m = new Map();
    for (const p of list) {
      const k = String(p.start || '').slice(0, 7);
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  }

  /** 한 달치 타임라인 한 덩이. 주 눈금은 그 달 안에서만 센다. */
  function monthBlock(key, list, today) {
    const [Y, M] = key.split('-').map(Number);
    const mStart = new Date(Y, M - 1, 1), mEnd = new Date(Y, M, 0);
    const first = new Date(mStart);
    while (first.getDay() !== 3) first.setDate(first.getDate() - 1);   // 픽업은 수요일에 갈린다
    const weeks = Math.max(1, Math.ceil((mEnd - first) / (7 * MS_DAY)));
    const col = d => (pd(d) - first) / (7 * MS_DAY);

    let head = '';
    for (let w = 0; w < weeks; w++) {
      const d = new Date(+first + w * 7 * MS_DAY);
      head += '<div class="fw-cell"><span>' + (d.getMonth() + 1) + '/' + d.getDate() + '</span></div>';
    }

    let rows = '';
    for (const p of list) {
      const a = col(p.start), b = col(p.end);
      const left = Math.max(0, a) / weeks * 100;
      const width = Math.max(100 / weeks, (b - Math.max(0, a)) / weeks * 100);
      const past = pd(p.end) < today;
      const mech = isMech(p.name);
      rows += '<div class="fw-row">'
        + '<div class="fw-label' + (past ? ' past' : '') + (mech ? ' mech' : '') + '" title="'
        + esc(pickName(p.name)) + '">' + esc(pickName(p.name)) + '</div>'
        + '<div class="fw-track"><div class="fw-bar' + (past ? ' past' : '')
        + '" style="left:' + left.toFixed(3) + '%;width:' + Math.min(width, 100 - left).toFixed(3) + '%">'
        + (p.tokens != null ? '<span class="fw-tok">' + p.tokens + '</span>' : '')
        + '</div></div></div>';
    }

    const tl = (today - first) / (7 * MS_DAY) / weeks * 100;
    const showToday = tl >= 0 && tl <= 100;
    const mechN = list.filter(p => isMech(p.name)).length;
    return '<div class="fw-month-block">'
      + '<div class="fw-mhead">' + M + '월 <span>' + list.length + '건'
      + (mechN ? ' · 기체 ' + mechN : '') + '</span></div>'
      + '<div class="fw-row fw-headrow"><div class="fw-label"></div>'
      + '<div class="fw-track fw-head">' + head + '</div>'
      + (showToday ? '<div class="fw-todaylab" style="left:' + tl.toFixed(3) + '%">오늘</div>' : '')
      + '</div>'
      + '<div class="fw-rows">' + rows
      + (showToday ? '<div class="fw-today" style="left:calc(var(--fw-lab) + (100% - var(--fw-lab)) * '
        + (tl / 100).toFixed(4) + ')"></div>' : '')
      + '</div></div>';
  }

  function renderFuture() {
    setUpdated('futureUpdated', typeof PICKUPS_UPDATED === 'string' ? PICKUPS_UPDATED : '');
    const chart = $('futureChart'), offBox = $('futureOff');
    if (!chart) return;
    if (!PICKUPS.length) {
      chart.innerHTML = '<div class="empty">받아 둔 일정이 없습니다</div>';
      if (offBox) offBox.innerHTML = '';
      return;
    }

    const today = pd(todayStr());
    const off = [], rows = [];
    for (const p of PICKUPS) {
      const hit = alreadyOnSteam(p);
      if (hit && hit.start && p.start && hit.start !== p.start && isMech(p.name)) {
        off.push({ name: pickName(p.name), want: p.start, real: hit.start,
          days: Math.round((pd(p.start) - pd(hit.start)) / MS_DAY) });
      } else if (p.start && p.end) rows.push(p);
    }
    if (offBox) offBox.innerHTML = offHtml(off, missedFromHistory());

    if (!rows.length) { chart.innerHTML = '<div class="empty">그릴 일정이 없습니다</div>'; return; }
    rows.sort((a, b) => pd(a.start) - pd(b.start));
    chart.innerHTML = byMonth(rows).map(([k, v]) => monthBlock(k, v, today)).join('');
  }

  /** 벗어난 것 알림 — 「나왔는데 날짜가 다르다」와 「지났는데 안 나왔다」 둘 다 적는다. */
  function offHtml(off, missed) {
    if (!off.length && !missed.length) return '';
    let h = '<div class="future-off"><b>⚠ 미래시에서 벗어난 기체 '
      + (off.length + missed.length) + '건</b>';
    for (const o of off) {
      h += '<div class="future-off-row"><span class="fo-nm">' + esc(o.name) + '</span>'
        + '<span class="fo-d">예상 ' + esc(o.want) + ' → 실제 <b>' + esc(o.real) + '</b></span>'
        + '<span class="fo-gap">' + (o.days > 0 ? o.days + '일 앞당겨짐' : (-o.days) + '일 밀림') + '</span></div>';
    }
    for (const m of missed) {
      h += '<div class="future-off-row"><span class="fo-nm">' + esc(m.name) + '</span>'
        + '<span class="fo-d">예상 ' + esc(m.want) + ' 이 지났는데 스팀에 안 나왔습니다</span>'
        + '<span class="fo-gap">' + m.days + '일째 소식 없음</span></div>';
    }
    return h + '</div>';
  }

  /* 미래시를 그림 한 장으로. 화면 DOM 을 옮겨 주는 라이브러리를 쓰지 않고 캔버스에 직접
     그린다 — 이 앱이 성능 카드에서 쓰는 방식이고, 밖에서 받아 올 것이 없다.
     배치는 화면과 같게 맞춘다(왼쪽 이름 칸 + 주 눈금 + 막대). */
  function futurePng() {
    if (!PICKUPS.length) { alert('받아 둔 일정이 없습니다'); return; }
    const today = pd(todayStr());
    const off = [], rows = [];
    for (const p of PICKUPS) {
      const hit = alreadyOnSteam(p);
      if (hit && hit.start && p.start && hit.start !== p.start && isMech(p.name)) {
        off.push({ name: pickName(p.name), want: p.start, real: hit.start,
          days: Math.round((pd(p.start) - pd(hit.start)) / MS_DAY) });
      } else if (p.start && p.end) rows.push(p);
    }
    for (const m of missedFromHistory()) {
      off.push({ name: m.name, want: m.want, real: null, days: m.days });
    }
    if (!rows.length) { alert('그릴 일정이 없습니다'); return; }
    rows.sort((a, b) => pd(a.start) - pd(b.start));

    const months = byMonth(rows);

    // 달마다 주 수가 다르다 — 가장 긴 달에 폭을 맞춰 칸 너비를 통일한다.
    // 달마다 폭이 달라지면 같은 1주가 그림 안에서 서로 다른 길이로 보여 읽기가 어긋난다.
    const monthMeta = months.map(([key, list]) => {
      const [Y, M] = key.split('-').map(Number);
      const mEnd = new Date(Y, M, 0);
      const first = new Date(Y, M - 1, 1);
      while (first.getDay() !== 3) first.setDate(first.getDate() - 1);
      return { key, M, list, first, weeks: Math.max(1, Math.ceil((mEnd - first) / (7 * MS_DAY))) };
    });
    const maxWeeks = Math.max.apply(null, monthMeta.map(m => m.weeks));

    const S = 2;
    const LAB = 190, CW = 74, PAD = 22;
    const offH = off.length ? 24 + off.length * 24 + 14 : 0;
    const rowH = 30, footH = 34, mHeadH = 26, gridH = 24, mGap = 18;
    const W = PAD * 2 + LAB + CW * maxWeeks;
    let H = PAD + 30 + 30 + offH + footH + 8;
    for (const m of monthMeta) H += mHeadH + gridH + m.list.length * rowH + mGap;

    const cvs = document.createElement('canvas');
    cvs.width = W * S; cvs.height = H * S;
    const g = cvs.getContext('2d');
    g.scale(S, S);
    const css = getComputedStyle(document.documentElement);
    const v = (n, d) => (css.getPropertyValue(n) || '').trim() || d;
    const C = {
      bg: v('--bg', '#12141c'), panel2: v('--panel-2', '#262a38'),
      line: v('--line', '#47526a'), text: v('--text', '#f4f6fb'), muted: v('--muted', '#aab1c4'),
      dim: v('--dim', '#7b8499'), accent: v('--accent', '#ffc93c'),
      info: v('--info', '#63b0ff'), bad: v('--bad', '#ff6b6b')
    };
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    const F = 'system-ui, -apple-system, "Malgun Gothic", sans-serif';

    let y = PAD;
    g.fillStyle = C.text; g.font = '700 22px ' + F;
    g.fillText('미래시 — 콘솔 공지 +9주(약 2개월) 추정', PAD, y + 18);
    y += 30;
    g.fillStyle = C.muted; g.font = '13px ' + F;
    g.fillText('갱신 ' + (PICKUPS_UPDATED || '-') + ' · 오늘 ' + todayStr()
      + ' · 실제 출현은 달라질 수 있습니다', PAD, y + 12);
    y += 30;

    if (off.length) {
      const bh = 24 + off.length * 24;
      g.fillStyle = 'rgba(255,107,107,.12)'; g.fillRect(PAD, y, W - PAD * 2, bh);
      g.strokeStyle = C.bad; g.lineWidth = 1; g.strokeRect(PAD + .5, y + .5, W - PAD * 2 - 1, bh - 1);
      g.fillStyle = C.bad; g.font = '700 14px ' + F;
      g.fillText('⚠ 미래시에서 벗어난 기체 ' + off.length + '건', PAD + 10, y + 17);
      let oy = y + 38;
      for (const o of off) {
        g.fillStyle = C.text; g.font = '700 13px ' + F;
        g.fillText(o.name, PAD + 14, oy);
        g.fillStyle = C.muted; g.font = '12px ' + F;
        g.fillText(o.real ? ('예상 ' + o.want + ' → 실제 ' + o.real)
          : ('예상 ' + o.want + ' 이 지났는데 스팀에 안 나왔습니다'), PAD + 14 + 160, oy);
        g.fillStyle = C.bad; g.font = '700 12px ' + F;
        const t = !o.real ? (o.days + '일째 소식 없음')
          : (o.days > 0 ? o.days + '일 앞당겨짐' : (-o.days) + '일 밀림');
        g.fillText(t, W - PAD - 14 - g.measureText(t).width, oy);
        oy += 24;
      }
      y += bh + 14;
    }

    const x0 = PAD + LAB;
    for (const m of monthMeta) {
      // 달 머리
      g.fillStyle = C.accent; g.font = '700 15px ' + F;
      g.fillText(m.M + '월', PAD, y + 16);
      const mechN = m.list.filter(p => isMech(p.name)).length;
      g.fillStyle = C.dim; g.font = '12px ' + F;
      g.fillText(m.list.length + '건' + (mechN ? ' · 기체 ' + mechN : ''), PAD + 44, y + 16);
      y += mHeadH;

      // 주 눈금
      const gridTop = y;
      for (let w = 0; w < m.weeks; w++) {
        const d = new Date(+m.first + w * 7 * MS_DAY);
        const cx = x0 + w * CW + CW / 2;
        g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath();
        g.moveTo(x0 + w * CW + .5, gridTop + 2);
        g.lineTo(x0 + w * CW + .5, gridTop + gridH + m.list.length * rowH); g.stroke();
        g.fillStyle = C.dim; g.font = '11px ' + F;
        const lab = (d.getMonth() + 1) + '/' + d.getDate();
        g.fillText(lab, cx - g.measureText(lab).width / 2, gridTop + 15);
      }
      g.strokeStyle = C.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(PAD, gridTop + gridH - 3.5); g.lineTo(W - PAD, gridTop + gridH - 3.5); g.stroke();
      y = gridTop + gridH;

      // 오늘 선 (이 달에 오늘이 낀 경우만)
      const tx = x0 + (today - m.first) / (7 * MS_DAY) * CW;
      if (tx >= x0 && tx <= x0 + m.weeks * CW) {
        g.save(); g.strokeStyle = C.info; g.lineWidth = 2; g.setLineDash([5, 4]);
        g.beginPath(); g.moveTo(tx, gridTop + 2); g.lineTo(tx, y + m.list.length * rowH); g.stroke(); g.restore();
        g.fillStyle = C.info; g.font = '700 11px ' + F;
        g.fillText('오늘', tx + 4, gridTop - 2);
      }

      for (const p of m.list) {
        const a = (pd(p.start) - m.first) / (7 * MS_DAY), b = (pd(p.end) - m.first) / (7 * MS_DAY);
        const bx = x0 + Math.max(0, a) * CW;
        const bw = Math.max(CW, (b - Math.max(0, a)) * CW);
        const past = pd(p.end) < today;
        const mech = isMech(p.name);
        g.fillStyle = past ? C.dim : C.text;
        g.font = (mech && !past ? '700 ' : '') + '13px ' + F;
        let nm = pickName(p.name);
        while (g.measureText(nm).width > LAB - 12 && nm.length > 4) nm = nm.slice(0, -2) + '…';
        g.fillText(nm, PAD, y + 15);
        g.fillStyle = past ? C.panel2 : 'rgba(255,201,60,.18)';
        g.fillRect(bx, y + 2, bw, 20);
        g.strokeStyle = past ? C.line : C.accent; g.lineWidth = 1;
        g.strokeRect(bx + .5, y + 2.5, bw - 1, 19);
        if (p.tokens != null) {
          g.fillStyle = past ? C.dim : C.accent; g.font = '700 11px ' + F;
          const t = String(p.tokens);
          g.fillText(t, bx + bw - 7 - g.measureText(t).width, y + 16);
        }
        y += rowH;
      }
      y += mGap;
    }

    g.fillStyle = C.dim; g.font = '11px ' + F;
    g.fillText('GBO2 커스텀 파츠 시뮬레이터 · 토큰 계산기 — 콘솔 공지(bo2.ggame.jp) 기준 추정값입니다',
      PAD, H - 12);

    savePng(cvs, '미래시_' + todayStr() + '.png');
  }

  /* 캔버스를 파일로. 안드로이드 앱(WebView)은 blob 다운로드를 못 하므로 브리지로 넘긴다 —
     파츠 쪽 성능 카드와 같은 길이다. */
  function savePng(cvs, name) {
    if (window.AndroidBridge && typeof window.AndroidBridge.saveImage === 'function') {
      try { window.AndroidBridge.saveImage(cvs.toDataURL('image/png'), name); }
      catch (e) { alert('이미지 저장에 실패했습니다'); }
      return;
    }
    cvs.toBlob(blob => {
      if (!blob) { alert('이미지 생성에 실패했습니다'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  function renderPickups() {
    setUpdated('pickupUpdated', typeof PICKUPS_UPDATED === 'string' ? PICKUPS_UPDATED : '');
    const body = $('pickupList');
    if (!PICKUPS.length) { body.innerHTML = '<tr><td class="empty" colspan="4">등록된 픽업이 없습니다</td></tr>'; return; }
    body.innerHTML = PICKUPS.map((p, i) => {
      // url은 갱신된 저장본에만 있음 — 없으면 링크 없이 이름만 (구버전 데이터 호환)
      const safe = /^https?:\/\//.test(p.url || '') ? p.url : '';
      const nameCell = safe ? `<a href="${encodeURI(safe)}" target="_blank" rel="noopener noreferrer">${esc(pickName(p.name))}</a>` : esc(pickName(p.name));
      return `<tr>
      <td>${nameCell}</td>
      <td>${esc(p.start)} ~ ${esc(p.end)}${ddayBadge(p)}<div class="goal-eta">콘솔 개최 ${esc(p.consoleStart || '?')} · 추정</div></td>
      <td class="num">${(p.tokens != null) ? p.tokens : '-'}</td>
      <td><button class="btn" data-pk="${i}">목표로 추가</button></td>
    </tr>`;
    }).join('');
  }
  function renderSteamNews() {
    setUpdated('steamUpdated', typeof STEAM_NEWS_UPDATED === 'string' ? STEAM_NEWS_UPDATED : '');
    const body = $('steamNewsList'); if (!body) return;
    const news = (typeof STEAM_NEWS !== 'undefined' && STEAM_NEWS) || [];
    if (!news.length) { body.innerHTML = '<tr><td class="empty" colspan="3">불러온 픽업이 없습니다</td></tr>'; return; }
    body.innerHTML = news.map(s => {
      const safe = /^https?:\/\//.test(s.url || '') ? s.url : '#';
      const period = esc(s.start || '?') + (s.end ? ' ~ ' + esc(s.end) : '');
      return `<tr>
        <td><a href="${encodeURI(safe)}" target="_blank" rel="noopener noreferrer">${esc(pickName(s.name || s.title || ''))}</a></td>
        <td>${period}${ddayBadge(s)}</td>
        <td class="num">${(s.tokens != null) ? s.tokens : '-'}</td>
      </tr>`;
    }).join('');
  }
  // 다가오는 픽업을 각각 '단독 기준'으로 판정 (해당 픽업 시작일의 예상 보유 토큰 vs 필요 토큰, 다른 소모 미반영)
  function renderReach() {
    const body = $('reachBody'); if (!body) return;
    if (!currentDateInput.value || !currentTokenInput.value) {
      body.innerHTML = '<tr><td class="empty" colspan="4">현재 상태를 입력하면 표시됩니다</td></tr>'; return;
    }
    const today = pd(currentDateInput.value);
    const src = [];
    ((typeof PICKUPS !== 'undefined' && PICKUPS) || []).forEach(p => src.push({ name: pickName(p.name), start: p.start, tokens: p.tokens, from: '콘솔' }));
    ((typeof STEAM_NEWS !== 'undefined' && STEAM_NEWS) || []).forEach(s => src.push({ name: pickName(s.name), start: s.start, tokens: s.tokens, from: '스팀' }));
    const seen = {};
    const rows = src.filter(p => {
      if (p.tokens == null || !p.start) return false;
      const st = pd(p.start); if (isNaN(st) || st < today) return false;
      const k = p.from + '|' + p.name + '|' + p.start; if (seen[k]) return false; seen[k] = true;
      return true;
    }).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 20);
    if (!rows.length) { body.innerHTML = '<tr><td class="empty" colspan="4">다가오는 확정 토큰 픽업이 없습니다</td></tr>'; return; }
    body.innerHTML = rows.map(p => {
      const have = predictedTokensAt(pd(p.start));
      const proj = (have == null) ? 0 : have;
      const ok = proj >= p.tokens;
      const badge = ok ? '<span class="badge-ok">가능</span>' : `<span class="badge-no">${p.tokens - proj} 부족</span>`;
      return `<tr>
        <td>${esc(pickName(p.name))}<div class="goal-eta">${p.from} · 예상 ${proj}</div></td>
        <td>${esc(p.start)}${ddayBadge(p)}</td>
        <td class="num">${p.tokens}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');
  }
  // 역산기: 목표 날짜·필요 토큰 → 부족분을 금상자/미완료 임무로 환산 (현재 상태 기준, 목표 소모 미반영)
  function renderSolve() {
    const out = $('solveResult'); if (!out) return;
    const dv = $('solveDate').value, nv = $('solveNeed').value;
    if (!currentDateInput.value || currentTokenInput.value === '') { out.innerHTML = '<div class="goal-eta">현재 상태(오늘 날짜·현재 토큰)를 먼저 입력하세요</div>'; return; }
    if (!dv || nv === '') { out.innerHTML = ''; return; }
    const horizon = pd(dv), need = Number(nv), today = pd(currentDateInput.value);
    if (isNaN(horizon) || isNaN(need) || need <= 0 || isNaN(today)) { out.innerHTML = ''; return; }
    if (horizon < today) { out.innerHTML = '<div class="goal-eta">목표 날짜가 오늘보다 빠릅니다</div>'; return; }
    if ((horizon - today) / 86400000 + 1 > MAX_RANGE_DAYS) { out.innerHTML = '<div class="goal-eta">목표 날짜가 너무 멉니다 (최대 약 10년)</div>'; return; }
    const have = predictedTokensAt(horizon);
    const proj = (have == null) ? 0 : have;
    if (proj >= need) {
      const ad = predictAchieveDate(need, horizon);
      const eta = ad ? dkey(ad) : '-';
      out.innerHTML = '<div class="rec-box"><b>' + esc(dv) + '</b>까지 예상 <b>' + proj + '</b>토큰 · <span class="badge-ok">달성 가능</span>'
        + '<div class="rec-sub first">· 여유 <b>' + (proj - need) + '토큰</b></div>'
        + '<div class="rec-sub">· 도달 예상일 <b>' + eta + '</b></div></div>';
      return;
    }
    const short = need - proj;
    const gold = Math.ceil(short / 3);
    let rem = short; const picks = [];
    QUESTS.filter(q => !q.el.checked && q.tok > 0).sort((a, b) => b.tok - a.tok).forEach(q => {
      if (rem > 0) { picks.push(q.name + '(+' + q.tok + ')'); rem -= q.tok; }
    });
    const questText = picks.length ? picks.join(', ') + (rem > 0 ? ' 등' : '') : '없음(임무 모두 완료됨)';
    out.innerHTML = '<div class="rec-box"><b>' + esc(dv) + '</b>까지 예상 <b>' + proj + '</b>토큰 · <b class="rec-short">' + short + '토큰 부족</b>'
      + '<div class="rec-sub first">· 금상자 <b>' + gold + '개</b> 추가 획득</div>'
      + '<div class="rec-sub">· 또는 미완료 임무 완료: ' + questText + '</div></div>';
  }
  $('solveBtn').addEventListener('click', renderSolve);
  $('solveDate').addEventListener('input', renderSolve);
  $('solveNeed').addEventListener('input', renderSolve);

  $('pickupList').addEventListener('click', e => {
    const i = e.target.getAttribute('data-pk');
    if (i === null) return;
    const p = PICKUPS[+i];
    resetGoalForm();
    $('goalName').value = pickName(p.name);
    $('goalStart').value = p.start;
    $('goalEnd').value = p.end;
    // 토큰 미확정 픽업이면 비움 (이전 클릭 값이 남아 잘못 저장되는 것 방지)
    $('goalNeed').value = (p.tokens != null) ? p.tokens : '';
    $('goalNeed').focus();
    $('goalNeed').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  /* ---------- 토큰 수급 기록 ---------- */
  // 구버전의 '적립(banked)' 기록은 계산에 쓰이지 않던 이력 항목 — 적립 버튼 제거에 따라 로드 시 걸러낸다
  let logs = sanitizeList(store.get('tc_logs', []), LOG_KEYS).filter(l => !l.banked);
  function renderLogs() {
    calc();
    const body = $('logBody');
    if (!logs.length) { body.innerHTML = '<tr><td class="empty" colspan="5">기록이 없습니다</td></tr>'; return; }
    // 누적: 기록된 증감을 위에서부터 누적해 표시
    let running = 0;
    body.innerHTML = logs.map((l, i) => {
      const sign = Number(l.change) > 0 ? '+' + l.change : l.change;
        running += Number(l.change) || 0;
      const editBtn = `<button class="btn" data-li-edit="${i}">수정</button> `;
      return `<tr>
        <td>${esc(l.date || '-')}</td><td>${esc(l.desc)}</td>
        <td class="num">${esc(sign)}</td><td class="num">${running}</td>
        <td>${editBtn}<button class="btn danger" data-li="${i}">삭제</button></td>
      </tr>`;
    }).join('');
  }
  let logEditIdx = -1;
  function resetLogForm() {
    logEditIdx = -1;
    $('logDesc').value = $('logChange').value = '';
    $('logAdd').textContent = '기록 추가';
    $('logCancel').style.display = 'none';
  }
  $('logAdd').addEventListener('click', () => {
    const change = $('logChange').value;
    if (change === '') { alert('증감 값을 입력하세요'); return; }
    const obj = { date: $('logDate').value || todayStr(), desc: $('logDesc').value.trim(), change };
    if (logEditIdx >= 0 && logEditIdx < logs.length) logs[logEditIdx] = obj; else logs.push(obj);
    store.set('tc_logs', logs); resetLogForm(); renderLogs();
  });
  $('logCancel').addEventListener('click', resetLogForm);
  $('logBody').addEventListener('click', e => {
    const ei = e.target.getAttribute('data-li-edit');
    if (ei !== null) {
      const l = logs[+ei]; if (!l) return;
      $('logDate').value = l.date || ''; $('logDesc').value = l.desc || ''; $('logChange').value = l.change;
      logEditIdx = +ei;
      $('logAdd').textContent = '기록 저장';
      $('logCancel').style.display = '';
      $('logDate').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const i = e.target.getAttribute('data-li');
    if (i !== null && confirm('이 기록을 삭제할까요?')) {
      logs.splice(+i, 1); resetLogForm(); store.set('tc_logs', logs); renderLogs();
    }
  });

  /* ---------- 백금장 ---------- */
  // 주기 마지막 날 (1~10 / 11~20 / 21~말일)
  function periodEnd(d) {
    const day = d.getDate(), y = d.getFullYear(), m = d.getMonth();
    let endDay = day <= 10 ? 10 : day <= 20 ? 20 : new Date(y, m + 1, 0).getDate();
    return new Date(y, m, endDay);
  }
  // 한 주기 초과 토큰: 로그인 1회차 날(loginStart)부터 → 8회차(loginStart+7)부터 주기 끝(pend)까지
  function pushExcess(days, loginStart, pend) {
    const t = new Date(loginStart); t.setDate(loginStart.getDate() + 7);
    while (t <= pend) { days.push(new Date(t)); t.setDate(t.getDate() + 1); }
  }
  // 자동 생성: 첫 주기(달성 다음날부터 로그인) + 이후 주기(주기 첫날=로그인 1회차, 카운터 리셋), until까지
  function platinumAllTokenDays(dateStr, until) {
    if (!dateStr || !until) return [];
    const ach = pd(dateStr);
    if (isNaN(ach) || isNaN(until)) return [];
    const days = [];
    // 첫 주기: 로그인 시작 = 달성일 + 1
    let loginStart = new Date(ach); loginStart.setDate(ach.getDate() + 1);
    pushExcess(days, loginStart, periodEnd(loginStart));
    // 이후 주기: 각 주기 첫날(1·11·21일)이 로그인 1회차
    const pe0 = periodEnd(loginStart);
    let pStart = new Date(pe0); pStart.setDate(pe0.getDate() + 1);
    let guard = 0;
    while (guard++ < 500 && pStart <= until) {
      const pe = periodEnd(pStart);
      pushExcess(days, pStart, pe);
      pStart = new Date(pe); pStart.setDate(pe.getDate() + 1);
    }
    return days;
  }
  function periodLabel(dateStr) {
    const rs = pd(dateStr); rs.setDate(rs.getDate() + 1);
    const day = rs.getDate();
    return day <= 10 ? '1~10일' : day <= 20 ? '11~20일' : '21~말일';
  }
  // 현재 계산기 범위 기준 백금장 초과 토큰 개수
  function platCountInRange(dateStr) {
    if (!dateStr || !currentDateInput.value || !targetDateInput.value) return 0;
    const start = pd(currentDateInput.value), target = pd(targetDateInput.value);
    return platinumAllTokenDays(dateStr, target).filter(td => td >= start && td <= target).length;
  }

  let platinum = sanitizeList(store.get('tc_platinum', []), PLAT_KEYS);
  function renderPlatinum() {
    const body = $('platBody');
    if (!platinum.length) { body.innerHTML = '<tr><td class="empty" colspan="4">등록된 백금장이 없습니다</td></tr>'; return; }
    body.innerHTML = platinum.map((p, i) => `<tr>
      <td>${esc(p.date || '-')}</td><td>${p.date ? periodLabel(p.date) + ' 시작' : '-'}</td>
      <td class="num">+${platCountInRange(p.date)}</td>
      <td><button class="btn danger" data-pi="${i}">삭제</button></td>
    </tr>`).join('');
  }
  $('platAdd').addEventListener('click', () => {
    if (!$('platDate').value) { alert('달성일을 선택하세요'); return; }
    platinum.push({ date: $('platDate').value });
    store.set('tc_platinum', platinum); renderPlatinum(); calc();
    $('platDate').value = '';
  });
  $('platBody').addEventListener('click', e => {
    const i = e.target.getAttribute('data-pi');
    if (i !== null && confirm('이 백금장 달성일을 삭제할까요?')) { platinum.splice(+i, 1); store.set('tc_platinum', platinum); renderPlatinum(); calc(); }
  });

  /* ---------- 메모 ---------- */
  const memo = $('memo');
  memo.value = store.get('tc_memo', '');
  memo.addEventListener('input', () => store.set('tc_memo', memo.value));

  function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  /* 픽업 이름에는 원문 사이트의 HTML 이 섞여 들어온다 — 「건담 <ruby>DX<rt>더블 엑스</rt></ruby>」
     처럼. 그대로 esc 하면 태그가 글자로 보인다(실제로 그렇게 나오고 있었다).
     태그를 **살려서 그리지는 않는다** — 읽는 법(rt)까지 표에 끼면 줄이 길어지고, 무엇보다
     남의 사이트에서 온 마크업을 그대로 넣는 셈이다. 글자만 남기고 태그는 버린다. */
  function pickName(s) {
    return String(s || '')
      .replace(/<rt>[\s\S]*?<\/rt>/gi, '')   // 읽는 법은 버린다
      .replace(/<[^>]*>/g, '')                // 남은 태그도 버린다
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- 데이터 백업/복원 ---------- */
  $('exportBtn').addEventListener('click', () => {
    const data = { version: 1, exportedAt: new Date().toISOString(), goals, logs, platinum, memo: $('memo').value };
    const text = JSON.stringify(data, null, 2);
    const name = 'token_backup_' + todayStr() + '.json';
    // 안드로이드 앱(WebView)은 blob 다운로드를 못 한다 — 눌러도 조용히 아무 일도 없었다.
    // 하필 위의 저장 경고문이 바로 이 버튼을 쓰라고 안내하는 자리라 더 나빴다.
    if (window.AndroidBridge && typeof window.AndroidBridge.saveText === 'function') {
      try { window.AndroidBridge.saveText(text, name, 'application/json'); }
      catch (e) { alert('저장에 실패했습니다'); }
      return;
    }
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    // 바로 거두면 저장이 시작되기 전에 주소가 사라지는 브라우저가 있다(파츠 쪽도 같은 이유로 늦춘다).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('tkImportBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (typeof d !== 'object' || d === null) throw new Error('형식이 올바르지 않습니다');
        if (d.version && d.version > 1) {
          if (!confirm('이 백업은 더 최신 버전(' + d.version + ')입니다. 그래도 가져올까요?')) return;
        }
        if (!confirm('현재 목표·기록·백금장·메모를 이 파일 내용으로 덮어씁니다. 계속할까요?')) return;
        if (Array.isArray(d.goals)) { goals = sanitizeList(d.goals, GOAL_KEYS); store.set('tc_goals', goals); }
        if (Array.isArray(d.logs)) { logs = sanitizeList(d.logs, LOG_KEYS).filter(l => !l.banked); store.set('tc_logs', logs); }
        if (Array.isArray(d.platinum)) { platinum = sanitizeList(d.platinum, PLAT_KEYS); store.set('tc_platinum', platinum); }
        if (typeof d.memo === 'string') { $('memo').value = d.memo; store.set('tc_memo', d.memo); }
        renderGoals(); renderLogs(); renderPlatinum(); calc();
        alert('가져오기 완료');
      } catch (err) { alert('파일을 읽을 수 없습니다: ' + err.message); }
    };
    reader.readAsText(f);
    e.target.value = '';
  });

  /* ---------- 카드 접기/펼치기 ---------- */
  // 접힌 상태를 저장해 다음에 열어도 유지된다 (긴 픽업 표를 매번 다시 접지 않도록)
  let collapsed = store.get('tc_collapsed', {});
  if (!collapsed || typeof collapsed !== 'object' || Array.isArray(collapsed)) collapsed = {};
  document.querySelectorAll('.card.collapsible').forEach(card => {
    const ck = card.getAttribute('data-ck');
    const h = card.querySelector('h2');
    if (!ck || !h) return;
    if (collapsed[ck]) card.classList.add('collapsed');
    h.addEventListener('click', () => {
      collapsed[ck] = card.classList.toggle('collapsed');
      store.set('tc_collapsed', collapsed);
    });
  });

  const fpng = $('futurePng');
  // 이 버튼은 카드 머리줄(h2) 안에 있다. h2 는 접기 토글이라, 막지 않으면 저장하면서 접힌다.
  if (fpng) fpng.addEventListener('click', ev => { ev.stopPropagation(); futurePng(); });

  renderFuture();
  renderPickups();
  renderSteamNews();
  renderLogs();  // 내부의 calc() → renderDeps()가 목표·백금장도 함께 렌더 (중복 렌더 제거)
})();
