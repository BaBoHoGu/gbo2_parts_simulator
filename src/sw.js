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
/* 그림 보관함의 상한. 지금 사이트 그림이 약 1,360장이다(2026-10-19). 그림 이름이 바뀌면 옛 것이 남아
   보관함이 끝없이 늘었다 — 새 판이 깔릴 때(배포마다) 오래 넣은 것부터 지워 이 수로 맞춘다.
   전부를 넉넉히 담는 값이라 평소엔 아무것도 안 지운다. */
const IMG_MAX = 3000;

self.addEventListener('install', e => {
  // 처음 깔릴 때 페이지를 미리 받아 둔다 — 그래야 다음에 인터넷 없이 열려도 뜬다
  e.waitUntil(caches.open(PAGE).then(c => c.add(new Request('./', { cache: 'reload' }))).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 보관함이 실패해도 claim 까지는 간다 — 안 그러면 새 워커가 이 탭을 맡지 못한다
    try { for (const k of await caches.keys()) if (k.startsWith('gbo2-page-') && k !== PAGE) await caches.delete(k); }
    catch { /* 보관함 실패 — 지우기만 못 한다 */ }
    await self.clients.claim();
    // keys() 는 넣은 차례다 — 앞쪽이 오래된 것
    try {
      const c = await caches.open(IMG), ks = await c.keys();
      for (const r of ks.slice(0, Math.max(0, ks.length - IMG_MAX))) await c.delete(r);
    } catch { /* 줄이기에 실패해도 워커는 돈다 */ }
  })());
});

/* 페이지는 **주소로만** 가린다. 예전엔 「이동하는 요청(navigate)이면 다 페이지」 였는데, 그러면 그림이나
   robots.txt 를 새 탭에서 연 것도 페이지 보관본('./')을 덮어써, 다음에 오프라인으로 열면 앱 대신 그림이
   떴다(2026-10-19 버그 탐색). 이 사이트의 페이지는 한 장뿐이다. */
/* **보관함(CacheStorage) 일은 절대 응답을 막지 않는다.** 예전엔 망에서 페이지를 멀쩡히 받아 놓고도
   보관하려고 caches.open 을 같은 try 안에서 기다렸다. 보관함이 실패하면(저장 공간 부족 · 브라우저가 저장소를
   정리하는 중 · 시크릿 창 등) catch 로 떨어지고, 거기서 또 보관함을 찾다 실패해 **페이지가 아예 안 떴다** —
   사용자 제보 「처음 들어가면 로딩이 안 되고 F5 를 눌러야 된다」(2026-10-19). 그림 길도 같았다.
   보관함 일은 모두 이 함수로 감싸 실패를 삼킨다 — 실패하면 오프라인 보관만 안 될 뿐이다. */
const quiet = f => Promise.resolve().then(f).catch(() => undefined);

const isPage = (req, url) => url.pathname === '/' || url.pathname.endsWith('/index.html');
const isHtml = res => /text\/html/i.test(res.headers.get('Content-Type') || '');
const isImg = url => /\/(images|illust)\//.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 다른 주소(유튜브 썸네일 등)는 손대지 않는다
  if (url.pathname.startsWith('/api/')) return;            // 갤러리·영상 API 는 늘 망으로

  /* 마지막 안전망 — 위의 무엇이 터져도 워커가 없을 때처럼 망으로 받는다. respondWith 에 넘긴 약속이
     거절되면 브라우저는 페이지를 **아예 못 띄운다**(ERR_FAILED). 워커는 덤이지 길목이 아니어야 한다. */
  const safe = p => p.catch(() => fetch(req));

  if (isPage(req, url)) {
    e.respondWith(safe((async () => {
      let res;
      try { res = await fetch(req); }
      catch {
        // 망이 안 될 때만 보관본 — 보관함마저 실패하면 워커 없을 때와 같은 오류다
        const hit = await quiet(() => caches.match('./', { cacheName: PAGE })) || await quiet(() => caches.match('./'));
        return hit || Response.error();
      }
      // HTML 일 때만 보관한다 — 혹시 다른 것이 같은 주소로 와도 보관본을 망치지 않게.
      // 보관은 **응답을 내준 뒤** 따로 한다(기다리지 않는다).
      if (res.ok && isHtml(res)) {
        const copy = res.clone();
        e.waitUntil(quiet(() => caches.open(PAGE).then(c => c.put('./', copy))));
      }
      return res;
    })()));
    return;
  }

  if (isImg(url)) {
    e.respondWith(safe((async () => {
      const c = await quiet(() => caches.open(IMG));
      const hit = c && await quiet(() => c.match(req));
      const fresh = fetch(req).then(res => {
        if (res.ok && c) { const copy = res.clone(); e.waitUntil(quiet(() => c.put(req, copy))); }
        return res;
      });
      if (hit) { e.waitUntil(fresh.catch(() => null)); return hit; }
      return fresh;
    })()));
  }
});
