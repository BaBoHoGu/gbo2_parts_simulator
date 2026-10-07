// GET /api/videos?ms=<기체 이름>   그 기체의 추천 영상 5개 (최근 1년 · 조회수 많은 순)
//
// 앱은 file:// 로도 열리고 인터넷이 없을 수도 있다. 그래서 이 길이 막히면 화면은
// 그 절만 숨기고 아무 일도 없던 것처럼 돈다 — 앱의 다른 기능은 이 길을 쓰지 않는다.
//
// 키(YT_API_KEY)는 **여기에만** 있다. 앱으로 내려가지 않으므로 공개 저장소에도,
// 배포본 HTML 에도 들어가지 않는다.
//
// 할당량이 이 기능의 진짜 제약이다. search.list 한 번이 100유닛, 무료 한도가 하루
// 10,000유닛이라 **하루 100기체**가 끝이다. 그래서 두 가지를 둔다:
//   · 받아 둔 것은 30일 쓴다(VIDEO_TTL) — 596종을 다 받아도 한 달에 596번, 하루 20번이다.
//   · 그래도 몰리면 우리 쪽에서 먼저 막는다(DAILY_CAP) — 한도를 넘겨 구글에 막히면
//     그날 남은 요청이 전부 죽는다. 우리가 세다 멈추면 「오늘은 여기까지」로 끝난다.
import { json, bad, CORS } from '../lib/util.js';
import { ensureSchema } from '../lib/schema.js';
import { MS_BASE, queryOf, filterFor, pickTop, TAKE, RECENT_DAYS,
         pickMs, isGameVideo, whyBlocked } from '../lib/videos.js';
import { PATCHED } from '../lib/dict.js';

/** 받아 둔 자료를 쓸 수 있는 기간. 유튜브 약관이 30일로 묶어 둔다 — 늘리면 안 된다. */
const VIDEO_TTL = 30 * 86400e3;
/** 어디까지 거슬러 볼 것인가 (사용자 결정: 2년) */
const WITHIN = 730 * 86400e3;
/* 하루 한도는 **유닛으로 센다.** 기체 수로 세면 한 기체에 드는 값이 바뀔 때마다
   어긋난다 — 실제로 그랬다: 검색을 하나에서 둘로 늘려 101→201유닛이 됐는데 세는 쪽은
   「기체 45마리」 그대로여서, 쓰지도 않은 예산을 남긴 채 먼저 멈췄다.
   유튜브는 유닛을 다 쓰면 그날 남은 요청을 전부 거절하므로 우리가 먼저 멈추되,
   멈추는 자리는 **실제로 쓴 만큼**이어야 한다. */
const UNIT_SEARCH = 100;      // search.list 한 번
const UNIT_VIDEOS = 1;        // videos.list 한 번 (50개까지 같은 값)
/* 검색 둘(각 50개) + 상세 둘(50씩 끊어서). 상세는 1유닛씩이라 거의 공짜다. */
const COST_PER_MS = UNIT_SEARCH * 2 + UNIT_VIDEOS * 2;
const DAILY_UNITS = 9500;     // 무료 한도 10,000 에서 조금 남긴다
/** 검색 한 번에 받아 볼 후보 수. 많이 받아도 유닛은 같고(100), 걸러낼 것이 많아
    후보가 적으면 6개를 못 채운다 — 실측에서 1년 이내 19개 중 9개만 남았다. */
/* 50 이 상한이고, **25 를 받든 50 을 받든 유닛은 똑같이 100 이다.** 25 만 받고 있었는데
   그래서 V2건담은 후보 안에 그 기체 영상이 2개밖에 안 들어왔다(나머지는 유튜브가 끌어온
   다른 기체의 인기 영상). 공짜로 두 배를 받을 수 있는데 안 받고 있었던 것이다. */
const CANDIDATES = 50;

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

/** 태평양 기준 '오늘' 번호. 유튜브 할당량이 그 자정에 되돌아간다(한국 시각이 아니다). */
const ptDay = (ms = Date.now()) => Math.floor((ms - 8 * 3600e3) / 86400e3);

/** 「PT8M7S」 → 초. 못 읽으면 0 (0 은 「모른다」로 다룬다 — 규칙이 재지 않는다). */
function durSec(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

/** 초 → 「8:07」. 0 이면 빈 글자(화면에 배지를 안 붙인다). */
function durText(sec) {
  if (!sec) return '';
  const p2 = n => String(n).padStart(2, '0');
  const h = Math.floor(sec / 3600), mi = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? h + ':' + p2(mi) + ':' + p2(s) : mi + ':' + p2(s);
}

/** 오늘 쓸 유닛을 미리 잡아 둔다. 한도를 넘으면 false — 부르지 않는다. */
async function takeQuota(env, cost = COST_PER_MS) {
  const d = ptDay();
  const row = await env.DB.prepare('SELECT n FROM ytq WHERE day = ?').bind(d).first();
  const n = row ? Number(row.n) : 0;
  if (n + cost > DAILY_UNITS) return false;
  await env.DB.prepare(
    'INSERT INTO ytq (day, n) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET n = n + excluded.n')
    .bind(d, cost).run();
  return true;
}

/** 유튜브에서 이 기체의 후보를 받아 온다. 실패하면 null(= 모른다), 성공하면 배열(빈 것 포함). */
async function fetchFromYouTube(env, ms) {
  /* 앞뒤 공백을 턴다. 비밀값은 사람 손을 거쳐 들어오고, 그 길에 줄바꿈이 붙기 쉽다 —
     실제로 그랬다: PowerShell 이 파이프에 붙인 줄바꿈을 `wrangler pages secret put` 이
     안 잘라 내서 40글자가 저장됐고, 유튜브는 「API key not valid」 라고만 답했다.
     넣는 쪽도 고쳤지만, 여기 한 줄이면 그런 일이 아예 안 통한다. */
  const key = String(env.YT_API_KEY || '').trim();
  /* 검색어는 사용자가 정한 꼴이다 — 일본어, 게임 이름 + 기체명.
     괄호는 검색을 망치므로 queryOf 가 펴 준다(「［GAU装備］」 → 「 GAU」). */
  const q = 'バトオペ2 ' + queryOf(ms);

  /** 창 하나를 뒤진다. 실패하면 {err}, 성공하면 {ids}. */
  const search = async (sinceMs) => {
    const url = 'https://www.googleapis.com/youtube/v3/search?' + new URLSearchParams({
      part: 'snippet', type: 'video', q,
      /* **관련도 순으로 받는다.** 조회수 순으로 받으면 「느슨하게 걸린 것 중 조회수 높은 것」
         이 와서, 그 기체와 상관없는 인기 영상이 후보 25칸을 다 차지한다 — V2건담은 후보 47개
         중 그 기체 영상이 **2개**뿐이었다(웹 검색 기본 정렬로는 20개 중 15개였다).
         조회수 순서는 우리가 받아 온 뒤 직접 매긴다. API 정렬은 「어떤 25개를 받을지」만 정한다. */
      order: 'relevance',
      publishedAfter: new Date(Date.now() - sinceMs).toISOString(),
      /* 게임 카테고리(videoCategoryId=20) 조건은 **뺐다**(사용자 결정).
         넣고 빼고 같은 6기체를 재 봤더니 결과가 한 글자도 다르지 않았다 — 건프라 영상은
         이미 제목의 게임 낱말 검사(isGameVideo)가 막고 있었다. 득은 없는데,
         올린 사람이 카테고리를 「게임」으로 안 고르면 멀쩡한 영상을 통째로 잃는다.
         다시 넣고 싶어지면 그때 이 측정부터 다시 할 것. */
      maxResults: String(CANDIDATES),
      relevanceLanguage: 'ja', regionCode: 'JP',
      key
    });
    const res = await fetch(url);
    if (!res.ok) {
      /* 왜 그냥 '실패' 로 뭉개지 않는가 — 키가 틀렸는지(API_KEY_INVALID), API 제한에
         막혔는지(accessNotConfigured), 할당량을 넘겼는지(quotaExceeded)가 서로 다른 일이다.
         뭉개 두면 「영상이 안 뜬다」만 남아 어디를 고쳐야 하는지 알 수가 없다. */
      const body = await res.text().catch(() => '');
      const reason = (body.match(/"reason"\s*:\s*"([^"]+)"/) || [])[1] || ('http' + res.status);
      /* reason 만으로는 안 갈린다 — 키가 틀려도, 매개변수가 틀려도 badRequest 가 온다.
         구글이 적어 보낸 말을 같이 들고 온다. 다만 **키가 섞여 나갈 틈을 막는다** —
         지금 메시지에 키가 들어오지는 않지만, 들어오는 날 조용히 공개된다. */
      const msg = String((body.match(/"message"\s*:\s*"([^"]+)"/) || [])[1] || '')
        .replace(/AIza[0-9A-Za-z_\-]+/g, '(키)').slice(0, 160);
      return { err: reason, msg };
    }
    const j = await res.json();
    return { ids: (j.items || []).map(it => it.id && it.id.videoId).filter(Boolean) };
  };

  /* **창을 둘로 나눠 뒤진다.** 2년치를 조회수 순으로만 보면 갓 올라온 영상이 영영 안 걸린다
     — 밸런스 패치 직후 영상은 아직 조회수를 못 모았는데, 정작 지금 그 기체가 어떻게
     바뀌었는지 말해 주는 것이 그 영상이다. 그래서 「2달 이내」를 따로 한 번 더 뒤진다.
     검색 두 번이라 유닛이 200 든다(DAILY_CAP 이 그만큼 낮다). */
  const [wide, recent] = await Promise.all([
    search(WITHIN),                       // 2년 — 인기
    search(RECENT_DAYS * 86400e3)         // 2달 — 최신
  ]);
  if (wide.err) return wide;              // 넓은 쪽이 실패하면 할 말이 없다
  // 좁은 쪽만 실패하면 넓은 쪽으로라도 보여 준다 — 아무것도 안 보이는 것보다 낫다
  const ids = [...new Set([...(wide.ids || []), ...((recent && recent.ids) || [])])];
  if (!ids.length) return { items: [] };

  /* 조회수는 search.list 가 주지 않는다 — videos.list 로 한 번 더 받는다.
     이쪽은 **한 번에 50개까지** 1유닛이다. 검색 둘에서 최대 100개가 오므로 50씩 끊는다.
     안 끊으면 50을 넘긴 요청이 통째로 거절되어 영상이 하나도 안 뜬다. */
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const raw = [];
  for (const part of chunks) {
    const vUrl = 'https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({
      part: 'snippet,statistics,contentDetails', id: part.join(','), key
    });
    const vRes = await fetch(vUrl);
    if (!vRes.ok) return { err: 'videos' + vRes.status };
    const vJson = await vRes.json();
    raw.push(...(vJson.items || []));
  }

  const items = raw.map(v => {
    const sec = durSec(v.contentDetails && v.contentDetails.duration);
    return {
      id: v.id,
      title: (v.snippet && v.snippet.title) || '',
      ch: (v.snippet && v.snippet.channelTitle) || '',
      chId: (v.snippet && v.snippet.channelId) || '',   // 제외·우대는 **ID 로** 가린다
      at: (v.snippet && v.snippet.publishedAt) || '',
      views: Number((v.statistics && v.statistics.viewCount) || 0),
      sec,                       // 규칙이 재는 값
      len: durText(sec)          // 화면에 적는 값
    };
  });
  return { items };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  // LV 은 떼고 본다 — 영상은 LV 별로 나뉘지 않는다
  const ms = String(url.searchParams.get('ms') || '').replace(/_LV\d+$/i, '').trim();
  /* ?why=1 — 무엇을 왜 뺐는지 같이 돌려준다. **받아 둔 것을 읽기만 한다**(유튜브를 새로
     부르지 않으므로 할당량을 못 태운다). 비밀이 아니라 우리가 고른 이유라 열어 둬도 된다. */
  const want = { why: url.searchParams.get('why') === '1' };

  /* 아무 글자나 받으면 **우리 키로 유튜브를 아무렇게나 검색할 수 있는 창구**가 된다.
     아는 기체 이름만 받는다. 사전은 갤러리와 같은 것을 쓴다(두 벌을 두면 어긋난다). */
  if (!ms || !MS_BASE.has(ms)) return bad('ms', '모르는 기체입니다', 400);

  if (!env.YT_API_KEY) {
    // 키가 없으면 「꺼져 있다」고 분명히 답한다. 화면은 절을 숨긴다.
    return json({ ok: true, ms, off: true, videos: [] });
  }

  await ensureSchema(env);
  const now = Date.now();

  const row = await env.DB.prepare('SELECT data, at, diag FROM videos WHERE ms = ?').bind(ms).first();
  if (row && now - Number(row.at) < VIDEO_TTL) {
    return json({ ok: true, ms, cached: true, at: Number(row.at), videos: JSON.parse(row.data),
      ...(want.why && row.diag ? { diag: JSON.parse(row.diag) } : {}) });
  }

  if (!(await takeQuota(env))) {
    /* 오늘 치를 다 썼다. **낡은 것을 내주지 않는다** — 30일이 지난 자료를 계속 보여 주는 것은
       약관이 막는 일이고, 그래서 여기서는 그냥 빈 손으로 답한다. 내일이면 채워진다. */
    return json({ ok: true, ms, videos: [], busy: true });
  }

  const got = await fetchFromYouTube(env, ms);
  if (got.err) {
    /* 할당량은 우리가 세고 있었는데도 넘었다면 구글 쪽 계산이 다른 것이다 — 오늘은 접는다. */
    /* 거절당했을 때 **저장된 키가 어떤 꼴인지**만 함께 알린다.
       값은 절대 내보내지 않는다 — 꼴만 본다. 이게 없어서 「등록은 됐는데 유튜브는
       거절한다」를 놓고 배포를 세 바퀴 돌았다. 빈 값인지, 꼴이 어긋났는지,
       꼴은 맞는데 값이 틀렸는지가 서로 완전히 다른 일이다. */
    const k = String(env.YT_API_KEY || '');
    const keyShape = !k ? 'empty'
      : /^AIza[0-9A-Za-z_\-]{35}$/.test(k) ? 'ok'
      : (/\s/.test(k) ? 'whitespace' : 'odd') + ':' + k.length;
    return json({ ok: true, ms, videos: [], err: got.err, msg: got.msg, keyShape });
  }

  /* 이름 자 + 게임 낱말로 거른다. 여기가 「ドム 칸에 RFドム」·「아우슬라 칸에 GAU」·
     「건프라 영상」이 들어오던 자리다(tools/videos_check.js 가 지킨다). */
  /* 고를 때 **갓 조정된 기체인지**를 알려 준다. 그런 기체는 최신 자리를 한 칸 더 받는다
     — 패치 직후 영상은 조회수가 아직 없어서, 안 떼어 두면 2년치 인기 영상에 밀린다. */
  const picked = pickTop(filterFor(ms, got.items), { patched: PATCHED.has(ms) });

  /* **무엇을 왜 뺐는지** 같이 적어 둔다. 「왜 두 개뿐이지」를 나중에 물을 때,
     이게 없으면 답하려고 할당량을 또 태워야 한다(실제로 V2건담에서 그 일이 있었다).
     받아 온 김에 한 번 세는 것이라 값이 거의 안 든다. */
  const diag = { cand: got.items.length, kept: picked.length, drop: [] };
  for (const v of got.items) {
    const who = pickMs(v.title);
    const why = who !== ms ? ('이름→' + (who || '모름'))
      : !isGameVideo(v.title, v.ch) ? '게임아님'
      : whyBlocked(v);
    if (why) diag.drop.push({ t: String(v.title).slice(0, 70), ch: v.ch, v: v.views, s: v.sec, why });
  }
  diag.drop = diag.drop.slice(0, 30);

  /* 0개여도 적어 둔다 — 안 적으면 영상 없는 기체를 열 때마다 할당량을 태운다.
     그리고 0개일 때 본체 영상으로 채우지 않는다(사용자 결정 A). */
  await env.DB.prepare(
    `INSERT INTO videos (ms, data, n, at, diag) VALUES (?,?,?,?,?)
       ON CONFLICT(ms) DO UPDATE SET data = excluded.data, n = excluded.n,
                                     at = excluded.at, diag = excluded.diag`)
    .bind(ms, JSON.stringify(picked), picked.length, now, JSON.stringify(diag)).run();

  return json({ ok: true, ms, at: now, videos: picked, ...(want.why ? { diag } : {}) });
}
