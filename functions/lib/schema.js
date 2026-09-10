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
  `CREATE TABLE IF NOT EXISTS blocked (id TEXT PRIMARY KEY, at INTEGER NOT NULL)`
];

export async function ensureSchema(env) {
  if (done) return;
  await env.DB.batch(DDL.map(s => env.DB.prepare(s)));
  done = true;
}
