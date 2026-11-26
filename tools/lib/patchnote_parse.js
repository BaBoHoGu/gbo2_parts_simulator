// 공식 한국어 「유닛 관련 조정」 공지(bo2.ggame.jp/kr)를 구조째로 읽는다.
//
// 이 파일은 옆 프로젝트 `개인 개발/BP`(밸런스패치PPT생성기)의 parser.py 를 옮긴 것이다.
// 그쪽이 1년 가까이 실제 공지로 굴린 파서라, 공식 HTML 의 흠을 이미 다 밟아 봤다.
// **옮긴 이유는 그 흠 목록이다** — 새로 쓰면 아래 다섯 개를 다시 밟는다:
//
//   ① 기체 구분은 HTML 주석 마커 `<!-- ▼▼▼N機目▼▼▼ -->` 다. 절 제목(「기체 성능」 등)으로
//      가르면 변형·변신 서브섹션이 있는 기체에서 쪼개진다.
//      2026.09 패치부터 KR 은 「N기目」(한글 기 + 일본어 目)로 반쯤 한글화됐다 — 機/机/기 를 다 받는다.
//   ② 닫는 `</td>`·여는 `<tr>` 가 빠진 행이 있다(공식 HTML 오류). 그래서 셀은 다음 경계까지
//      긁고, 행은 `</tr>` 로 쪼갠다.
//   ③ 라벨 행과 내용 행을 **배경색으로 가르면 안 된다.** 색은 바뀐다. 셀 구조로 본다 —
//      내용 셀은 어느 줄이든 글머리(・)나 소제목(【…】)로 시작하거나 「→」를 품는다.
//   ④ 표 배치가 두 가지다. 결합형(한 table 에 thead+tbody)과 분리형(헤더 표 다음에 내용 표).
//   ⑤ 「<변형 시>」처럼 **영문자로 시작하지 않는 <...> 는 태그가 아니라 본문**이다. 지우면 뜻이 사라진다.
//
// 공식이 수치를 생략하는 항목이 있다(「비틀거림 축적치 상승」). 그 수치는 위키
// 「アップデート履歴」에 있다 — 여기서는 공식 문구를 **있는 그대로** 담고, 지어내지 않는다.
'use strict';

/* 2026-01 이전 공지는 번호가 **전각**이다(「▼▼▼▼▼１機目▼▼▼▼▼」) — `\d` 는 반각만 잡아 기체를 하나도 못 읽었다(2026-11-16). */
const UNIT_MARKER = /<!--+\s*▼+\s*([\d０-９]+)\s*[機机기]目\s*▼+\s*-+-->/;
const TABLE_RE = /<table\b[\s\S]*?<\/table>/gi;
const THEAD_TH_RE = /<thead[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>/i;
/** 닫는 </td> 가 없어도 다음 셀·행·표 경계까지 하나의 셀로 본다 (②) */
const TD_RE = /<td\b([^>]*)>([\s\S]*?)(?=<\/td>|<td\b|<\/tr>|<\/table>|$)/gi;

/** 본문이 아닌 표 — 참조데이터(COST·승률) */
const REF_KEYWORDS = ['참조데이터', '참조 데이터', 'COST', '参照データ'];
/** 본문이 아니지만 **따로 담는** 표 — 조정 의도. 일본어판(일본어 모드가 보인다)은 「調整意図」 */
const INTENT_PREFIXES = ['조정 의도', '조정의도', '調整意図'];
const BULLET = ['・', '･', '•', '·', '【'];

const unesc = s => String(s)
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

/* 태그만 지운다. `<변형 시>` 는 남긴다 (⑤ — 태그는 영문자·!·/ 로 시작한다).
   gbo2.jp 꾸러미가 NFD 로 오는 일이 있어 이름 비교가 깨진 적이 있다 — NFC 로 맞춰 둔다. */
const text = h => unesc(String(h).replace(/<\/?[a-zA-Z!][^>]*>/g, ''))
  .replace(/\s+/g, ' ').trim().normalize('NFC');

/** 내용 셀 → `<br>` 기준 줄 목록 */
const linesOf = h => unesc(String(h)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-zA-Z!][^>]*>/g, ''))
  .split('\n').map(s => s.replace(/\s+/g, ' ').trim().normalize('NFC')).filter(Boolean);

/** 주석 마커로 기체 블록을 가른다 → [[번호, 블록HTML], …] (①) */
function splitUnits(raw) {
  const parts = String(raw).split(new RegExp(UNIT_MARKER.source, 'g'));
  const out = [];
  for (let i = 1; i < parts.length - 1; i += 2) out.push([Number(String(parts[i]).normalize('NFKC')), parts[i + 1]]);
  return out;
}

/** 유닛 조정 공지인가 — 기체 마커가 하나라도 있는가 */
const looksLikePatchnote = raw => splitUnits(raw).length > 0;

const headerText = t => { const m = t.match(THEAD_TH_RE); return m ? text(m[1]) : null; };

/** 변경내용 셀인지 **구조로** 판별한다 (③) */
function isContentCell(cell) {
  const L = linesOf(cell);
  if (!L.length) return false;
  /* 첫 줄만 보면 안 된다 — 변형 무장은 첫 줄이 소제목(【통상 사격】)이고
     나머지가 전부 정성적(→ 없음)일 수 있다. 모든 줄의 글머리를 본다.
     「ビーム・サーベル」처럼 ・가 **가운데** 있는 무장명은 [0] 검사라 걸리지 않는다. */
  if (L.some(ln => BULLET.includes(ln[0]))) return true;
  return L.join(' ').includes('→');
}

const isRefTable = t => REF_KEYWORDS.some(k => t.includes(k));
const isIntentTable = t => INTENT_PREFIXES.some(p => text(t).slice(0, 12).startsWith(p));

/** 표 본문 → [{ category, weapon, changes }] (②③④) */
function parseRows(tableHtml) {
  const et = tableHtml.toLowerCase().indexOf('</thead>');
  const body = et !== -1 ? tableHtml.slice(et + 8) : tableHtml;
  const rows = [];
  let pending = null;                       // 분리형 배치의 직전 라벨 행
  for (const chunk of body.split(/<\/tr>/i)) {
    const tds = [...chunk.matchAll(TD_RE)].map(m => m[2]);
    if (!tds.length) continue;
    const last = tds[tds.length - 1];
    if (isContentCell(last)) {
      const changes = linesOf(last);
      if (tds.length >= 3) rows.push({ category: text(tds[0]), weapon: text(tds[1]), changes });
      else if (tds.length === 2 && pending === null) rows.push({ category: text(tds[0]), weapon: '', changes });
      else if (pending !== null) { rows.push({ category: pending[0], weapon: pending[1], changes }); pending = null; }
      else rows.push({ category: '', weapon: '', changes });
    } else if (tds.length >= 2) pending = [text(tds[0]), text(tds[1])];
    else pending = [text(tds[0]), ''];
  }
  return rows;
}

/**
 * 참조 데이터 표 → { cost, cols, rows }.
 *
 * 공식이 「왜 바꿨나」의 근거로 붙이는 표다. 실측한 꼴(2026-08-27 공지):
 *   행0  [참조 데이터(rowspan 5)] COST · 기체 LV · 승률 · 라이벌 승률 · 가한 대미지 · MS 손실 수 · – · –
 *   행1  [750(rowspan 2)] 범용 평균 · 49.3 · 48.5 · 104,985 · 3.4
 *   행2  LV1 · 40.9 · 39.4 · 97,227 · 4.0
 *   행3  조정 후 · 50.8 · 50.0 · 125,543 · 3.4        ← **한 달 뒤에 덧붙는다**
 *   행4  상정 범위 안 · ▲ · ▲ · ▲ · ▲
 *
 * 「조정 후」와 판정(「상정 범위 안」)은 조정 당시에는 없다. 다음 밸런스 패치 때
 * 공식이 **그 글에 덧붙인다**(8월 공지에 「결과 보고에 대해(2026/9/24 추가)」가 적혀 있다).
 * 그래서 옛 공지도 매번 다시 받아 합쳐야 한다 — 한 번 받고 끝내면 결과가 영영 안 들어온다.
 *
 * 꼬리의 「–」 칸은 빈 자리 채움이라 버린다. 지어내지 않고 있는 칸만 담는다.
 */
function parseRef(tableHtml) {
  const rows = [];
  for (const chunk of tableHtml.split(/<\/tr>/i)) {
    const tds = [...chunk.matchAll(TD_RE)];
    if (!tds.length) continue;
    rows.push(tds.map(m => ({
      span: Number((m[1].match(/rowspan\s*=\s*["']?(\d+)/i) || [])[1] || 1),
      v: text(m[2])
    })));
  }
  if (!rows.length) return null;
  const drop = c => c.v === '–' || c.v === '-' || c.v === '—' || c.v === '';
  /* 첫 행은 머리글. 맨 앞의 「참조 데이터」(rowspan) 와 「COST」·「기체 LV」를 뗀 나머지가 칸 이름이다. */
  const head = rows[0].filter(c => !/^(참조\s*데이터|参照データ)$/.test(c.v)).filter(c => !drop(c)).map(c => c.v);
  const cols = head.filter(c => c !== 'COST' && !/^(기체 LV|機体\s*LV)$/.test(c));
  const out = [];
  const notes = [];
  const costs = [];
  for (const r of rows.slice(1)) {
    const cells = r.filter(c => !drop(c));
    if (!cells.length) continue;
    let i = 0, blockCost = '';
    /* COST 칸은 rowspan 으로 LV 블록의 첫 행에만 있다 — 숫자만 오는 그 칸을 떼어 둔다. */
    if (cells[0].span > 1 && /^\d+$/.test(cells[0].v)) { blockCost = cells[0].v; costs.push(blockCost); i = 1; }
    const label = cells[i] ? cells[i].v : '';
    const values = cells.slice(i + 1).map(c => c.v);
    if (!label && !values.length) continue;
    /* 「■조정 결과에 대한 부연 설명 …」 — 표 끝에 한 칸으로 붙는 공식 설명(2023~). 값 없는 줄이 아니라 설명이다 */
    if (!values.length && /^■/.test(label)) { notes.push(label); continue; }
    out.push({ label, values, ...(blockCost ? { cost: blockCost } : {}) });
  }
  if (!out.length) return null;
  /* COST 가 하나면 표 머리에 하나로(예전과 같다). LV 마다 다르면 머리에 하나로 적지 않는다 —
     한때 「마지막 LV」 · 「첫 LV」 값 하나를 대표로 적었는데 어느 쪽이든 나머지 LV 와 맞지 않았다.
     그때는 LV 블록 첫 줄(평균 줄)의 cost 로 그 블록의 COST 를 보인다. */
  const uniq = [...new Set(costs)];
  const cost = uniq.length === 1 ? uniq[0] : '';
  if (uniq.length <= 1) for (const r of out) delete r.cost;
  return { cost, cols, rows: out, ...(notes.length ? { note: notes.join(' ') } : {}) };
}

/**
 * 기체 블록 → { sections, intent, ref }
 *   sections — [{ header, isSub, rows }] 메인 + 변형·변신 서브섹션
 *   intent   — 「조정 의도」 글줄. BP 는 PPT 양식상 버렸지만 **여기서는 담는다**:
 *              「왜 바꿨나」는 사용자가 읽고 싶은 공식 설명이고, 공식 문구 그대로라 지어낸 말이 아니다.
 *   참조데이터(COST·승률) 표는 버린다 — 우리 화면엔 이미 기체 수치가 있다.
 */
function parseBlock(block) {
  const sections = [];
  const intent = [];
  let ref = null;
  let pendingHeader = null;
  for (const t of block.match(TABLE_RE) || []) {
    const header = headerText(t);
    if (header !== null) {
      const rows = parseRows(t);
      if (rows.length) { sections.push({ header, isSub: sections.length > 0, rows }); pendingHeader = null; }
      else pendingHeader = header;          // 분리형: 헤더만. 다음 내용 표를 기다린다 (④)
      continue;
    }
    if (isIntentTable(t)) {
      pendingHeader = null;
      /* **셀 단위로** 읽는다. 표 전체를 linesOf 에 넣으면 `<br>` 만 줄로 보기 때문에
         「조정 의도」 라벨 셀과 본문 셀이 한 줄로 붙고, 그 줄이 라벨로 시작해 통째로
         버려진다 — 의도가 빈 채로 조용히 지나간다(심어서 확인했다). */
      for (const chunk of t.split(/<\/tr>/i)) {
        for (const m of [...chunk.matchAll(TD_RE)]) {
          for (const ln of linesOf(m[2])) {
            if (!ln || INTENT_PREFIXES.some(p => ln === p || ln.startsWith(p))) continue;
            intent.push(ln);
          }
        }
      }
      continue;
    }
    if (isRefTable(t)) { pendingHeader = null; ref = parseRef(t) || ref; continue; }
    if (pendingHeader !== null) {
      const rows = parseRows(t);
      if (rows.length) { sections.push({ header: pendingHeader, isSub: sections.length > 0, rows }); pendingHeader = null; }
    }
  }
  return { sections, intent, ref };
}

/**
 * 옛 틀(2021 ~ 2025-05 · 기체 구분 주석이 없다) — 기체마다 표 셋이 이어진다:
 *   ① 변경 표 — 첫 칸이 기체 이름(「데스파다」 · 「갸프랑<변형 시>」), 그 뒤 「기체 성능」 · 무장 줄
 *   ② 「조정 의도」 표   ③ 「참조 데이터」 표
 * 「조정 의도」 · 「참조 데이터」 가 아닌 변경 표가 나오면 새 기체다. 「<변형 시>」 처럼 꺾쇠 꼬리가 붙은 표는
 * 앞 기체의 덧붙은 표다. 참조 데이터만 쓰므로 변경 줄은 읽지 않는다(sections 는 빈 채) — 지어내지 않는다.
 * 2018 ~ 2020 공지는 참조 데이터 표가 없다(2026-11-16 실측) — 여기서도 빈 결과가 나온다.
 */
function parseLegacy(raw) {
  const out = [];
  let cur = null;
  /* 2024-11 무렵 꼴 — 이름만 든 **머리 표**(<thead><th>겔구그</th>)가 따로 오고, 변경 표는 「기체 성능」 부터 시작한다.
     그 이름을 들고 있다가 다음 변경 표의 이름으로 쓴다. */
  let held = null;
  for (const t of String(raw).match(TABLE_RE) || []) {
    const whole = text(t);
    if (whole && whole.length <= 40 && !/[・→]/.test(whole) && !isIntentTable(t) && !isRefTable(t)) {
      if (/[<＜][^>＞]{1,12}[>＞]$/.test(whole) && cur) { held = '\u0000sub'; continue; }   // 「<변형 시>」 머리 — 앞 기체의 덧붙은 표
      held = whole; continue;
    }
    if (isIntentTable(t)) {
      if (!cur) continue;
      for (const chunk of t.split(/<\/tr>/i)) for (const m of [...chunk.matchAll(TD_RE)])
        for (const ln of linesOf(m[2])) if (ln && !INTENT_PREFIXES.some(p => ln === p || ln.startsWith(p))) cur.intent.push(ln);
      continue;
    }
    if (isRefTable(t)) {
      /* 「■무장 관련 조정」 절 — 무장 표 뒤에 그 무장을 쓰는 **기체마다** 이름 머리 표(「마라사이(페다인 라이플[선행형] 장비 시)」)와
         참조 표가 온다. 이름을 들고 있으면 그 기체로 세운다(안 그러면 표가 무장에 붙는다 · 2022-02 실측). */
      if (held && held !== '\u0000sub') {
        cur = { index: out.length + 1, name: held, sections: [], intent: [], ref: null, legacy: true };
        out.push(cur);
        held = null;
      }
      if (cur) cur.ref = parseRef(t) || cur.ref;
      continue;
    }
    /* 기체 이름은 표의 **첫 칸** — 옛 틀은 <th> 다(<td> 만 보면 「기체 성능」 을 이름으로 잡는다) */
    const first = t.match(/<t[dh]\b[^>]*>([\s\S]*?)(?=<\/t[dh]>|<t[dh]\b|<\/tr>)/i);
    let name = first ? text(first[1]) : '';
    /* 변경 표인가 — 글머리(・)나 「→」 가 든 내용 칸이 있다 */
    if (!(/[・→]/.test(whole))) continue;
    if (held === '\u0000sub') { held = null; continue; }
    if (held) { name = held; held = null; }
    /* 첫 칸이 일반 제목(「조정 내용」 · 「기체 성능」 …)인 변경 표는 앞 기체의 이어지는 표다 —
       나이팅게일(2024-10)은 이름 표 다음 표가 「조정 내용」 으로 시작해 그것이 새 기체로 갈렸고 참조 표를 가져갔다 */
    else if (cur && /^(조정\s*내용|기체\s*성능|기본\s*성능|무장\s*성능|성능|사격\s*주무장|격투\s*주무장|부무장|調整内容|機体性能|基本性能|兵装性能|性能|射撃メイン|格闘メイン|サブ)$/.test(name)) continue;
    if (!name || name.length > 40) continue;
    if (/[<＜][^>＞]{1,12}[>＞]$/.test(name) && cur) continue;      // 「<변형 시>」 — 앞 기체에 딸린 표
    cur = { index: out.length + 1, name, sections: [], intent: [], ref: null, legacy: true };
    out.push(cur);
  }
  return out;
}

/** 공지 HTML → [{ index, name, sections, intent }] — 기체 구분 주석이 없으면 옛 틀로 읽는다 */
function parseNotice(raw) {
  if (!looksLikePatchnote(raw)) return parseLegacy(raw);
  const out = [];
  for (const [index, block] of splitUnits(raw)) {
    const { sections, intent, ref } = parseBlock(block);
    if (!sections.length) continue;
    out.push({ index, name: sections[0].header, sections, intent, ref });
  }
  return out;
}

/* ── 같은 날짜의 한국어 글 ↔ 일본어 글 ─────────────────────────────
   2026-11-26 조정은 글이 셋(범용 · 강습 · 지원)이었다. 한국어판은 범용 → 지원 으로 글 번호가 **줄고**(202469 · 202457 · 202445)
   일본어판은 **는다**(201847 · 201848 · 201849). 번호 순으로 짝짓던 탓에 한국어 지원 ↔ 일본어 범용이 붙어 22기가 엇갈렸다.
   제목의 타입 꼬리표로 짝짓는다. 꼬리표가 하나도 없는 날만 번호 순(예전 방식). */
const ARTICLE_TYPES = [['gen', /범용|汎用/], ['raid', /강습|強襲/], ['sup', /지원|支援/]];
/** 제목 → 'gen' · 'raid' · 'sup' · null (【…타입】 꼬리표, 하나만 걸릴 때) */
function articleType(title) {
  const t = String(title || '').normalize('NFKC');
  const tag = [...t.matchAll(/[【\[]([^】\]]*)[】\]]/g)].map(m => m[1]).join(' ');   // 꼬리표 안만 본다
  const hit = ARTICLE_TYPES.filter(([, re]) => re.test(tag));
  return hit.length === 1 ? hit[0][0] : null;
}
/**
 * 같은 날짜의 글 목록 둘([{id,title}]) → { pairs: [[krId, jpId]…] } 또는 { pairs: null, why }.
 * · 양쪽 모두 꼬리표가 있고 서로 다르면 → 꼬리표로
 * · 양쪽 모두 꼬리표가 없으면 → 번호 순
 * · 그 밖(한쪽만 꼬리표 · 겹침 · 짝 없는 꼬리표) → 짝짓지 않는다(일본어판을 안 쓴다)
 */
function pairArticles(ks, jsx) {
  if (!ks.length || ks.length !== jsx.length) return { pairs: null, why: '글 수가 다릅니다(KR ' + ks.length + ' / JP ' + jsx.length + ')' };
  const kt = ks.map(a => articleType(a.title)), jt = jsx.map(a => articleType(a.title));
  const allTyped = kt.every(Boolean) && jt.every(Boolean);
  const noneTyped = !kt.some(Boolean) && !jt.some(Boolean);
  if (allTyped) {
    if (new Set(kt).size !== kt.length || new Set(jt).size !== jt.length) return { pairs: null, why: '같은 타입 글이 둘 이상입니다' };
    const pairs = [];
    for (let i = 0; i < ks.length; i++) {
      const j = jt.indexOf(kt[i]);
      if (j < 0) return { pairs: null, why: '일본어판에 「' + kt[i] + '」 글이 없습니다' };
      pairs.push([ks[i].id, jsx[j].id]);
    }
    return { pairs };
  }
  if (noneTyped) {
    const kk = [...ks].sort((x, y) => Number(x.id) - Number(y.id));
    const jj = [...jsx].sort((x, y) => Number(x.id) - Number(y.id));
    return { pairs: kk.map((a, i) => [a.id, jj[i].id]) };
  }
  return { pairs: null, why: '타입 꼬리표가 한쪽에만 있습니다' };
}

module.exports = {
  articleType, pairArticles,
  parseRef,
  splitUnits, parseBlock, parseNotice, parseLegacy, parseRows,
  looksLikePatchnote, isContentCell, isRefTable, isIntentTable,
  text, linesOf, UNIT_MARKER
};
