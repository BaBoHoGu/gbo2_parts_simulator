-- 공유 갤러리 D1 스키마.
-- Firebase RTDB 의 builds / throttle / blocked 를 옮긴 것이다.
--   node tools/gallery_db.js --init   로 적용한다(로컬·원격 모두).

CREATE TABLE IF NOT EXISTS builds (
  id      TEXT PRIMARY KEY,     -- 구성 지문(같은 구성은 한 번만)
  ms      TEXT NOT NULL,
  stage   INTEGER NOT NULL,     -- 0 · 4 · 6
  exp     TEXT NOT NULL,
  exp_lv  INTEGER NOT NULL,     -- 1~5
  parts   TEXT NOT NULL,        -- JSON 배열 (최대 8)
  title   TEXT NOT NULL,
  author  TEXT NOT NULL,
  descr   TEXT,                 -- desc 는 SQL 예약어라 이름을 피한다
  free    INTEGER NOT NULL DEFAULT 0,   -- 서버가 파츠 표로 판정한 값
  ver     TEXT,
  who     TEXT NOT NULL,        -- 올린 사람 해시(IP+소금) — 차단·추적용, 원본은 저장하지 않는다
  at      INTEGER NOT NULL      -- 서버 시각(ms)
);
CREATE INDEX IF NOT EXISTS builds_at ON builds (at DESC);

-- 올리기 속도 제한 — 한 사람이 1분에 하나.
CREATE TABLE IF NOT EXISTS throttle (
  who TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);

-- 관리자가 내린 구성(지문). 목록에서 감춘다.
CREATE TABLE IF NOT EXISTS blocked (
  id  TEXT PRIMARY KEY,
  at  INTEGER NOT NULL
);
