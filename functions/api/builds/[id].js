// DELETE /api/builds/:id   구성 내리기
//
// 두 길이 있다. **서로 아무 관계가 없다.**
//
//   ① 관리자 — Authorization 의 서명 토큰. 예전 Firebase 가 admins/ 노드를 규칙으로
//      보던 자리다. 비밀번호를 묻지 않고, 지운 뒤 blocked 에 넣어 같은 구성이 다시
//      올라오지 못하게 한다(신고를 받아 내리는 길이라 되살아나면 안 된다).
//
//   ② 올린 본인 — 본문의 비밀번호. 올릴 때 건 그 비밀번호다. 이쪽은 blocked 에 넣지
//      않는다 — 「고쳐서 다시 올리려고 내린다」가 대부분인데 막아 버리면 못 올린다.
//
// 관리자는 ①만 탄다. 토큰이 맞으면 비밀번호 검사에 아예 들어가지 않으므로,
// 관리자 동작은 이 기능이 생기기 전과 똑같다.
import { json, bad, CORS, isAdmin, whoOf, pwHashOf, sameSecret, PW_RE } from '../../lib/util.js';
import { ensureSchema } from '../../lib/schema.js';

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

/* 비밀번호를 눌러 보는 것을 막는다. 4자짜리는 몇 초면 다 돌 수 있다.
   IP 해시별로 10분 창에 5번까지. 맞히면 0 으로 되돌린다. */
const TRY_MAX = 5;
const TRY_WINDOW_MS = 10 * 60 * 1000;

export async function onRequestDelete({ request, env, params }) {
  await ensureSchema(env);
  const id = String(params.id || '');
  if (!id) return bad('id', '대상이 없습니다');

  // ── ① 관리자 ──
  if (await isAdmin(request, env)) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM builds WHERE id = ?').bind(id),
      // 지운 뒤 같은 구성이 다시 올라오는 것을 막는다 (Firebase 의 blocked 노드와 같은 역할)
      env.DB.prepare('INSERT INTO blocked (id, at) VALUES (?,?) ON CONFLICT(id) DO NOTHING').bind(id, Date.now())
    ]);
    return json({ ok: true, msg: '내렸습니다' });
  }

  // ── ② 올린 본인 ──
  let body = {};
  try { body = await request.json(); } catch { /* 본문이 없을 수 있다 */ }
  const pw = String(body.pw || '');
  if (!PW_RE.test(pw)) return bad('pw', '비밀번호를 입력하세요 (공백 없이 4~20자)');

  const who = await whoOf(request, env);
  const now = Date.now();
  const t = await env.DB.prepare('SELECT n, at FROM pwtry WHERE who = ?').bind(who).first();
  const fresh = t && now - Number(t.at) < TRY_WINDOW_MS;
  if (fresh && Number(t.n) >= TRY_MAX) {
    return bad('rate', '비밀번호를 여러 번 틀렸습니다 — 10분 뒤에 다시 시도하세요', 429);
  }

  const row = await env.DB.prepare('SELECT pw_hash FROM builds WHERE id = ?').bind(id).first();
  if (!row) return bad('none', '이미 없는 구성입니다', 404);
  if (!row.pw_hash) {
    // 비밀번호 기능이 생기기 전에 올라온 구성. 본인임을 확인할 방법이 없다.
    return bad('nopw', '비밀번호가 없는 옛 구성입니다 — 관리자에게 문의해 주세요', 403);
  }

  if (!sameSecret(row.pw_hash, await pwHashOf(env, id, pw))) {
    const n = fresh ? Number(t.n) + 1 : 1;
    await env.DB.prepare('INSERT INTO pwtry (who, n, at) VALUES (?,?,?) ON CONFLICT(who) DO UPDATE SET n = excluded.n, at = excluded.at')
      .bind(who, n, now).run();
    return bad('pw', `비밀번호가 다릅니다 (${TRY_MAX - n}번 남음)`, 403);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM builds WHERE id = ?').bind(id),
    // 표도 같이 지운다 — 구성이 없어졌는데 추천 수만 남으면 다음에 같은 지문이
    // 올라왔을 때 남의 표를 물려받는다.
    env.DB.prepare("DELETE FROM votes WHERE kind = 'build' AND target = ?").bind(id),
    env.DB.prepare('DELETE FROM pwtry WHERE who = ?').bind(who)
  ]);
  return json({ ok: true, msg: '내렸습니다' });
}
