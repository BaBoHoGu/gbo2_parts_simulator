// 갤러리 API 공용 — 응답·검증·신원·서명.
//
// 예전 Firebase 보안 규칙이 하던 일을 그대로 옮긴 것이다(규칙 파일은 이관하며 지웠다).
// 규칙은 선언형이라 빠뜨리기 어려웠는데 여기는 코드라, **검사 하나를 지우면
// 조용히 열린다**. 그래서 규칙에 있던 항목을 주석으로 짝지어 둔다.

/** 앱은 file:// 로도 열린다(APK·PC 완전판) — 그때 Origin 은 "null" 이다.
 *  자격 증명을 쓰지 않으므로 * 로 열어도 남의 세션을 훔칠 통로가 생기지 않는다. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-GBO2-Device',
  'Access-Control-Max-Age': '86400'
};

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });

export const bad = (code, msg, status = 400) => json({ ok: false, code, msg }, status);

/* ---------- 신원 ----------
 * Firebase 는 익명 로그인으로 uid 를 줬다. 여기서는 요청 IP 를 소금과 함께 해시해 쓴다.
 *   · 원본 IP 는 저장하지 않는다(해시만 남긴다).
 *   · 속도 제한과 차단에만 쓰고, 화면에는 절대 안 나온다.
 * 익명 uid 보다 오히려 낫다 — uid 는 지우고 새로 받으면 제한을 우회할 수 있었다. */
export async function whoOf(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  // 여기서는 기본 소금을 허용한다 — 이 값은 속도 제한을 세는 데만 쓰고, 알아내도
  // 남의 것을 지우거나 볼 수 없다. 비밀번호 해시(pwHashOf)는 그렇지 않아 거부한다.
  return (await sha256Hex(ip + '|' + (env.WHO_SALT || 'gbo2'))).slice(0, 24);
}

/* ---------- 기기 ----------
 * 투표 한도는 **기기별**이다(사용자 결정). IP 해시(whoOf)로는 셀 수 없다 —
 * 한 집·한 통신사가 한 사람으로 뭉뚱그려지고, 폰은 IP 가 수시로 바뀐다.
 * 그래서 앱이 만들어 저장한 임의의 id 를 헤더로 받아 소금과 함께 해시해 쓴다.
 *
 * 한계를 분명히 해 둔다: **브라우저 저장소를 지우면 한도가 초기화된다.**
 * 로그인이 없는 한 완전히 막을 수는 없다. 대신 표마다 IP 해시(who)도 같이
 * 남겨 두어, 남용이 생기면 나중에 IP 단위 상한을 덧붙일 수 있게 했다.
 */
export async function devOf(request, env) {
  const raw = String(request.headers.get('X-GBO2-Device') || '').trim();
  // 형식이 어긋나면 기기 없음으로 본다 — 아무 값이나 받아 주면 한도가 뜻을 잃는다.
  if (!/^[a-zA-Z0-9_-]{16,64}$/.test(raw)) return null;
  return (await sha256Hex(raw + '|dev|' + (env.WHO_SALT || 'gbo2'))).slice(0, 24);
}

/** 한국 시각 기준의 '오늘' 번호. 하루 한도를 자정(KST)에 되돌리려고 쓴다. */
export const dayOf = (ms = Date.now()) => Math.floor((ms + 9 * 3600e3) / 86400e3);

/**
 * 화면에 적을 IP 앞자리 — IPv4 는 「220.80」, IPv6 는 「2001:2d8」.
 *
 * 국내 게시판이 흔히 쓰는 표기다. 전체를 적지 않는 이유는 뻔하다 — 앞 두 마디만으로는
 * 사람을 특정할 수 없고(통신사·지역 수준), 같은 사람이 이름만 바꿔 가며 쓰는 것은 드러난다.
 * 이 값만 저장하고 **원본 IP 는 어디에도 남기지 않는다**(속도 제한용 해시는 별도).
 */
export function ipHeadOf(request) {
  const ip = (request.headers.get('CF-Connecting-IP') || '').trim();
  if (!ip) return null;
  if (ip.includes(':')) {                       // IPv6 — 앞 두 마디
    const seg = ip.split(':').filter(Boolean).slice(0, 2);
    return seg.length ? seg.join(':') : null;
  }
  const seg = ip.split('.');
  return seg.length === 4 ? seg[0] + '.' + seg[1] : null;
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- 관리자 세션 ----------
 * 비밀번호는 서버에도 원문으로 두지 않는다 — 해시만 시크릿에 넣고 대조한다.
 * 통과하면 만료가 박힌 서명 토큰을 준다(HMAC-SHA256). 토큰만으로 삭제가 되고,
 * 비밀번호는 로그인 순간 말고는 오가지 않는다. */
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SIGN_KEY || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

export async function issueAdminToken(env, ttlMs = 12 * 3600 * 1000) {
  const exp = Date.now() + ttlMs;
  return `${exp}.${await hmac(env, 'admin:' + exp)}`;
}

/** 헤더의 Bearer 토큰이 우리가 서명한 것이고 아직 안 지났는가.
 *
 *  **던지지 않는다.** 시크릿이 안 걸린 환경에서는 importKey 가 「HMAC key length (0)」
 *  로 터지는데, 그러면 이 함수를 부르는 요청이 통째로 500 이 됐다. 관리자 삭제만이
 *  아니라 **비밀번호로 지우는 일반 사용자까지** 같이 죽는다(그 길도 여기를 먼저 지난다).
 *  권한이 없으면 없다고 답하는 것이 맞지, 요청을 죽일 일이 아니다. */
export async function isAdmin(request, env) {
  if (!env.SIGN_KEY) return false;        // 시크릿이 없으면 관리자도 없다
  const h = request.headers.get('Authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [expStr, sig] = t.split('.');
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  let want;
  try { want = await hmac(env, 'admin:' + exp); }
  catch (e) { return false; }
  return sameSecret(want, sig);
}

/* ---------- 값 검증 ----------
 * rules.json 과 같은 범위. 앱에서도 한 번 걸러 주지만 그건 안내용이고,
 * 실제로 막는 것은 여기다. */
/* ---------- 올린 사람의 비밀번호 ----------
 * 관리자 비밀번호와 **아무 관계가 없다**. 이건 「내가 올린 글을 내가 내린다」는
 * 게시판의 그 비밀번호다 — 짧고, 구성 하나에만 걸리고, 잊어도 관리자가 지워 준다.
 *
 * 왜 해시를 한 번만 도는가(PBKDF2 가 아니라):
 *   · 소금이 우리 시크릿(WHO_SALT)이라 표가 통째로 새도 밖에서는 미리 계산할 수 없다.
 *   · 구성 id 를 같이 섞어 같은 비밀번호라도 구성마다 다른 값이 된다.
 *   · 온라인으로 눌러 보는 것은 pwtry 로 막는다(10분에 5번).
 *   · 워커의 CPU 시간이 짧아 수만 번 도는 유도는 삭제 한 번을 통째로 실패시킨다.
 * 지키는 대상이 「남의 글을 못 지우게」이지 계정이 아니라서 이 정도가 맞다. */
export const PW_RE = /^\S{4,20}$/;

/** 시크릿이 없으면 **조용히 약한 값으로 내려앉지 않는다.**
 *  위 주석의 약속("밖에서는 미리 계산할 수 없다")은 소금이 시크릿일 때만 참이다.
 *  기본값으로 넘어가면 소금이 이 공개 저장소에 적힌 글자가 되어, 4자짜리 비밀번호는
 *  표가 새는 순간 전부 풀린다. isAdmin 이 SIGN_KEY 없으면 관리자를 거부하는 것과 같은 규칙이다. */
export class ConfigMissing extends Error {
  constructor(name) { super('서버 설정이 빠졌습니다: ' + name); this.name = 'ConfigMissing'; this.key = name; }
}

export async function pwHashOf(env, id, pw) {
  if (!env.WHO_SALT) throw new ConfigMissing('WHO_SALT');
  return (await sha256Hex(pw + '|pw|' + id + '|' + env.WHO_SALT)).slice(0, 32);
}

/** 설정이 빠졌을 때 500 대신 **무엇이 빠졌는지** 답한다. 조용히 도는 것보다 낫다. */
export const configBad = e =>
  bad('cfg', '서버 설정이 끝나지 않았습니다 (' + (e.key || '?') + ') — 관리자에게 알려 주세요', 503);

/** 길이가 같을 때만 상수 시간으로 비교한다(관리자 토큰과 같은 방식). */
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const TITLE_RE  = /^[가-힣ㄱ-ㅎA-Za-z0-9 ·\-_.,!?()[\]]{1,20}$/;
export const AUTHOR_RE = /^[가-힣ㄱ-ㅎA-Za-z0-9 ._-]{1,12}$/;
export const DESC_RE   = /^[가-힣ㄱ-ㅎA-Za-z0-9 ·\-_.,!?()[\]/+~]{0,60}$/;
