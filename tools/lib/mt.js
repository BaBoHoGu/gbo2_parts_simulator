// 구글(비공식 gtx) 온라인 번역 클라이언트 — auto_translate·translate_skills 공용.
// ja→ko. 업데이트(인터넷) 단계에서만 쓰이고, 결과는 사전에 캐시되어 배포본은 오프라인.
const https = require('https');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 번역 결과에 일본어(가나·한자)가 남았는지. ・(중점)·ー(장음)·々(반복)은 구분자/기호라 제외한다
// (안 그러면 「A / ・B」 처럼 ・ 가 든 완전한 번역이 거부된다).
const hasJa = s => /[぀-ヿ㐀-鿿]/.test(String(s).replace(/[・ー々]/g, ''));

/* 같은 구글 번역으로 가는 **두 입구.** 한쪽이 막혀도 다른 쪽으로 간다.
   2026-09-24 에 gtx 가 429(요청 과다)로 막혔고 **나흘이 지나도 안 풀렸다** —
   「기다리면 풀린다」가 아니어서, 그 동안 갱신이 통째로 멈췄다.
   응답 모양이 입구마다 다르므로 꺼내는 법도 입구가 각자 안다. */
const ENDPOINTS = [
  {
    name: 'gtx',
    url: t => 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=ko&dt=t&q='
      + encodeURIComponent(t),
    pick: j => j[0].map(s => s[0]).join(''),
  },
  {
    name: 'clients5',
    url: t => 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=ja&tl=ko&q='
      + encodeURIComponent(t),
    // ["번역문"] 또는 여러 문장이면 문자열 여럿. 줄바꿈은 그대로 온다.
    pick: j => (Array.isArray(j) ? j : [j]).map(x => (typeof x === 'string' ? x : '')).join(''),
  },
];

// 한 입구가 이번 실행 동안 막혔다고 판명된 것들. 429 를 만나면 남은 셀마다
// 네 번씩 헛되이 두드리지 않도록 **한 번만 확인하고 접는다.**
const blocked = new Set();

// 한 번 요청. 청크를 문자열로 이어붙이면 UTF-8 멀티바이트가 경계에서 깨지므로(�)
// Buffer 로 모아 한 번에 디코드한다.
function once(text, ep) {
  return new Promise((res, rej) => {
    const req = https.get(ep.url(text), { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      const chunks = []; r.on('data', c => chunks.push(c));
      r.on('end', () => {
        // 막힘은 HTML 로 온다 — 예전엔 JSON 파싱 실패로만 보여, **왜** 실패했는지 묻혔다.
        if (r.statusCode === 429 || r.statusCode === 403) {
          const e = new Error('HTTP ' + r.statusCode); e.blocked = true; return rej(e);
        }
        try {
          const t = String(ep.pick(JSON.parse(Buffer.concat(chunks).toString('utf8')))).trim();
          if (!t) return rej(new Error('empty'));
          res(t);
        } catch { rej(new Error('bad response')); }
      });
    });
    req.on('error', rej);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

// 재시도 포함 번역. 입구를 차례로 쓰고, 다 실패하면 null.
async function translate(text, retries = 4) {
  for (const ep of ENDPOINTS) {
    if (blocked.has(ep.name)) continue;
    for (let i = 0; i < retries; i++) {
      try { const t = await once(text, ep); if (t) return t; }
      catch (e) {
        if (e.blocked) {  // 이 입구는 접는다 — 재시도해도 같다
          blocked.add(ep.name);
          console.log('  번역 입구 ' + ep.name + ' 막힘(' + e.message + ') — 다른 입구로 넘어감');
          break;
        }
      }
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

module.exports = { translate, hasJa, sleep };
