// raw/wiki/*.html 의 무장 표를 data/weapons.json 으로 뽑아낸다.
//   node tools/fetch_wiki.js        # 먼저 위키 페이지 수집
//   node tools/extract_weapons.js
//
// 표 구조가 무장 종류마다 다르므로(사격은 弾数·리로드, 격투는 쿨타임) 위치가 아니라
// 헤더 이름으로 값을 읽는다. rowspan/colspan 을 펼쳐 2차원으로 만든 뒤 처리한다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'raw', 'wiki');

// 備考는 원문에서 <br> 로 항목을 나눈다. 공백으로 뭉개면 한 줄로 이어져 읽기 어려우니
// 구분자를 남긴다. 앞뒤 공백이 있어 「よろけ値：35%」 같은 \S+ 추출에는 영향이 없다.
const clean = s => s
  .replace(/<br\s*\/?>/gi, ' / ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

/** rowspan/colspan 을 펼쳐 표를 2차원 배열로 만든다. */
function parseTable(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  const grid = [];
  rows.forEach((r, ri) => {
    grid[ri] = grid[ri] || [];
    let ci = 0;
    for (const c of r.matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const text = clean(c[3]);
      const cs = Number((c[2].match(/colspan="?(\d+)/i) || [])[1] || 1);
      const rs = Number((c[2].match(/rowspan="?(\d+)/i) || [])[1] || 1);
      while (grid[ri][ci] !== undefined) ci++;
      for (let dr = 0; dr < rs; dr++) {
        grid[ri + dr] = grid[ri + dr] || [];
        for (let dc = 0; dc < cs; dc++) grid[ri + dr][ci + dc] = text;
      }
      ci += cs;
    }
  });
  return grid.map(r => Array.from(r, v => (v === undefined ? '' : v)));
}

const LV = /^LV\s*(\d+)$/i;

/**
 * 위키에 LV1 을 그냥 「LV」로 적어 둔 표가 있다 (ディジェ（CA）의 격투 표, 전체에서 1건).
 * 그대로 두면 그 행이 헤더로 빨려 들어가 위력·쿨타임이 통째로 사라지므로,
 * 숫자를 함께 담고 있는 행에 한해 LV1 로 보정한다. (열 이름 행에는 숫자가 없다)
 */
function fixBareLevel(grid) {
  for (const row of grid) {
    if (!row.some(c => /^\d[\d,]*$/.test(c))) continue;
    const i = row.findIndex(c => /^LV$/i.test(c));
    if (i >= 0) row[i] = 'LV1';
  }
  return grid;
}

/** 첫 데이터 행(LV1 …) 위쪽은 전부 헤더로 본다. 집속 무기는 헤더가 2줄(威力/ノン·フル). */
function splitHeader(grid) {
  const at = grid.findIndex(r => r.some(c => LV.test(c)));
  return at <= 0 ? null : { head: grid.slice(0, at), body: grid.slice(at) };
}

/** 헤더 여러 줄을 열마다 합쳐 이름을 만든다. (威力 + ノン → "威力/ノン") */
function columnNames(head) {
  const width = Math.max(...head.map(r => r.length));
  const out = [];
  for (let c = 0; c < width; c++) {
    const parts = [];
    for (const r of head) {
      const v = (r[c] || '').trim();
      if (v && parts[parts.length - 1] !== v) parts.push(v);
    }
    out.push(parts.join('/'));
  }
  return out;
}

const num = s => {
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/**
 * 「よろけ値」(누적치) 표기를 뽑는다.
 * 집속 무기는 非集束/集束 을 따로 적기도 하고, 한 값에 (17HIT) 처럼 덧붙기도 한다.
 */
function parseStagger(note) {
  const non = /非集束よろけ値：(\S+)/.exec(note);
  const chg = /(?:^|[^非])集束よろけ値：(\S+)/.exec(note);
  if (non && chg) return non[1] + ' (' + chg[1] + ')';
  if (non) return non[1];
  if (chg) return chg[1];
  // 非集束/集束 표기를 지운 뒤 남은 일반 표기를 본다
  const plain = /よろけ値：(\S+(?:\s*[x×]\s*\d+)?)/.exec(note.replace(/(?:非)?集束よろけ値：\S+/g, ''));
  return plain ? plain[1] : null;
}

/**
 * 방어용 실드 표.
 * 무장 표와 달리 행·열이 뒤집혀 있고 威力 열이 없어 일반 경로에서는 통째로 걸러졌다.
 *   |        | LV1  | LV2  | LV3  |
 *   | シールドHP | 3000 | 3300 | 3600 |
 *   | サイズ   | L    |
 * 레벨마다 값이 다른 행은 levels[N].raw 로, 한 칸뿐인 행은 info 로 담아
 * 나머지 무장과 같은 모양으로 맞춘다.
 */
function parseShield(grid, section, heading) {
  const hpRow = grid.findIndex(r => /^(シールド)?HP$|^耐久(値)?$/.test((r[0] || '').replace(/\s/g, '')));
  if (hpRow < 0) return null;
  // 첫 행이 LV 머리글이어야 실드 표다 (기체 스펙 표에도 シールドHP 가 섞여 있다)
  const lvCols = [];
  (grid[0] || []).forEach((c, i) => { const m = LV.exec((c || '').replace(/\s/g, '')); if (m) lvCols.push([i, m[1]]); });
  if (!lvCols.length) return null;

  const w = {
    name: heading && /シールド|盾/.test(heading) ? heading : 'シールド',
    section: section || 'シールド',
    type: 'shield',
    levels: {},
    info: {}
  };
  for (const [, lv] of lvCols) w.levels[lv] = { power: null, raw: {} };

  for (const row of grid.slice(1)) {
    const label = (row[0] || '').trim();
    if (!label) continue;
    const vals = lvCols.map(([i]) => (row[i] || '').trim());
    // 한 칸만 채워진 행(サイズ 등)은 레벨과 무관한 값이다
    const filled = vals.filter(Boolean);
    if (!filled.length) continue;
    if (filled.every(v => v === filled[0])) w.info[label] = filled[0];
    else lvCols.forEach(([, lv], k) => { if (vals[k]) w.levels[lv].raw[label] = vals[k]; });
  }
  for (const l of Object.values(w.levels)) if (!Object.keys(l.raw).length) delete l.raw;
  return w;
}

/* ---------- 격투 방향·연격 보정 ---------- */

/** 첫 칸이 `firstCell` 인 표를 찾는다 (格闘方向 / 連撃数). */
function findGrid(grids, firstCell) {
  for (const g of grids) if (g[0] && g[0][0] === firstCell) return g;
  return null;
}

const OWN_COL = /^(本武器|本MS|本機).{0,2}倍率$/;   // 「本武器倍率」= 이 무장의 배율
/**
 * 무장명·열명을 토큰으로 쪼갠다. 괄호 안(打突·強化 등)과 xN(x2·x3)을 각각 토큰으로 남긴다.
 * 이렇게 해야 「ムラマサ」「ムラマサ[打突]」「ムラマサ[打突](最大出力)」 세 변형이 섞이지 않는다.
 */
const nameTokens = s => String(s).replace(/^.*用/, '')
  .replace(/[【［(（]/g, '・').replace(/[】］)）]/g, '・')     // 괄호를 구분자로
  .replace(/([^・])([x×]\d+)/g, '$1・$2')                     // xN 을 따로 떼어
  .replace(/倍率/g, '').replace(/×/g, 'x')
  .split(/[・\s]/).filter(Boolean);

/**
 * 방향/연격 표의 열(무장 약칭)을 무장명에 맞춘다.
 * 열의 모든 토큰(괄호·xN 포함)이 무장명에 순서대로 있어야 그 열을 쓴다.
 *   ① 가장 구체적인(토큰 많은) 열 → ② 「本武器倍率」 → ③ 「標準倍率」
 * 「ムラマサ[打突]」은 打突 토큰까지 있는 [타돌] 무장에만 걸리고, 민 무라마사는 「ムラマサ」에 걸린다.
 */
function matchColumn(cols, wname) {
  const wt = nameTokens(wname);
  let best = -1, bestScore = 0, bestLen = 0;
  for (let i = 1; i < cols.length; i++) {
    const c = cols[i];
    if (!c || c === '標準倍率' || OWN_COL.test(c)) continue;
    const ct = nameTokens(c);
    if (!ct.length) continue;
    let wi = 0, matched = 0;
    for (const t of ct) { while (wi < wt.length && wt[wi] !== t) wi++; if (wi < wt.length) { matched++; wi++; } }
    if (matched === ct.length && (matched > bestScore || (matched === bestScore && c.length > bestLen))) {
      best = i; bestScore = matched; bestLen = c.length;
    }
  }
  if (best >= 0) return best;
  const own = cols.findIndex(c => OWN_COL.test(c));
  return own >= 0 ? own : cols.indexOf('標準倍率');
}

/** 「240%(120%x2)」→ [1.2,1.2], 「100%」→ [1.0], 「連撃不可」→ null. */
function parseMult(raw) {
  const s = String(raw || '').trim();
  if (!s || /連撃不可|不可|-|―|無/.test(s)) return null;
  const multi = s.match(/\((\d+(?:\.\d+)?)\s*[%％]\s*[x×]\s*(\d+)\)/);
  if (multi) return Array(Number(multi[2])).fill(Number(multi[1]) / 100);
  const one = s.match(/(\d+(?:\.\d+)?)\s*[%％]/);
  return one ? [Number(one[1]) / 100] : null;
}

/** 방향 표의 한 열을 {방향:히트} 행 목록으로. */
function dirRows(grid, col) {
  const rows = [];
  for (const r of grid.slice(1)) {
    const hits = parseMult(r[col]);
    if (hits) rows.push({ label: r[0], raw: r[col].trim(), hits });
  }
  return rows;
}

/** 스킬 상태 라벨 한글화 (「最大出力（T）」→ 최대출력). */
const STATE_KO = {
  '最大出力': '최대출력', 'レイド中': '레이드 중', '覚醒': '각성', 'ハイパーモード': '하이퍼 모드',
  'トランザム': '트랜잠', 'バーサク': '버서크', 'MEPE': 'MEPE', 'サイコフレーム共振': '사이코프레임 공진'
};
const stateLabel = s => {
  const core = s.replace(/[（(][^）)]*[）)]/g, '').trim();   // (T) 같은 부기 제거
  return STATE_KO[core] || STATE_KO[s] || core || s;
};

/**
 * 페이지의 격투 무장에 방향·연격 보정을 붙인다.
 * 한 무장이 상태(기본/헤비어택/최대출력 등)별로 방향 배율이 다를 수 있어 variants 로 담는다.
 *   기본       — 무장명이 맞는 열
 *   헤비어택   — 「ヘビーアタック」 열 (備考에 대응 표기가 있는 무장)
 *   <상태>     — 「<기본열>（상태）」 열 (스킬 발동 시)
 */
function attachMeleeMods(weapons, grids) {
  const dir = findGrid(grids, '格闘方向');
  const combo = findGrid(grids, '連撃数');
  const melees = weapons.filter(w => w.type === 'melee');
  if (!dir && !combo) return;

  // 각 무장의 기본 열 (상태 열은 무장명에 상태 토큰이 없어 여기 안 걸린다)
  const baseIdx = new Map();
  const isBaseName = new Set();
  if (dir) for (const w of melees) {
    const ci = matchColumn(dir[0], w.name);
    baseIdx.set(w, ci);
    const cn = dir[0][ci];
    if (cn && cn !== '標準倍率' && !OWN_COL.test(cn)) isBaseName.add(cn);
  }

  for (const w of melees) {
    const variants = [];
    if (dir) {
      const bi = baseIdx.get(w), bn = dir[0][bi];
      const base = dirRows(dir, bi);
      if (base.length) variants.push({ label: '기본', direction: base });
      const note = (w.info && w.info['備考']) || '';
      for (let i = 1; i < dir[0].length; i++) {
        const c = dir[0][i];
        if (!c || i === bi || isBaseName.has(c)) continue;   // 다른 무장의 기본 열은 건너뛴다
        // 헤비어택 — 이 무장이 대응할 때만
        if (/ヘビーアタック/.test(c) && /ヘビーアタック/.test(note)) {
          const rows = dirRows(dir, i);
          if (rows.length) variants.push({ label: '헤비어택', direction: rows });
          continue;
        }
        // 「<기본열>（상태）」 — 스킬 발동 상태
        const m = c.match(/^(.*?)[（(]([^）)]+)[）)]\s*$/);
        if (m && m[1] === bn) {
          const rows = dirRows(dir, i);
          if (rows.length) variants.push({ label: stateLabel(m[2]), direction: rows });
        }
      }
    }
    let comboRows = null;
    if (combo) {
      const ci = matchColumn(combo[0], w.name);
      const rows = [];
      for (const r of combo.slice(1)) {
        const hits = parseMult(r[ci]);
        if (hits) rows.push({ label: r[0], raw: r[ci].trim(), mult: hits[0] });
      }
      if (rows.length > 1) comboRows = rows;   // 1격뿐이면 연격이 아니다
    }
    if (variants.length || comboRows) {
      w.melee = {};
      if (variants.length) w.melee.variants = variants;
      if (comboRows) w.melee.combo = comboRows;
    }
  }
}

/** 備考에서 계산·표시에 쓰는 값을 뽑아낸다. */
function parseNote(note) {
  const pick = re => { const m = note.match(re); return m ? Number(m[1]) : null; };
  return {
    chargeRatio: pick(/倍率：([\d.]+)倍/),
    chargeTime: pick(/集束時間：([\d.]+)秒/),
    shieldMod: pick(/シールド補正：([\d.]+)倍/),
    partMod: pick(/局部補正：([\d.]+)倍/),
    stagger: parseStagger(note)
  };
}

/**
 * 사이코뮤 무장 표시. 판별 신호:
 *   ① 備考에 「ロックオン」 (판넬·인컴·사이코플레이트 등 공격 모드의 공통 표기)
 *   ② 같은 페이지에서 ①과 무장 계열(괄호·xN 제거한 이름)이 같은 무장 — [防御]/[射出] 등
 *      다른 모드 전개까지 포함 (아비고르 빔 사이스[防御]처럼 록온 형제가 없는 건 제외됨)
 * 리로드/OH 단축 파츠(CP 내장 특수 구조재 등)가 이 표시를 scope 로 노린다.
 */
// 자동 태깅은 순수하게 신호(록온·계열)만 본다. 록온이지만 사이코뮤가 아닌 오탐
// (베르가 기로스 GK의 ホッブバグ 등)은 data/psycommu.override.json 으로 build 시 교정한다.
// (작은 오버라이드 파일 + 재빌드만으로 패치 가능 — extract 재수신 불필요)
function tagPsycommu(weapons) {
  const fam = nm => String(nm).replace(/[［【（〔〈「].*$/, '').replace(/[x×]\d+.*$/i, '').trim();
  const lockFams = new Set();
  for (const w of weapons) {
    if (/ロックオン/.test(JSON.stringify(w))) { w.psycommu = true; lockFams.add(fam(w.name)); }
  }
  for (const w of weapons) {
    if (!w.psycommu && lockFams.has(fam(w.name))) w.psycommu = true;
  }
}

const files = fs.existsSync(WIKI) ? fs.readdirSync(WIKI).filter(f => f.endsWith('.html')) : [];
if (!files.length) {
  if (process.argv.includes('--merge')) {
    // 병합 모드에서 받은 페이지가 없으면 기존 weapons.json 을 그대로 둔다.
    console.log('갱신할 위키 페이지 없음 — 기존 weapons.json 유지');
    process.exit(0);
  }
  console.error('raw/wiki 가 비어 있습니다. 먼저 `node tools/fetch_wiki.js` 를 실행하세요.');
  process.exit(1);
}

const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
const namesByPage = new Map();
for (const m of msData) {
  const id = (String(m.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
  if (!id) continue;
  if (!namesByPage.has(id)) namesByPage.set(id, []);
  namesByPage.get(id).push(m.MS名);
}

// --merge: 기존 weapons.json 을 바탕으로, raw/wiki 에 있는 페이지만 다시 뽑아 덮어쓴다.
// (배포본 증분 업데이트용 — 위키 캐시 전체 없이 새/변경 페이지만 반영)
const DEST = path.join(ROOT, 'data', 'weapons.json');
const MERGE = process.argv.includes('--merge');
const out = MERGE && fs.existsSync(DEST) ? JSON.parse(fs.readFileSync(DEST, 'utf8')) : {};
const baseCount = Object.keys(out).length;
let tableCount = 0, weaponCount = 0, skipped = 0, shieldCount = 0;

for (const f of files) {
  const id = f.replace('.html', '');
  const html = fs.readFileSync(path.join(WIKI, f), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  // 표 직전의 제목을 따라가며 「主兵装 / 副兵装」 구획과 이름 없는 표의 무장명을 잡는다.
  // 각 무장 표는 <div id="table_weapon_XXX"> 로 감싸여 있고, 그 접미사가 무장의 속성이다
  //   _shell=실탄 · _beam=빔 · _close=격투 · _shield=실드 · _etc=기타 (atwiki 렌더가 이 id 로 속성을 색칠한다)
  const marks = [];
  for (const m of html.matchAll(/<h[2-5][^>]*>([\s\S]*?)<\/h[2-5]>|id="table_weapon(\w*)"|<table[\s\S]*?<\/table>/gi)) {
    marks.push({
      at: m.index,
      heading: m[1] !== undefined ? clean(m[1]) : null,
      container: m[2] !== undefined ? m[2] : null,
      table: (m[1] === undefined && m[2] === undefined) ? m[0] : null
    });
  }

  const WEAPON_ATTR = { _shell: 'solid', _beam: 'beam', _close: 'melee', _shield: 'shield', _etc: 'other' };
  const weapons = [];
  const allGrids = [];               // 방향·연격 보정 표를 나중에 찾으려고 전부 모아 둔다
  let section = null, lastHeading = null, curAttr = null;

  for (const mk of marks) {
    // 속성 컨테이너(_close 등)는 curAttr 설정. 데이터 표는 무접미 <div id="table_weapon"> 안에
    // 따로 있으므로, 미인식 접미사('' / _initial 등)에서는 curAttr 을 유지한다.
    if (mk.container !== null) { if (mk.container in WEAPON_ATTR) curAttr = WEAPON_ATTR[mk.container]; continue; }
    if (mk.heading !== null) {
      if (/^(主兵装|副兵装|射撃武器|格闘武器|その他)/.test(mk.heading)) section = mk.heading;
      else lastHeading = mk.heading;
      continue;
    }
    const grid = fixBareLevel(parseTable(mk.table));
    allGrids.push(grid);
    const flat = grid.flat().join(' ');
    const shield = parseShield(grid, section, lastHeading);
    if (shield) { weapons.push(shield); weaponCount++; shieldCount++; continue; }
    // 威力 열이 있는 일반 무장, 또는 威力 없이 リペア(회복)만 있는 버프형 특수병장(サイコフレーム展開 등)
    if (!/威力|リペア/.test(flat)) continue;
    if (/記号|意味/.test(grid[0].join(' '))) { skipped++; continue; }   // 범례 표
    const sp = splitHeader(grid);
    if (!sp) { skipped++; continue; }
    tableCount++;

    // clean() 이 <br> 을 ' / ' 로 남기지만 그게 필요한 곳은 備考뿐이다.
    // 헤더와 나머지 값에서는 되돌려 「15초 / OH복귀」가 열 조회를 깨뜨리지 않게 한다.
    const unbreak = v => String(v == null ? '' : v).split(' / ').join(' ');
    const cols = columnNames(sp.head.map(r => r.map(unbreak)));
    const idx = name => cols.findIndex(c => c === name);
    const find = (...cands) => { for (const c of cands) { const i = idx(c); if (i >= 0) return i; } return -1; };

    const iName = find('武器名');
    const iLv = find('LV');
    // 「威力」「威力/ノン」 외에 다탄 무장의 「威力(x2)」 같은 표기도 받는다
    const iPowFull = cols.findIndex(c => c === '威力/フル');
    const iPow = cols.findIndex((c, i) => i !== iPowFull && /^威力/.test(c));
    // 威力 도 リペア 도 없으면 무장 표가 아니다 (スキル情報·運用 등이 걸리지 않게).
    // リペア만 있는 버프형 특수병장은 위력 없이(=null) 무장으로 남긴다.
    const iRepair = cols.findIndex(c => /^リペア/.test(c));
    if (iPow < 0 && iRepair < 0) { skipped++; continue; }
    const iNote = find('備考');
    const isMelee = cols.some(c => /クールタイム/.test(c));

    const byName = new Map();
    for (const rawRow of sp.body) {
      const row = rawRow.map((v, i) => (i === iNote ? v : unbreak(v)));
      const lvCell = row[iLv >= 0 ? iLv : row.findIndex(c => LV.test(c))];
      const lvm = LV.exec(lvCell || '');
      if (!lvm) continue;
      const wname = (iName >= 0 && row[iName]) ? row[iName] : (lastHeading || '(이름 없음)');
      if (!byName.has(wname)) {
        byName.set(wname, {
          name: wname,
          section: section || '主兵装',
          type: isMelee ? 'melee' : 'shooting',
          attr: curAttr,                 // 컨테이너 id 기반 실제 속성(격투 판정 사격무장 구분용)
          columns: cols.filter(Boolean),
          levels: {}
        });
      }
      const w = byName.get(wname);
      const lvl = { power: iPow >= 0 ? num(row[iPow]) : null, raw: {} };
      if (iPowFull >= 0) lvl.powerCharged = num(row[iPowFull]);
      // 「威力(x2)」처럼 발수가 붙은 표기는 그대로 남겨 화면에서 알려준다
      if (iPow >= 0 && cols[iPow] !== '威力' && cols[iPow] !== '威力/ノン') w.powerLabel = cols[iPow];
      // 이미 따로 담는 열은 raw 에 중복 저장하지 않는다
      // 이름·LV·위력은 따로 담고, DP(획득 비용)는 빌드 계산과 무관해 버린다
      const SKIP = new Set(['武器名', 'LV', '威力', '威力/ノン', '威力/フル', 'DP', '必要DP']);
      cols.forEach((c, i) => { if (c && !SKIP.has(c)) lvl.raw[c] = row[i]; });
      w.levels[lvm[1]] = lvl;
      w._note = iNote >= 0 ? (row[iNote] || '') : '';
    }
    // LV 간 값이 같은 열은 무장 단위로 한 번만 남긴다 (備考·射程 등이 LV마다 중복돼 용량이 커진다)
    for (const w of byName.values()) {
      const lvls = Object.values(w.levels);
      w.info = {};
      for (const c of w.columns) {
        if (c === 'LV' || c === '武器名') continue;
        const first = lvls[0].raw[c];
        if (lvls.every(l => l.raw[c] === first)) {
          if (first) w.info[c] = first;
          for (const l of lvls) delete l.raw[c];
        }
      }
      for (const l of lvls) if (!Object.keys(l.raw).length) delete l.raw;
      // 備考에서 뽑은 배율은 레벨마다 같으므로 무장 단위로 한 번만 둔다
      const mods = parseNote(w._note || w.info['備考'] || '');
      for (const [k, v] of Object.entries(mods)) if (v != null) (w.mods = w.mods || {})[k] = v;
      delete w._note;
      delete w.columns;
      weapons.push(w);
      weaponCount++;
    }
    curAttr = null;   // 이 데이터 표에만 적용 — 다음 무장으로 새지 않게 리셋
  }

  attachMeleeMods(weapons, allGrids);   // 격투 무장에 방향·연격 보정을 붙인다
  tagPsycommu(weapons);                 // 사이코뮤 무장 표시(리로드/OH 단축 파츠가 이걸 노린다)
  if (weapons.length) out[id] = { names: namesByPage.get(id) || [], weapons };
}

fs.writeFileSync(DEST, JSON.stringify(out, null, 1));
const mode = MERGE ? `병합(기존 ${baseCount} → ${Object.keys(out).length}, 이번 갱신 ${files.length}페이지)` : `${Object.keys(out).length}/${files.length}`;
console.log(`페이지 ${mode} · 무장 ${weaponCount}종(실드 ${shieldCount}) · 표 ${tableCount}개 (건너뜀 ${skipped})`);
console.log('→', path.relative(process.cwd(), DEST), (fs.statSync(DEST).size / 1024).toFixed(0) + 'KB');
