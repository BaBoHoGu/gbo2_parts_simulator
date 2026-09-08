/* ------------------------------------------------------------------
 * 공유 갤러리 — 통신 계층
 *
 * 이 파일 하나가 앱에서 **유일하게 네트워크를 쓰는 곳**이다.
 * 나머지는 예전 그대로 완전 오프라인으로 돈다 — 갤러리를 열거나 올릴 때만 여기가 불린다.
 * 그래서 규칙이 하나 있다: **여기서 나는 실패는 절대 앱을 멈추지 않는다.**
 * 모든 함수는 던지지 않고 { ok, ... } 를 돌려준다.
 *
 * 왜 Firebase SDK 를 안 쓰나
 *   이 앱은 모든 것을 인라인한 단일 HTML 이라 외부 스크립트가 0개다. SDK 를 CDN 으로
 *   불러오면 오프라인에서 앱이 안 뜨고, 번들하면 파일만 커진다. 실제로 필요한 건
 *   HTTP 요청 두 종류뿐이라 fetch 로 충분하다.
 *
 * 서버가 막아 주는 것(보안 규칙)은 firebase/rules.json 참고. 요약하면
 *   · 익명 로그인 필수 · 1분에 1건 · 새 글만(수정·삭제 불가)
 *   · 기체·파츠·확장 이름을 서버 사전과 대조 · 정의 안 한 필드 금지
 * 그래서 여기서 보내는 값은 **서버가 다시 검사한다**. 클라이언트 검증은 사용자 안내용일 뿐이다.
 * ------------------------------------------------------------------ */
(function () {
'use strict';

const CFG = {
  db: 'https://gbo2-parts-share-default-rtdb.asia-southeast1.firebasedatabase.app',
  key: 'AIzaSyDR86iaIqH_y9jweHzCwD1sGZGwf35T33o',
  limit: 300,        // 목록에서 받아 올 최근 구성 수
  timeout: 6000      // 오프라인에서 오래 매달리지 않게
};
// apiKey 는 비밀이 아니다 — 프로젝트를 가리키는 식별자이고, 보호는 전적으로 보안 규칙이 한다.
// (구글 공식 문서도 클라이언트에 넣도록 안내한다)

const CACHE_KEY = 'gbo2-share-cache';

/** RTDB 키에 못 쓰는 글자를 바꾼다. tools/make_share_dict.js 와 **반드시 같은 규칙**. */
const toKey = n => String(n).replace(/\[/g, '(').replace(/\]/g, ')');
const fromKey = n => String(n).replace(/\(/g, '[').replace(/\)/g, ']');

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

/* ---------- 익명 로그인 ---------- */
// 사용자에게는 아무것도 안 보인다. 계정도, 로그인 화면도 없다.
// uid 는 오직 '1분에 1건' 제한과 신고 처리용이다.

let auth = null;   // { token, uid, at }

async function signIn() {
  // 토큰은 1시간 유효 — 50분이 지났으면 새로 받는다
  if (auth && Date.now() - auth.at < 50 * 60 * 1000) return auth;
  const r = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CFG.key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true })
  });
  if (!r.ok || !r.json || !r.json.idToken) return null;
  auth = { token: r.json.idToken, uid: r.json.localId, at: Date.now() };
  return auth;
}

/* ---------- 구성 지문 ---------- */

/**
 * 같은 조합이면 같은 키가 나오도록 만든 지문. 이게 곧 DB 키라서,
 * 같은 구성을 두 번 올리면 **서버가 키 충돌로 거절**한다(중복 방지가 공짜로 따라온다).
 * 파츠는 순서를 타지 않게 정렬해서 넣는다.
 * 32비트 하나로는 몇 천 건에서 충돌이 날 수 있어 두 개를 이어 붙여 64비트로 쓴다.
 */
function fingerprint(b) {
  const src = [b.ms, b.stage, b.exp, b.expLv, ...(b.parts || []).slice().sort()].join('|');
  const h = (seed, prime) => {
    let x = seed;
    for (let i = 0; i < src.length; i++) { x ^= src.charCodeAt(i); x = Math.imul(x, prime) >>> 0; }
    return ('00000000' + x.toString(16)).slice(-8);
  };
  return h(0x811c9dc5, 0x01000193) + h(0x7fffffff, 0x85ebca6b);
}

/* ---------- 올리기 ---------- */

/**
 * 구성 하나를 갤러리에 올린다.
 * @param {{ms:string, parts:string[], stage:number, expansion:string, expLevel:number}} bld
 * @param {string} title 사용자가 적은 제목
 * @returns {Promise<{ok:boolean, code?:string, msg:string}>}
 */
async function upload(bld, title, desc) {
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
  const d = (desc || '').trim();
  if (d.length > 60) return { ok: false, code: 'desc', msg: '설명은 60자까지입니다' };
  if (d && !/^[가-힣ㄱ-ㅎA-Za-z0-9 ·\-_.,!?()[\]/+~]*$/.test(d))
    return { ok: false, code: 'desc', msg: '설명에 쓸 수 없는 문자가 있습니다' };

  const u = await signIn();
  if (!u) return { ok: false, code: 'net', msg: '연결하지 못했습니다 — 잠시 후 다시 시도하세요' };

  // ① 속도 제한 노드를 먼저 찍는다. 60초가 안 지났으면 여기서 거부된다.
  const th = await req(`${CFG.db}/throttle/${u.uid}.json?auth=${u.token}`,
    { method: 'PUT', body: JSON.stringify({ '.sv': 'timestamp' }) });
  if (!th.ok) {
    return th.status === 401
      ? { ok: false, code: 'rate', msg: '너무 빠릅니다 — 1분에 한 번만 올릴 수 있습니다' }
      : { ok: false, code: 'net', msg: '연결하지 못했습니다' };
  }

  // ② 본문. 파츠는 p0~p7 고정 칸에 넣는다(서버 규칙이 칸 수로 8개 상한을 만든다).
  const body = {
    ms: toKey(bld.ms),
    stage: Number(bld.stage),
    exp: toKey(bld.expansion),
    expLv: Number(bld.expLevel) || 1,
    title: t,
    at: { '.sv': 'timestamp' },      // 서버 시각 — 규칙이 위조를 막는다
    uid: u.uid,
    ver: (window.GBO2_BUILD && window.GBO2_BUILD.date) || ''
  };
  if (d) body.desc = d;   // 비어 있으면 아예 안 보낸다(규칙이 정의 안 한 필드를 막으므로 null 도 안 된다)
  parts.forEach((n, i) => { body['p' + i] = toKey(n); });

  const fp = fingerprint({ ms: bld.ms, stage: bld.stage, exp: bld.expansion, expLv: bld.expLevel, parts });
  const r = await req(`${CFG.db}/builds/${fp}.json?auth=${u.token}`,
    { method: 'PUT', body: JSON.stringify(body) });
  if (r.ok) return { ok: true, msg: '갤러리에 올렸습니다' };
  if (r.status === 401) {
    // 규칙이 거부한 것 — 가장 흔한 이유가 '이미 같은 구성이 있음' 이다.
    return { ok: false, code: 'dup', msg: '이미 같은 구성이 올라와 있거나, 올릴 수 없는 구성입니다' };
  }
  return { ok: false, code: 'net', msg: '올리지 못했습니다 — 잠시 후 다시 시도하세요' };
}

/* ---------- 목록 ---------- */

/** 서버가 준 한 건을 앱이 쓰는 구성 모양으로 되돌린다.
 *  base64 공유 코드를 믿지 않고 **검증된 필드에서 다시 조립**하는 게 요점이다. */
function toBuild(id, v) {
  const parts = [];
  for (let i = 0; i < 8; i++) if (v['p' + i]) parts.push(fromKey(v['p' + i]));
  return {
    id,
    name: v.title || '(제목 없음)',
    ms: fromKey(v.ms),
    parts,
    stage: Number(v.stage),
    expansion: fromKey(v.exp),
    expLevel: Number(v.expLv) || 1,
    desc: v.desc || '',
    at: Number(v.at) || 0,
    ver: v.ver || '',
    uid: v.uid || ''
  };
}

/**
 * 갤러리 목록. 실패하면 마지막으로 받아 둔 것을 돌려준다(오프라인에서도 열린다).
 * @returns {Promise<{ok:boolean, list:object[], cached:boolean, msg?:string}>}
 */
async function list() {
  const q = `orderBy=${encodeURIComponent('"at"')}&limitToLast=${CFG.limit}`;
  const [r, bl] = await Promise.all([
    req(`${CFG.db}/builds.json?${q}`),
    req(`${CFG.db}/blocked.json`)
  ]);
  if (!r.ok || r.json === undefined) {
    const c = readCache();
    return { ok: false, list: c, cached: true, msg: '목록을 받지 못했습니다' };
  }
  const blocked = (bl.ok && bl.json) ? bl.json : {};
  const out = [];
  for (const [id, v] of Object.entries(r.json || {})) {
    if (!v || blocked[id]) continue;          // 신고로 숨긴 글은 뺀다
    out.push(toBuild(id, v));
  }
  out.sort((a, b) => b.at - a.at);            // 최신순
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
// 비밀번호는 **앱에 들어가지 않는다.** 관리자가 직접 입력해 Firebase 에 로그인하고,
// 규칙은 그 결과로 나온 uid 가 admins/ 에 있는지만 본다.
// 그래서 이 파일이 공개돼도(단일 HTML 이라 어차피 다 보인다) 아무 위험이 없다.

let admin = null;   // { token, uid, email, at }

/** 관리자 로그인. 성공하면 그 세션 동안 삭제 버튼이 보인다(저장하지 않는다). */
async function adminLogin(email, password) {
  const r = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CFG.key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  if (!r.ok || !r.json || !r.json.idToken) return { ok: false, msg: '로그인하지 못했습니다' };
  const cand = { token: r.json.idToken, uid: r.json.localId, email, at: Date.now() };
  // 로그인은 됐지만 관리자로 등록된 계정인지 확인한다(admins 는 공개 읽기).
  // 값의 타입은 따지지 않는다 — 콘솔에서 true(불리언)로 넣든 "true"(문자열)로 넣든 통과해야 한다.
  // 서버 규칙도 exists() 라 타입을 안 본다. 여기서만 엄격하면 사람이 콘솔에서 실수했을 때
  // 「관리자가 아닙니다」 라는 엉뚱한 이유로 막힌다.
  const a = await req(`${CFG.db}/admins/${cand.uid}.json`);
  if (!a.ok || a.json === null || a.json === undefined || a.json === false)
    return { ok: false, msg: '이 계정은 관리자가 아닙니다' };
  admin = cand;
  return { ok: true, msg: '관리자로 로그인했습니다' };
}

function adminLogout() { admin = null; }
const isAdmin = () => !!(admin && Date.now() - admin.at < 50 * 60 * 1000);

/** 구성 하나 삭제 (관리자만). 규칙이 admins 목록으로 다시 확인한다. */
async function remove(id) {
  if (!isAdmin()) return { ok: false, msg: '관리자만 지울 수 있습니다' };
  const r = await req(`${CFG.db}/builds/${id}.json?auth=${admin.token}`, { method: 'DELETE' });
  return r.ok ? { ok: true, msg: '삭제했습니다' } : { ok: false, msg: '삭제하지 못했습니다' };
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

window.GBO2Share = { upload, list, fingerprint, readCache, CFG, adminLogin, adminLogout, isAdmin, remove, checkUpdate };

})();
