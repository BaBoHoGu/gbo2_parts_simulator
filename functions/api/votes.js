// GET  /api/votes?kind=build|ms   집계 + 내 표 + 오늘 남은 횟수
// POST /api/votes                 표를 놓거나 바꾸거나 거둔다
//
// 구성(build)과 기체(ms)는 **한도를 나눠 쓰지 않는다**(사용자 결정) —
// 갈래마다 따로 하루 추천 5 · 비추 3 이다. 그래서 한도를 셀 때 kind 로 가른다.
import { json, bad, CORS, whoOf, devOf, dayOf } from '../lib/util.js';
import { MS } from '../lib/dict.js';
import { ensureSchema } from '../lib/schema.js';

const KINDS = ['build', 'ms'];
const LIMIT = { up: 5, down: 3 };        // 기기당 · 하루 · 갈래마다

/* 기체 표는 **LV 을 가르지 않고 기체 단위**로 센다 — LV 별로 나누면 표가 흩어져
   티어표 구실을 못 한다. 그래서 대상은 「ガンダムEz8」처럼 _LV 를 뗀 이름이다.
   사전을 새로 만들지 않고 MS 에서 파생한다 — 두 곳에 같은 목록을 두면 언젠가 어긋난다. */
const MS_BASE = new Set([...MS].map(n => n.replace(/_LV\d+$/i, '')));

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

/** 오늘(KST) 이 기기가 이 갈래에 놓아 둔 표를 방향별로 센다. */
async function usedToday(env, kind, dev) {
  if (!dev) return { up: 0, down: 0 };
  const since = dayOf() * 86400e3 - 9 * 3600e3;   // 오늘 0시(KST) 의 epoch ms
  const { results } = await env.DB.prepare(
    `SELECT dir, COUNT(*) AS n FROM votes
      WHERE dev = ? AND kind = ? AND at >= ? GROUP BY dir`).bind(dev, kind, since).all();
  const out = { up: 0, down: 0 };
  for (const r of results) out[Number(r.dir) > 0 ? 'up' : 'down'] = Number(r.n);
  return out;
}

/** 집계와 내 표를 함께 돌려준다 — 화면이 한 번의 왕복으로 다 그릴 수 있게. */
async function snapshot(env, kind, dev) {
  const { results } = await env.DB.prepare(
    `SELECT target,
            SUM(CASE WHEN dir > 0 THEN 1 ELSE 0 END) AS up,
            SUM(CASE WHEN dir < 0 THEN 1 ELSE 0 END) AS down
       FROM votes WHERE kind = ? GROUP BY target`).bind(kind).all();
  const totals = {};
  for (const r of results) totals[r.target] = [Number(r.up), Number(r.down)];

  const mine = {};
  if (dev) {
    const m = await env.DB.prepare(
      'SELECT target, dir FROM votes WHERE kind = ? AND dev = ?').bind(kind, dev).all();
    for (const r of m.results) mine[r.target] = Number(r.dir);
  }
  const used = await usedToday(env, kind, dev);
  return {
    totals, mine,
    left: { up: Math.max(0, LIMIT.up - used.up), down: Math.max(0, LIMIT.down - used.down) },
    limit: LIMIT,
    dev: !!dev
  };
}

export async function onRequestGet({ request, env }) {
  await ensureSchema(env);
  const kind = new URL(request.url).searchParams.get('kind') || 'build';
  if (!KINDS.includes(kind)) return bad('kind', '모르는 갈래입니다');
  const dev = await devOf(request, env);
  return json({ ok: true, kind, ...(await snapshot(env, kind, dev)) });
}

export async function onRequestPost({ request, env }) {
  await ensureSchema(env);
  let b;
  try { b = await request.json(); } catch { return bad('body', '본문을 읽지 못했습니다'); }

  const kind = String(b.kind || '');
  if (!KINDS.includes(kind)) return bad('kind', '모르는 갈래입니다');
  const target = String(b.target || '');
  if (!target || target.length > 200) return bad('target', '대상이 올바르지 않습니다');
  const dir = Number(b.dir);
  if (![1, 0, -1].includes(dir)) return bad('dir', '값이 올바르지 않습니다');

  const dev = await devOf(request, env);
  // 기기 id 가 없으면 한도를 셀 수가 없다. 세지 못하는 표는 받지 않는다.
  if (!dev) return bad('dev', '이 브라우저에서는 투표할 수 없습니다 (저장소가 막혀 있습니다)');

  // 대상이 실제로 있는 것인지 본다 — 없는 대상에 표가 쌓이면 집계가 거짓이 된다.
  if (kind === 'ms') {
    if (!MS_BASE.has(target)) return bad('target', '모르는 기체입니다');
  } else {
    const row = await env.DB.prepare('SELECT id FROM builds WHERE id = ?').bind(target).first();
    if (!row) return bad('target', '없는 구성입니다');
  }

  const prev = await env.DB.prepare(
    'SELECT dir FROM votes WHERE kind = ? AND target = ? AND dev = ?')
    .bind(kind, target, dev).first();
  const had = prev ? Number(prev.dir) : 0;

  if (dir === 0 || dir === had) {
    // 같은 걸 또 누르면 거둔다(토글). 거두는 데는 한도를 쓰지 않는다.
    if (had) {
      await env.DB.prepare('DELETE FROM votes WHERE kind = ? AND target = ? AND dev = ?')
        .bind(kind, target, dev).run();
    }
    return json({ ok: true, kind, ...(await snapshot(env, kind, dev)) });
  }

  // 새로 놓거나 방향을 바꾼다 — 둘 다 **가려는 방향**의 한도에서 하나를 쓴다.
  // 방향을 바꾸면 오던 쪽 한 자리가 비고 가는 쪽이 한 자리를 쓴다. usedToday 는
  // 지금 놓여 있는 표를 세므로, 바꾸려는 표는 아직 반대쪽에 잡혀 있다 —
  // 그래서 가려는 쪽 수치를 그대로 견주면 맞다.
  const used = await usedToday(env, kind, dev);
  const key = dir > 0 ? 'up' : 'down';
  if (used[key] >= LIMIT[key]) {
    return bad('limit',
      (dir > 0 ? '추천' : '비추') + '은 하루 ' + LIMIT[key] + '번까지입니다 (자정에 되돌아옵니다)', 429);
  }

  const who = await whoOf(request, env);   // 남용 조사용. 화면에는 안 나온다.
  await env.DB.prepare(
    `INSERT INTO votes (kind, target, dev, dir, who, at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(kind, target, dev) DO UPDATE SET dir = excluded.dir, at = excluded.at`)
    .bind(kind, target, dev, dir, who, Date.now()).run();

  return json({ ok: true, kind, ...(await snapshot(env, kind, dev)) });
}
