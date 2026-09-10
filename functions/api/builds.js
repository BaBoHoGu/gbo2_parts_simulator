// GET  /api/builds   최근 구성 목록
// POST /api/builds   구성 올리기
//
// Firebase 규칙이 하던 검사를 그대로 옮겼다 — 짝을 주석에 적어 둔다.
import { json, bad, CORS, whoOf, ipHeadOf } from '../lib/util.js';
import { MS, PARTS, EXP, PAID } from '../lib/dict.js';
import { ensureSchema } from '../lib/schema.js';
import { TITLE_RE, AUTHOR_RE, DESC_RE } from '../lib/util.js';

const LIMIT = 300;          // 목록에서 돌려줄 최근 구성 수 (Firebase 의 CFG.limit 과 같다)
const THROTTLE_MS = 60_000; // 1분에 한 건 (rules.json throttle)

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

export async function onRequestGet({ env }) {
  await ensureSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT id, ms, stage, exp, exp_lv, parts, title, author, descr, free, ver, ip_head, at
       FROM builds
      WHERE id NOT IN (SELECT id FROM blocked)
      ORDER BY at DESC
      LIMIT ?`).bind(LIMIT).all();
  return json({
    ok: true,
    builds: results.map(r => ({
      id: r.id, ms: r.ms, stage: r.stage, exp: r.exp, expLv: r.exp_lv,
      parts: JSON.parse(r.parts), title: r.title, author: r.author,
      desc: r.descr || '', free: r.free === 1, ver: r.ver || '',
      ipHead: r.ip_head || '', at: r.at
    }))
  });
}

export async function onRequestPost({ request, env }) {
  await ensureSchema(env);
  let b;
  try { b = await request.json(); } catch { return bad('body', '본문을 읽지 못했습니다'); }

  // ── 구성 ── (rules.json: ms/exp/p0~p7 을 dict 와 대조, stage·expLv 범위)
  const ms = String(b.ms || '');
  if (!MS.has(ms)) return bad('ms', '모르는 기체입니다');
  const exp = String(b.exp || '');
  if (!EXP.has(exp)) return bad('exp', '모르는 확장 스킬입니다');
  const stage = Number(b.stage);
  if (![0, 4, 6].includes(stage)) return bad('stage', '강화 단계가 올바르지 않습니다');
  const expLv = Number(b.expLv);
  if (!(expLv >= 1 && expLv <= 5)) return bad('expLv', '확장 레벨이 올바르지 않습니다');
  const parts = Array.isArray(b.parts) ? b.parts.map(String) : [];
  if (!parts.length) return bad('parts', '파츠를 하나 이상 장착한 뒤 올려 주세요');
  if (parts.length > 8) return bad('parts', '파츠가 8개를 넘습니다');
  for (const p of parts) if (!PARTS.has(p)) return bad('parts', '모르는 파츠입니다: ' + p);

  // ── 글 ── (rules.json: title/author/desc 길이·문자 범위)
  const title = String(b.title || '').trim();
  if (!TITLE_RE.test(title)) return bad('title', '제목이 올바르지 않습니다 (1~20자)');
  const author = String(b.author || '').trim();
  if (!AUTHOR_RE.test(author)) return bad('author', '작성자가 올바르지 않습니다 (1~12자)');
  const desc = String(b.desc || '').trim();
  if (!DESC_RE.test(desc)) return bad('desc', '설명이 올바르지 않습니다 (60자까지)');
  const ver = String(b.ver || '').slice(0, 12);

  // ── 무과금 ── 앱이 보낸 값을 믿지 않고 서버가 파츠 표로 직접 정한다.
  // Firebase 로는 못 하던 검증이다(규칙이 파츠 표를 들고 있을 수 없었다).
  const free = parts.every(p => !PAID.has(p)) ? 1 : 0;

  // ── 속도 제한 ── (rules.json: throttle/$uid, 60초)
  const who = await whoOf(request, env);
  const ipHead = ipHeadOf(request);     // 화면에 적을 앞자리. 원본 IP 는 저장하지 않는다.
  const now = Date.now();
  const prev = await env.DB.prepare('SELECT at FROM throttle WHERE who = ?').bind(who).first();
  if (prev && now - Number(prev.at) < THROTTLE_MS) {
    return bad('rate', '너무 빠릅니다 — 1분에 한 번만 올릴 수 있습니다', 429);
  }

  // ── 지문 ── 같은 구성은 한 번만. 앱이 만든 값을 쓰지 않고 서버가 다시 만든다.
  const id = await fingerprint(ms, stage, exp, expLv, parts);
  const dup = await env.DB.prepare('SELECT id FROM builds WHERE id = ?').bind(id).first();
  if (dup) return bad('dup', '이미 올라온 구성입니다');

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO builds (id, ms, stage, exp, exp_lv, parts, title, author, descr, free, ver, who, ip_head, at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, ms, stage, exp, expLv, JSON.stringify(parts), title, author, desc || null, free, ver, who, ipHead, now),
    env.DB.prepare('INSERT INTO throttle (who, at) VALUES (?,?) ON CONFLICT(who) DO UPDATE SET at = excluded.at')
      .bind(who, now)
  ]);
  return json({ ok: true, id, free: free === 1, msg: '갤러리에 올렸습니다' });
}

/** 구성 지문 — 같은 구성이면 같은 값. 파츠 순서는 무시한다. */
async function fingerprint(ms, stage, exp, expLv, parts) {
  const s = [ms, stage, exp, expLv, [...parts].sort().join('|')].join('\u0001');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
