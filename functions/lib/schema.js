// 표를 처음 한 번 만든다.
//
// 왜 마이그레이션 명령이 아니라 코드인가 — 로컬(miniflare)과 원격이 서로 다른 D1
// 인스턴스를 쓰는데, 배포·개발 양쪽에서 「스키마 적용을 잊는」 실패가 조용하다.
// CREATE TABLE IF NOT EXISTS 는 여러 번 돌아도 같은 결과라, 아이솔레이트가 뜰 때
// 한 번만 돌려 두면 그 실패가 아예 없어진다(요청마다 도는 비용은 없다).
let done = false;

const DDL = [
  `CREATE TABLE IF NOT EXISTS builds (
     id TEXT PRIMARY KEY, ms TEXT NOT NULL, stage INTEGER NOT NULL,
     exp TEXT NOT NULL, exp_lv INTEGER NOT NULL, parts TEXT NOT NULL,
     title TEXT NOT NULL, author TEXT NOT NULL, descr TEXT,
     free INTEGER NOT NULL DEFAULT 0, ver TEXT, who TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS builds_at ON builds (at DESC)`,
  `CREATE TABLE IF NOT EXISTS throttle (who TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS blocked (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`,
  /* 추천·비추 — 구성(build)과 기체(ms) 를 한 표에 담되 kind 로 나눈다.
     한 기기가 한 대상에 한 표만 가지므로 (kind,target,dev) 가 열쇠다.
     표를 둘로 나누지 않은 이유: 집계·한도 계산이 완전히 같은 모양이라,
     나누면 같은 코드를 두 벌 쓰게 되고 언젠가 한쪽만 고치게 된다. */
  `CREATE TABLE IF NOT EXISTS votes (
     kind TEXT NOT NULL, target TEXT NOT NULL, dev TEXT NOT NULL,
     dir INTEGER NOT NULL, who TEXT, at INTEGER NOT NULL,
     PRIMARY KEY (kind, target, dev))`,
  `CREATE INDEX IF NOT EXISTS votes_target ON votes (kind, target)`,
  /* 하루 한도를 셀 때 쓰는 길 — (기기, 갈래, 시각) */
  `CREATE INDEX IF NOT EXISTS votes_dev ON votes (dev, kind, at)`,
  /* 비밀번호 시도 횟수 — 올린 사람이 스스로 지울 때 쓰는 비밀번호는 짧다(4자부터).
     막지 않으면 몇 초 만에 다 눌러 볼 수 있으므로 IP 해시별로 센다. */
  `CREATE TABLE IF NOT EXISTS pwtry (who TEXT PRIMARY KEY, n INTEGER NOT NULL, at INTEGER NOT NULL)`,
  /* 추천 영상 캐시 — 기체 하나에 한 줄, 고른 영상 5개를 JSON 으로.
     **캐시가 아니라 의무다.** 유튜브 약관이 받아 둔 자료를 30일 안에 새로 받거나
     지우도록 묶어 둔다(util 의 VIDEO_TTL). 그래서 at 이 지나면 **내주지 않는다**.
     영상이 0개인 기체도 적어 둔다 — 안 적으면 그 기체를 열 때마다 할당량을 태운다. */
  `CREATE TABLE IF NOT EXISTS videos (
     ms TEXT PRIMARY KEY, data TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL)`,
  /* 하루에 유튜브를 몇 번 불렀는가. 무료 한도가 하루 10,000유닛이고 한 기체에 101유닛이라
     100번을 넘기면 그날 나머지가 통째로 막힌다 — 갤러리까지 같이 죽을 이유는 없으므로
     우리 쪽에서 먼저 센다. day 는 KST 기준(dayOf)이 아니라 **태평양 기준**이다:
     한도를 되돌리는 쪽이 구글이라 그 자정에 맞춰야 한다. */
  `CREATE TABLE IF NOT EXISTS ytq (day INTEGER PRIMARY KEY, n INTEGER NOT NULL)`
];

/* 나중에 늘어난 열. D1(SQLite)에는 ADD COLUMN IF NOT EXISTS 가 없어서, 이미 있으면
   나는 오류를 삼킨다 — 여기서 막히면 갤러리 전체가 멈춘다. */
const ALTERS = [
  'ALTER TABLE builds ADD COLUMN ip_head TEXT',
  /* 올린 사람이 스스로 내릴 때 쓰는 비밀번호. 원문이 아니라 해시만 둔다.
     이 열이 생기기 전에 올라온 구성은 NULL 이라 본인 삭제가 안 된다(관리자만 가능). */
  'ALTER TABLE builds ADD COLUMN pw_hash TEXT'
];

export async function ensureSchema(env) {
  if (done) return;
  await env.DB.batch(DDL.map(s => env.DB.prepare(s)));
  for (const sql of ALTERS) {
    try { await env.DB.prepare(sql).run(); }
    catch (e) { /* duplicate column — 이미 있다 */ }
  }
  done = true;
}
