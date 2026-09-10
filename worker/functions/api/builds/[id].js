// DELETE /api/builds/:id   구성 내리기 (관리자만)
//
// Firebase 는 admins/ 노드에 uid 가 있는지 규칙이 봤다. 여기서는 로그인 때 받은
// 서명 토큰을 확인한다 — 토큰은 우리 시크릿으로만 만들 수 있다.
import { json, bad, CORS, isAdmin } from '../../lib/util.js';
import { ensureSchema } from '../../lib/schema.js';

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

export async function onRequestDelete({ request, env, params }) {
  await ensureSchema(env);
  if (!(await isAdmin(request, env))) return bad('auth', '권한이 없습니다', 403);
  const id = String(params.id || '');
  if (!id) return bad('id', '대상이 없습니다');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM builds WHERE id = ?').bind(id),
    // 지운 뒤 같은 구성이 다시 올라오는 것을 막는다 (Firebase 의 blocked 노드와 같은 역할)
    env.DB.prepare('INSERT INTO blocked (id, at) VALUES (?,?) ON CONFLICT(id) DO NOTHING').bind(id, Date.now())
  ]);
  return json({ ok: true, msg: '내렸습니다' });
}
