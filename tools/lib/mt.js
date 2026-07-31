// 구글(비공식 gtx) 온라인 번역 클라이언트 — auto_translate·translate_skills 공용.
// ja→ko. 업데이트(인터넷) 단계에서만 쓰이고, 결과는 사전에 캐시되어 배포본은 오프라인.
const https = require('https');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 번역 결과에 일본어(가나·한자)가 남았는지. ・(중점)·ー(장음)·々(반복)은 구분자/기호라 제외한다
// (안 그러면 「A / ・B」 처럼 ・ 가 든 완전한 번역이 거부된다).
const hasJa = s => /[぀-ヿ㐀-鿿]/.test(String(s).replace(/[・ー々]/g, ''));

// 한 번 요청. 청크를 문자열로 이어붙이면 UTF-8 멀티바이트가 경계에서 깨지므로(�)
// Buffer 로 모아 한 번에 디코드한다.
function once(text) {
  return new Promise((res, rej) => {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=ko&dt=t&q='
      + encodeURIComponent(text);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      const chunks = []; r.on('data', c => chunks.push(c));
      r.on('end', () => {
        try { res(JSON.parse(Buffer.concat(chunks).toString('utf8'))[0].map(s => s[0]).join('').trim()); }
        catch { rej(new Error('bad response')); }
      });
    });
    req.on('error', rej);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

// 재시도 포함 번역. 실패하면 null.
async function translate(text, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try { const t = await once(text); if (t) return t; } catch { /* 재시도 */ }
    await sleep(500 * (i + 1));
  }
  return null;
}

module.exports = { translate, hasJa, sleep };
