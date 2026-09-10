/* ------------------------------------------------------------------
 * 공유 갤러리 — 통신 계층
 *
 * 이 파일 하나가 앱에서 **유일하게 네트워크를 쓰는 곳**이다.
 * 나머지는 예전 그대로 완전 오프라인으로 돈다 — 갤러리를 열거나 올릴 때만 여기가 불린다.
 * 그래서 규칙이 하나 있다: **여기서 나는 실패는 절대 앱을 멈추지 않는다.**
 * 모든 함수는 던지지 않고 { ok, ... } 를 돌려준다.
 *
 * 서버는 사이트와 같은 Cloudflare 다 — Pages Functions(worker/functions) + D1.
 * 예전에는 Firebase Realtime Database 였고 보안 규칙이 검사를 맡았다. 지금은 그 검사가
 * 서버 코드에 있다(worker/functions/api/builds.js 주석에 옛 규칙 항목을 짝지어 뒀다).
 *
 * 서버가 막아 주는 것
 *   · 1분에 1건 · 같은 구성 두 번 금지 · 기체·파츠·확장 이름을 사전과 대조
 *   · 제목·작성자·설명의 길이와 문자 범위 · 관리자 토큰 없이 삭제 금지
 * 그래서 여기서 보내는 값은 **서버가 다시 검사한다**. 클라이언트 검증은 사용자 안내용일 뿐이다.
 * 무과금 여부도 서버가 파츠 표로 직접 정한다 — 앱이 보내는 값은 아예 쓰이지 않는다.
 *
 * 외부 스크립트는 여전히 0개다(단일 HTML). 필요한 건 fetch 뿐이다.
 * ------------------------------------------------------------------ */
(function () {
'use strict';

const CFG = {
  // 사이트와 같은 Cloudflare — Pages Functions(worker/functions) + D1.
  // 절대 주소인 이유: 앱은 file:// 로도 열린다(APK·PC 완전판). 그때는 상대 경로에
  // 붙일 출처가 없다. 서버가 CORS 를 * 로 열어 두어 file:// 에서도 통한다.
  api: 'https://gbo2-parts.pages.dev/api',
  limit: 300,        // 목록에서 받아 올 최근 구성 수 (서버도 같은 값으로 자른다)
  timeout: 6000      // 오프라인에서 오래 매달리지 않게
};

const CACHE_KEY = 'gbo2-share-cache';


/** 타임아웃이 붙은 fetch. 네트워크가 없으면 빨리 포기한다. */
async function req(url, opt = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CFG.timeout);
  try {
    const r = await fetch(url, { ...opt, signal: ac.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 본문이 JSON 이 아닐 수 있다 */ }
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

const postJson = (path, body, headers = {}) => req(CFG.api + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body)
});

/* ---------- 신원 ----------
   예전에는 익명 로그인으로 uid 를 받아 '1분에 1건' 을 셌다. 지금은 서버가 요청 IP 를
   소금과 함께 해시해 쓴다 — 앱이 할 일이 없어졌고, uid 를 지우고 새로 받아 제한을
   피하던 구멍도 사라졌다. */

/* 구성 지문은 이제 서버가 만든다 — 같은 값을 두 곳에서 만들면 언젠가 어긋난다.
   중복 판정도 서버가 한다(같은 지문이면 거절). */

/* ---------- 올리기 ---------- */

/**
 * 구성 하나를 갤러리에 올린다.
 * @param {{ms:string, parts:string[], stage:number, expansion:string, expLevel:number}} bld
 * @param {string} title 사용자가 적은 제목
 * @returns {Promise<{ok:boolean, code?:string, msg:string}>}
 */
async function upload(bld, title, desc, author) {
  if (!bld || !bld.ms) return { ok: false, code: 'noms', msg: '먼저 기체를 선택하세요' };
  const parts = (bld.parts || []).filter(Boolean);
  // 파츠가 없는 구성은 공유할 내용이 없다. 서버 규칙도 p0 를 필수로 두어 이중으로 막는다.
  if (!parts.length) return { ok: false, code: 'parts', msg: '파츠를 하나 이상 장착한 뒤 올려 주세요' };
  if (parts.length > 8) return { ok: false, code: 'parts', msg: '파츠가 8개를 넘습니다' };
  if (!title || !title.trim()) return { ok: false, code: 'title', msg: '제목을 입력하세요' };
  const t = title.trim();
  if (t.length > 20) return { ok: false, code: 'title', msg: '제목은 20자까지입니다' };
  // 서버 규칙과 같은 문자 범위 — 여기서 걸러 주면 사용자가 이유를 바로 안다
  if (!/^[가-힣ㄱ-ㅎA-Za-z0-9 ·\-_.,!?()[\]]*$/.test(t))
    return { ok: false, code: 'title', msg: '제목에 쓸 수 없는 문자가 있습니다' };
  const a = (author || '').trim();
  // 작성자는 필수다 — 누가 올렸는지 없는 구성은 갤러리에서 물어볼 곳이 없다.
  if (!a) return { ok: false, code: 'author', msg: '작성자를 입력하세요' };
  // 서버 규칙과 같은 범위 — 여기서 걸러 주면 사용자가 이유를 바로 안다.
  // 이름은 제목보다 좁게 잡는다(괄호·문장부호로 남을 사칭하기 어렵게).
  if (a.length > 12) return { ok: false, code: 'author', msg: '이름은 12자까지입니다' };
  if (a && !/^[가-힣ㄱ-ㅎA-Za-z0-9 ._-]*$/.test(a))
    return { ok: false, code: 'author', msg: '이름에 쓸 수 없는 문자가 있습니다' };
  const d = (desc || '').trim();
  if (d.length > 60) return { ok: false, code: 'desc', msg: '설명은 60자까지입니다' };
  if (d && !/^[가-힣ㄱ-ㅎA-Za-z0-9 ·\-_.,!?()[\]/+~]*$/.test(d))
    return { ok: false, code: 'desc', msg: '설명에 쓸 수 없는 문자가 있습니다' };

  const B = window.GBO2_BUILD || {};
  const r = await postJson('/builds', {
    ms: bld.ms,
    stage: Number(bld.stage),
    exp: bld.expansion,
    expLv: Number(bld.expLevel) || 1,
    parts,
    title: t,
    author: a,
    desc: d,
    ver: B.stamp || B.date || ''
  });

  // 무과금 여부는 보내지 않는다 — 서버가 파츠 표로 직접 정한다.
  if (r.ok && r.json && r.json.ok) {
    return { ok: true, msg: r.json.free ? '갤러리에 올렸습니다 (무과금 구성)' : '갤러리에 올렸습니다' };
  }
  // 서버는 왜 거부했는지 항상 적어 보낸다 — 뭉뚱그리지 말고 그대로 전한다.
  if (r.json && r.json.msg) return { ok: false, code: r.json.code, msg: r.json.msg };
  return { ok: false, code: 'net', msg: '올리지 못했습니다 — 잠시 후 다시 시도하세요' };
}

/* ---------- 목록 ---------- */

/** 서버가 준 한 건을 앱이 쓰는 구성 모양으로 되돌린다.
 *  base64 공유 코드를 믿지 않고 **검증된 필드에서 다시 조립**하는 게 요점이다. */
function toBuild(v) {
  return {
    id: v.id,
    name: v.title || '(제목 없음)',
    ms: v.ms,
    parts: Array.isArray(v.parts) ? v.parts : [],
    stage: Number(v.stage),
    expansion: v.exp,
    expLevel: Number(v.expLv) || 1,
    desc: v.desc || '',
    author: v.author || '',
    free: v.free === true,
    at: Number(v.at) || 0,
    ver: v.ver || ''
  };
}

/**
 * 갤러리 목록. 실패하면 마지막으로 받아 둔 것을 돌려준다(오프라인에서도 열린다).
 * @returns {Promise<{ok:boolean, list:object[], cached:boolean, msg?:string}>}
 */
async function list() {
  // 차단 목록은 서버가 이미 걸러 준다 — 예전에는 blocked 노드를 따로 받아 앱이 걸렀다.
  const r = await req(CFG.api + '/builds');
  if (!r.ok || !r.json || !Array.isArray(r.json.builds)) {
    return { ok: false, list: readCache(), cached: true, msg: '목록을 받지 못했습니다' };
  }
  const out = r.json.builds.map(toBuild);
  out.sort((a, b) => b.at - a.at);            // 서버도 최신순이지만 여기서 다시 보장한다
  writeCache(out);
  return { ok: true, list: out, cached: false };
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch { return []; }
}
function writeCache(list) {
  // 캐시가 커지지 않게 앞쪽만 남긴다
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(0, CFG.limit))); } catch { /* 저장 실패는 무시 */ }
}

/* ---------- 관리자 ---------- */
// 비밀번호는 **앱에 들어가지 않는다.** 관리자가 직접 입력해 서버에 보내고, 서버는
// 시크릿에 든 해시와 맞춰 본 뒤 서명 토큰을 준다. 비밀번호는 로그인 순간 말고는
// 오가지 않는다. 그래서 이 파일이 공개돼도(단일 HTML 이라 어차피 다 보인다) 위험이 없다.

let admin = null;   // { token, at }

/** 관리자 로그인. 성공하면 그 세션 동안 삭제 버튼이 보인다(저장하지 않는다). */
async function adminLogin(password) {
  const r = await postJson('/admin', { password: password || '' });
  if (r.ok && r.json && r.json.ok && r.json.token) {
    admin = { token: r.json.token, at: Date.now() };
    return { ok: true, msg: '관리자로 로그인했습니다' };
  }
  if (r.json && r.json.msg) return { ok: false, msg: r.json.msg };
  return { ok: false, msg: '로그인하지 못했습니다' };
}

function adminLogout() { admin = null; }
// 서버 토큰은 12시간짜리지만 앱에서는 더 짧게 잡는다 — 자리를 비운 사이 남이
// 삭제 버튼을 누르는 일이 없게.
const isAdmin = () => !!(admin && Date.now() - admin.at < 50 * 60 * 1000);

/** 구성 하나 삭제 (관리자만). 서버가 토큰 서명을 다시 확인한다. */
async function remove(id) {
  if (!isAdmin()) return { ok: false, msg: '관리자만 지울 수 있습니다' };
  const r = await req(CFG.api + '/builds/' + encodeURIComponent(id), {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + admin.token }
  });
  return (r.ok && r.json && r.json.ok)
    ? { ok: true, msg: '삭제했습니다' }
    : { ok: false, msg: (r.json && r.json.msg) || '삭제하지 못했습니다' };
}

/* ---------- 업데이트 확인 (PC) ---------- */
// APK 는 네이티브가 직접 확인한다(AndroidBridge.checkUpdate). 여기는 PC 전용이다.
// 배포 자산이 있는 releases/download 는 file:// 에서 CORS 로 막히지만,
// GitHub API 는 통과한다 — 자산의 갱신 시각으로 새 버전 여부를 안다.
const RELEASE_API = 'https://api.github.com/repos/BaBoHoGu/gbo2_parts_simulator/releases/tags/data';

const STAMP_RE = /\d{4}-\d{2}-\d{2}-\d{4}/;

async function checkUpdate() {
  const B = window.GBO2_BUILD || {};
  const r = await req(RELEASE_API);
  if (!r.ok || !r.json) return { ok: false, msg: '업데이트 정보를 받지 못했습니다 — 연결을 확인하세요' };

  // ① 분 단위 스탬프끼리 비교한다(권장 경로). 배포가 릴리스 노트에 남긴 값이다.
  //    같은 날 두 번 배포해도 잡힌다 — 날짜만 비교하던 시절엔 못 잡았다.
  const remote = (String(r.json.body || '').match(STAMP_RE) || [])[0];
  if (remote && B.stamp) {
    // yyyy-MM-dd-HHmm 은 자리수가 고정이라 사전식 비교가 곧 시각 비교
    return { ok: true, newer: remote > B.stamp, latest: remote, mine: B.stamp };
  }

  // ② 예전 빌드(스탬프가 없다)이거나 노트가 비어 있으면 날짜까지만 비교한다.
  //    이때는 같은 날 재배포를 알 수 없다 — 그래도 '모르는 것보다는 낫다'.
  const mine = B.date || '';
  const asset = (r.json.assets || []).find(a => a.name === 'gbo2-simulator.html');
  const latest = asset ? String(asset.updated_at || '').slice(0, 10) : (remote || '').slice(0, 10);
  if (!latest) return { ok: false, msg: '업데이트 정보를 읽지 못했습니다' };
  return { ok: true, newer: !!(mine && latest > mine), latest, mine };
}

window.GBO2Share = { upload, list, readCache, CFG, adminLogin, adminLogout, isAdmin, remove, checkUpdate };

})();
