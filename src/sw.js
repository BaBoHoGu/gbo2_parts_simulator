/* 사이트 오프라인 — 서비스 워커(사이트판 전용 · 2026-10-16).
   빌드가 아래 VERSION 자리에 빌드 시각을 넣는다 — 배포마다 이 파일 글자가 바뀌어 새 워커가 깔린다.

   규칙은 셋이다.
     ① 페이지(index.html) — **망 먼저**. 인터넷이 되면 늘 새로 받는다(「열면 늘 최신」 은 그대로다).
        안 되면 마지막으로 받은 페이지를 보여 준다. 9MB 가 넘는 한 장이라 이것만 있으면 앱이 돈다.
     ② 그림(images/ · illust/) — **보관 먼저, 뒤에서 새로**. 한 번 본 그림은 바로 뜨고, 바뀌었으면 다음에 반영된다.
     ③ 그 밖(갤러리·추천 영상 API, 다른 주소) — **손대지 않는다.** 그 기능들은 원래 인터넷이 없으면 조용히 빠진다.
   그림 보관함은 배포가 바뀌어도 이어 쓴다(그림 이름은 기체 이름이라 자주 안 바뀐다). 페이지 보관함만 판마다 새로 만든다. */
'use strict';
const VERSION = '/*__VERSION__*/';
const PAGE = 'gbo2-page-' + VERSION;
const IMG = 'gbo2-img-v1';

self.addEventListener('install', e => {
  // 처음 깔릴 때 페이지를 미리 받아 둔다 — 그래야 다음에 인터넷 없이 열려도 뜬다
  e.waitUntil(caches.open(PAGE).then(c => c.add(new Request('./', { cache: 'reload' }))).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('gbo2-page-') && k !== PAGE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isPage = (req, url) => req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html');
const isImg = url => /\/(images|illust)\//.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 다른 주소(유튜브 썸네일 등)는 손대지 않는다
  if (url.pathname.startsWith('/api/')) return;            // 갤러리·영상 API 는 늘 망으로

  if (isPage(req, url)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const c = await caches.open(PAGE); c.put('./', res.clone()); }
        return res;
      } catch {
        const hit = await caches.match('./', { cacheName: PAGE }) || await caches.match('./');
        return hit || Response.error();
      }
    })());
    return;
  }

  if (isImg(url)) {
    e.respondWith((async () => {
      const c = await caches.open(IMG);
      const hit = await c.match(req);
      const fresh = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(fresh); return hit; }
      return (await fresh) || Response.error();
    })());
  }
});
