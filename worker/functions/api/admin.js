// POST /api/admin   관리자 로그인 → 서명 토큰
//
// 비밀번호는 서버에도 원문으로 두지 않는다. 시크릿에는 SHA-256 해시만 넣고,
// 들어온 값의 해시와 맞춰 본다. 앱·저장소 어디에도 비밀번호가 없다.
import { json, bad, CORS, sha256Hex, issueAdminToken } from '../lib/util.js';

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return bad('body', '본문을 읽지 못했습니다'); }
  const pw = String(b.password || '');
  if (!pw) return bad('pw', '비밀번호를 입력하세요');
  if (!env.ADMIN_PW_SHA256) return bad('cfg', '관리자 비밀번호가 설정돼 있지 않습니다', 500);
  // 틀린 비밀번호를 빠르게 되묻는 것을 늦춘다 — 무작위 대입을 조금이라도 비싸게
  await new Promise(r => setTimeout(r, 400));
  if ((await sha256Hex(pw)) !== env.ADMIN_PW_SHA256) return bad('pw', '비밀번호가 다릅니다', 401);
  return json({ ok: true, token: await issueAdminToken(env) });
}
