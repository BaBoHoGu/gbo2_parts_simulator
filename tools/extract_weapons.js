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

const files = fs.existsSync(WIKI) ? fs.readdirSync(WIKI).filter(f => f.endsWith('.html')) : [];
if (!files.length) {
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

const out = {};
let tableCount = 0, weaponCount = 0, skipped = 0, shieldCount = 0;

for (const f of files) {
  const id = f.replace('.html', '');
  const html = fs.readFileSync(path.join(WIKI, f), 'utf8')
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  // 표 직전의 제목을 따라가며 「主兵装 / 副兵装」 구획과 이름 없는 표의 무장명을 잡는다.
  const marks = [];
  for (const m of html.matchAll(/<h[2-5][^>]*>([\s\S]*?)<\/h[2-5]>|<table[\s\S]*?<\/table>/gi)) {
    marks.push({ at: m.index, heading: m[1] !== undefined ? clean(m[1]) : null, table: m[1] === undefined ? m[0] : null });
  }

  const weapons = [];
  let section = null, lastHeading = null;

  for (const mk of marks) {
    if (mk.heading !== null) {
      if (/^(主兵装|副兵装|射撃武器|格闘武器|その他)/.test(mk.heading)) section = mk.heading;
      else lastHeading = mk.heading;
      continue;
    }
    const grid = parseTable(mk.table);
    const flat = grid.flat().join(' ');
    const shield = parseShield(grid, section, lastHeading);
    if (shield) { weapons.push(shield); weaponCount++; shieldCount++; continue; }
    if (!/威力/.test(flat)) continue;
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
    // 威力 열이 없으면 무장 표가 아니다 (スキル情報·運用 등이 걸리지 않게)
    if (iPow < 0) { skipped++; continue; }
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
          columns: cols.filter(Boolean),
          levels: {}
        });
      }
      const w = byName.get(wname);
      const lvl = { power: num(row[iPow]), raw: {} };
      if (iPowFull >= 0) lvl.powerCharged = num(row[iPowFull]);
      // 「威力(x2)」처럼 발수가 붙은 표기는 그대로 남겨 화면에서 알려준다
      if (cols[iPow] !== '威力' && cols[iPow] !== '威力/ノン') w.powerLabel = cols[iPow];
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
  }

  if (weapons.length) out[id] = { names: namesByPage.get(id) || [], weapons };
}

const dest = path.join(ROOT, 'data', 'weapons.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`페이지 ${Object.keys(out).length}/${files.length} · 무장 ${weaponCount}종(실드 ${shieldCount}) · 표 ${tableCount}개 (건너뜀 ${skipped})`);
console.log('→', path.relative(process.cwd(), dest), (fs.statSync(dest).size / 1024).toFixed(0) + 'KB');
