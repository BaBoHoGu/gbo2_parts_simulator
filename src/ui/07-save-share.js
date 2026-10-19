  /* ui/07-save-share.js — 저장 · 불러오기 · 공유 코드 · 저장한 구성 · 공유 갤러리.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 저장 / 불러오기 ---------- */

  const serialize = () => ({
    ms: state.ms ? state.ms.MS名 : null,
    parts: state.equipped.map(p => p.name),
    stage: state.stage,
    expansion: state.expansion,
    expLevel: state.expLevel
  });

  /* ---------- 공유 코드 (짧은 문자열로 인코딩) ---------- */
  // 유니코드(한글·일본어 파츠명) 안전 base64url. 붙여넣기 쉽게 한 줄 토큰으로 만든다.
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }
  const SHARE_PREFIX = 'GBO2-';
  /** 현재(또는 주어진) 구성을 짧은 공유 코드로 만든다. */
  function encodeShare(obj) {
    const o = obj || serialize();
    // 짧은 키로 압축: m=기체, p=파츠, s=강화, e=확장, l=확장레벨
    const compact = { m: o.ms, p: o.parts, s: o.stage, e: o.expansion, l: o.expLevel };
    return SHARE_PREFIX + b64urlEncode(JSON.stringify(compact));
  }
  /** 공유 코드 또는 예전 JSON을 구성 객체(serialize 형태)로 되돌린다. 실패 시 null. */
  function decodeShare(text) {
    const t = (text || '').trim();
    if (!t) return null;
    // 예전 JSON 형식도 그대로 받는다 (하위 호환)
    // 모양을 먼저 본다 — 예전엔 그대로 넘겨 `"parts":5` 같은 것이 불러오기에서 예외를 냈다(2026-10-19)
    if (t[0] === '{') {
      try {
        const o = JSON.parse(t);
        if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.ms !== 'string') return null;
        return { ...o, parts: Array.isArray(o.parts) ? o.parts : [] };
      } catch { return null; }
    }
    const code = t.startsWith(SHARE_PREFIX) ? t.slice(SHARE_PREFIX.length) : t;
    try {
      const c = JSON.parse(b64urlDecode(code));
      // 숫자·문자열·null 도 올바른 JSON 이다 — 그때 c.m 은 undefined 라
      // 「기체 없는 구성」이 조용히 만들어진다. 모양을 먼저 본다.
      if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.m !== 'string') return null;
      return { ms: c.m, parts: Array.isArray(c.p) ? c.p : [], stage: c.s, expansion: c.e, expLevel: c.l };
    } catch { return null; }
  }

  /* ---------- 저장한 구성(이름 지정·다중) ---------- */

  const BUILDS_KEY = 'gbo2-offline-builds';
  // 시간이 같아도 겹치지 않는 고유 id (Date.now() 만 쓰면 연속 저장 시 충돌해 삭제가 꼬인다)
  const uid = () => Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  function loadBuilds() {
    let list;
    try { list = JSON.parse(localStorage.getItem(BUILDS_KEY)) || []; } catch { list = []; }
    // 예전 단일 저장 슬롯이 남아 있으면 "한 번만" 목록으로 옮기고 슬롯을 지운다.
    // (지우지 않으면 목록을 비울 때마다 되살아나 삭제되지 않는다)
    let legacy = null;
    try { legacy = localStorage.getItem(SAVE_KEY); } catch { /* 무시 */ }
    if (legacy != null) {
      try { const o = JSON.parse(legacy); if (o && o.ms) list.push({ id: uid(), name: '이전 저장', ...o, ts: Date.now() }); } catch { /* 손상된 슬롯도 아래서 제거 */ }
      try { localStorage.removeItem(SAVE_KEY); } catch { /* 무시 */ }
      writeBuilds(list);
    }
    return list;
  }
  function writeBuilds(list) {
    try { localStorage.setItem(BUILDS_KEY, JSON.stringify(list)); return true; } catch { return false; }
  }

  const expShort = e => (C.EXPANSION_LABEL[e] || e).replace(/\s*\(.*\)$/, '');

  /** 현재 구성을 이름을 지정해 목록에 저장한다. */
  function saveCurrentBuild() {
    if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
    const name = (prompt('구성 이름을 지정하세요', T.msName(state.ms.MS名) + ' 구성') || '').trim();
    if (!name) return;
    const list = loadBuilds();
    // 주무장 LV 는 **내 저장 목록에만** 싣는다. serialize() 는 공유·갤러리도 함께 쓰는데,
    // 남이 올린 구성을 내가 보던 LV 로 그리면 위력도 레벨링크 보너스도 그 구성의 값이
    // 아니게 된다(deserialize 가 그래서 null 로 되돌린다). 반대로 **내가 맞춰 저장한 것**은
    // 그대로 돌아와야 한다 — 저장한 구성이 불러오면 달라지는 것도 조용한 어긋남이다.
    list.unshift({ id: uid(), name, ...serialize(), weaponLv: state.weaponLv, ts: Date.now() });
    if (!writeBuilds(list)) { toast('저장에 실패했습니다 (브라우저 저장 공간 제한)'); return; }
    toast('「' + name + '」 저장했습니다');
  }

  /* ---------- 공유 갤러리 ---------- */
  // 다른 사람이 올린 구성을 둘러보고 그대로 가져온다.
  // 통신은 전부 share.js 가 맡고, 여기서는 화면만 그린다.
  // 서버가 올라온 값을 이미 검증하지만(기체·파츠 이름 화이트리스트), 그래도 여기서
  // deserialize 가 장착 규칙을 다시 검사한다 — 내 강화 단계에서 안 맞는 파츠는 빠진다.

  const S = window.GBO2Share;
  let galleryList = [];      // 서버(또는 캐시)에서 받아 둔 목록
  let gallerySort = 'new';   // 'new' 최신순 | 'ms' 기체순 | 'vote' 추천순
  let galleryAttr = '';      // '' 전체 | 強襲 | 汎用 | 支援
  // 기체 선택 화면과 같은 축으로 거른다 — 갤러리가 커지면 이게 없으면 못 찾는다
  let galleryCost = 'all';   // 'all' | 750… | 'low'(≤250)
  let galleryLv = 'all';     // 'all' | 1 | 2 | 3 | '4+'
  let galleryRarity = 'all'; // 'all' | 1~5
  let galleryFree = 'all';   // 'all' | 'free'(무과금 구성만)
  let galleryStage = 'all';  // 'all' | 0 미강화 | 4 4단계 | 6 풀강
  let galleryLoading = false;

  const relTime = ms => {
    if (!ms) return '';
    const d = Math.floor((Date.now() - ms) / 60000);
    if (d < 1) return '방금';
    if (d < 60) return d + '분 전';
    if (d < 1440) return Math.floor(d / 60) + '시간 전';
    return Math.floor(d / 1440) + '일 전';
  };

