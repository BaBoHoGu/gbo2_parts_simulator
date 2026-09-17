// POST /api/admin   관리자 로그인 → 서명 토큰
//
// 비밀번호는 서버에도 원문으로 두지 않는다. 시크릿에는 SHA-256 해시만 넣고,
// 들어온 값의 해시와 맞춰 본다. 앱·저장소 어디에도 비밀번호가 없다.
import { json, bad, CORS, sha256Hex, issueAdminToken, whoOf, sameSecret } from '../lib/util.js';
import { ensureSchema } from '../lib/schema.js';

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

/* 눌러 보는 것을 막는다.
 *
 * 전에는 400ms 지연 하나뿐이었는데, 그건 **동시 요청을 전혀 늦추지 않는다** —
 * 워커는 요청마다 따로 도니까 천 개를 한꺼번에 던지면 다 같이 400ms 만 기다린다.
 * 글 하나짜리 4자 비밀번호는 10분에 5번으로 막으면서, 정작 전부를 여는 이 비밀번호는
 * 무제한이었다. 값싼 쪽이 더 잘 지켜지고 있었다.
 *
 * 글 삭제와 같은 pwtry 표를 쓰되 열쇠에 접두사를 달아 칸을 나눈다 — 관리자 로그인을
 * 틀렸다고 제 글을 못 지우게 되면 안 된다. */
const TRY_MAX = 5;
const TRY_WINDOW_MS = 15 * 60 * 1000;

export async function onRequestPost({ request, env }) {
  await ensureSchema(env);
  let b;
  try { b = await request.json(); } catch { return bad('body', '본문을 읽지 못했습니다'); }
  const pw = String(b.password || '');
  if (!pw) return bad('pw', '비밀번호를 입력하세요');
  if (!env.ADMIN_PW_SHA256) return bad('cfg', '관리자 비밀번호가 설정돼 있지 않습니다', 500);

  const key = 'adm|' + (await whoOf(request, env));
  const now = Date.now();
  const t = await env.DB.prepare('SELECT n, at FROM pwtry WHERE who = ?').bind(key).first();
  const fresh = t && now - Number(t.at) < TRY_WINDOW_MS;
  if (fresh && Number(t.n) >= TRY_MAX) {
    return bad('rate', '비밀번호를 여러 번 틀렸습니다 — 15분 뒤에 다시 시도하세요', 429);
  }

  // 틀린 비밀번호를 빠르게 되묻는 것을 늦춘다 — 한 줄로 두드릴 때를 위한 보조 수단이다.
  await new Promise(r => setTimeout(r, 400));
  // 해시끼리라 길이가 같다. 다른 비밀 비교와 같은 방식으로 맞춘다.
  if (!sameSecret(await sha256Hex(pw), env.ADMIN_PW_SHA256)) {
    const n = fresh ? Number(t.n) + 1 : 1;
    await env.DB.prepare('INSERT INTO pwtry (who, n, at) VALUES (?,?,?) ON CONFLICT(who) DO UPDATE SET n = excluded.n, at = excluded.at')
      .bind(key, n, now).run();
    return bad('pw', `비밀번호가 다릅니다 (${TRY_MAX - n}번 남음)`, 401);
  }
  // 맞혔으면 센 것을 지운다 — 다음에 한 번 틀렸다고 잠기지 않게.
  await env.DB.prepare('DELETE FROM pwtry WHERE who = ?').bind(key).run();
  return json({ ok: true, token: await issueAdminToken(env) });
}
