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
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
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
  return (await sha256Hex(ip + '|' + (env.WHO_SALT || 'gbo2'))).slice(0, 24);
}

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

/** 헤더의 Bearer 토큰이 우리가 서명한 것이고 아직 안 지났는가. */
export async function isAdmin(request, env) {
  const h = request.headers.get('Authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [expStr, sig] = t.split('.');
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  const want = await hmac(env, 'admin:' + exp);
  // 길이가 다르면 즉시 다르다 — 같은 길이일 때만 상수 시간 비교로 넘어간다
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/* ---------- 값 검증 ----------
 * rules.json 과 같은 범위. 앱에서도 한 번 걸러 주지만 그건 안내용이고,
 * 실제로 막는 것은 여기다. */
export const TITLE_RE  = /^[가-힣ㄱ-ㅎA-Za-z0-9 ·\-_.,!?()[\]]{1,20}$/;
export const AUTHOR_RE = /^[가-힣ㄱ-ㅎA-Za-z0-9 ._-]{1,12}$/;
export const DESC_RE   = /^[가-힣ㄱ-ㅎA-Za-z0-9 ·\-_.,!?()[\]/+~]{0,60}$/;
