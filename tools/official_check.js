// 공식 조정 공지의 「바뀐 뒤 값」 이 지금 데이터와 같은가.
//
//   node tools/official_check.js            어긋난 것을 알린다(경고만 — 배포를 막지 않는다)
//   node tools/official_check.js --all      맞은 것까지 다 보인다
//   node tools/official_check.js --strict   어긋나면 실패로 끝낸다
//
// ■ 왜 — 수치의 근거는 「공식 조정 공지 > 위키 > gbo2.jp」 다(사용자 확인 2026-10-27).
//   데이터는 위키에서 오는데, 위키 표는 사람이 옮겨 적어 반영이 빠진다.
//   FA 유니콘 「脚部特殊緩衝材」 은 공식이 LV3 → LV5 인데 위키 표는 이름표가 LV3 으로 남았다
//   (같은 페이지의 이력 줄은 LV5). 그때까지 공식 값과 데이터를 대조하는 과정이 없었다.
//
// ■ 어떻게 — data/patchnotes.json 에 쌓인 공식 **일본어** 공지(adjusted[].ja)를 읽는다.
//   한국어 공지는 스킬 이름이 사전 표기와 달라 51쌍 중 1쌍만 맞았다. 일본어끼리는 표기만 맞추면 된다
//   (tools/lib/patchnote_jp.js 의 nz — 전각→반각 · ［］→[] · ×２→x2).
//   「「a」→「b」」 꼴의 숫자 줄만 본다 — 「よろけの蓄積値を上昇」 처럼 값이 없는 줄은 잴 것이 없다.
//   같은 기체·항목이 여러 공지에 나오면 **가장 최근 공지**가 이긴다.
//
// ■ 함정
//   · 「LV3機体のスキル…」 — 공지가 **기체 LV** 를 지정한다. LV1 행만 보면 맞는 것 5건이 틀린 것으로 나왔다.
//     지정이 없으면 그 기체의 가장 낮은 LV 다.
//   · 무장 수치는 그 무장의 가장 낮은 LV 값이다(공지가 LV 를 안 적는다).
//   · 威力 는 power 또는 powerCharged(집속 빔) 중 하나와 맞으면 된다.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { nz, noCnt } = require('./lib/patchnote_jp.js');
const ALL = process.argv.includes('--all');
const STRICT = process.argv.includes('--strict');

const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const patches = rd('patchnotes.json').patches || [];
const msData = rd('msData.json');
const S = rd('ms_skills.json');
const W = rd('weapons.json');

const NFC = s => String(s).normalize('NFC');
const lvOfMs = n => Number((String(n).match(/_LV(\d+)$/) || [])[1] || 1);
const msByBase = new Map();
for (const m of msData) {
  const b = NFC(m.MS名).replace(/_LV\d+$/, '');
  if (!msByBase.has(b)) msByBase.set(b, []);
  msByBase.get(b).push(m);
}
const pageOf = b => {
  for (const m of msByBase.get(b) || []) {
    const id = (String(m.wiki_url || '').match(/pages\/(\d+)/) || [])[1];
    if (id) return id;
  }
  return null;
};
const num = s => { const m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const flatSkills = v => (JSON.stringify(v || {}).match(/\{[^{}]*"name"[^{}]*\}/g) || []).map(x => JSON.parse(x));
// msLv 「LV1～」「LV1～2」「LV3～」「LV1」 이 기체 LV n 을 덮는가
const covers = (msLv, n) => {
  const m = String(msLv || 'LV1～').normalize('NFKC').match(/LV(\d+)\s*(~|～)?\s*(\d+)?/);
  if (!m) return true;
  const lo = +m[1], hi = m[3] ? +m[3] : (m[2] ? Infinity : lo);
  return n >= lo && n <= hi;
};

/* ── 공지 줄 → 잴 항목 ─────────────────────────────────────────── */
const MS_STAT = [
  [/^機体HP$/, 'HP'], [/^近距離パーツスロット$/, '近スロット'], [/^中距離パーツスロット$/, '中スロット'],
  [/^遠距離パーツスロット$/, '遠スロット'], [/^スラスター$/, 'スラスター'], [/^スピード$/, 'スピード'],
  [/^高速移動$/, '高速移動'], [/^耐実弾補正$/, '耐実弾補正'], [/^耐ビーム補正$/, '耐ビーム補正'], [/^耐格闘補正$/, '耐格闘補正'],
  [/^射撃補正$/, '射撃補正'], [/^格闘補正$/, '格闘補正'],
];
// 무장 항목 → 데이터에서 값 꺼내기(가장 낮은 LV 의 raw 먼저, 없으면 info)
const infoOf = (w, keys) => {
  const lvs = Object.keys(w.levels || {}).map(Number).sort((a, b) => a - b);
  const raw = lvs.length ? ((w.levels[lvs[0]] || {}).raw || {}) : {};
  const info = {};
  for (const [k, v] of Object.entries(w.info || {})) info[k.replace(/\s+/g, '')] = v;
  const rawN = {};
  for (const [k, v] of Object.entries(raw)) rawN[k.replace(/\s+/g, '')] = v;
  for (const k of keys) { if (rawN[k] != null) return rawN[k]; if (info[k] != null) return info[k]; }
  return null;
};
const WEAPON_STAT = [
  [/^威力$/, w => {
    const lvs = Object.keys(w.levels || {}).map(Number).sort((a, b) => a - b);
    const l = lvs.length ? w.levels[lvs[0]] : {};
    return [l.power, l.powerCharged].filter(v => v != null);
  }],
  // E팩 탄창 빔은 리로드가 「OH復帰時間」 칸에 적힌다(ザンバスター 공식 리로드 12 = 위키 OH復帰 12秒)
  [/^リロード$/, w => [num(infoOf(w, ['リロード時間', 'リロード'])), num(infoOf(w, ['OH復帰時間']))]],
  [/^オーバーヒート$/, w => [num(infoOf(w, ['OH復帰時間']))]],
  // 단발 무장의 쿨타임은 위키 「発射間隔」 칸에 초로 적힌다(H・グレネード 공식 4.0 = 위키 発射間隔 4秒). 「発/分」 은 쿨타임이 아니다
  [/^クールタイム$/, w => [num(infoOf(w, ['クールタイム'])),
    /秒/.test(String(infoOf(w, ['発射間隔']) || '')) ? num(infoOf(w, ['発射間隔'])) : null]],
  [/^弾数$/, w => [num(infoOf(w, ['弾数']))]],
  [/^ヒート率$/, w => [infoOf(w, ['ヒート率']), infoOf(w, ['ヒート率/ノン']), infoOf(w, ['ヒート率/フル'])].map(num)],
  [/^射程距離$/, w => [num(infoOf(w, ['射程']))]],
  [/^シールドHP$/, w => [num(infoOf(w, ['シールドHP', 'HP']))]],
  [/^集束$/, w => [num((String(infoOf(w, ['備考']) || '').match(/集束時間[：:]\s*([\d.]+)/) || [])[1])]],
  // 격투의 「チャージ」(ヘビーアタック 모으기)는 위키 備考에 「集束時間」 으로 적힌다
  [/^チャージ$/, w => [num((String(infoOf(w, ['備考']) || '').match(/(?:チャージ|集束)時間[：:]\s*([\d.]+)/) || [])[1])]],
];

const items = new Map();   // key → 가장 최근 항목
const sorted = patches.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
let lines = 0, used = 0;
for (const pt of sorted) for (const a of (pt.adjusted || [])) {
  const base = NFC(a.ms || '');
  for (const sec of ((a.ja && a.ja.sections) || [])) for (const r of (sec.rows || [])) for (const c0 of (r.changes || [])) {
    lines++;
    const c = String(c0).normalize('NFKC').replace(/^\s*・\s*/, '');
    const msLv = +((c.match(/^LV(\d+)機体の/) || [])[1] || 0);
    // 스킬 LV 상승
    let m = c.match(/スキル「\s*(.+?)\s*LV(\d+)\s*」\s*を\s*「\s*LV(\d+)\s*」\s*に(上昇|低下)/);
    if (m) {
      used++;
      items.set([base, 'skill', m[1], msLv].join('|'),
        { date: pt.date, base, kind: 'skill', name: m[1], msLv, from: +m[2], to: +m[3], line: c });
      continue;
    }
    // 스킬 부여 — 「スキル「X LVn」を付与」 · 「LV2機体にスキル「X LVn」を付与」 · 「⇒LV2機体に「X LVn」を付与」
    m = c.match(/^(?:⇒)?(?:LV(\d+)(?:以上の)?機体に)?(?:スキル)?「\s*(.+?)\s*LV(\d+)\s*」\s*を付与/);
    if (m) {
      used++;
      const n = +(m[1] || msLv || 0);
      items.set([base, 'skill', m[2], n].join('|'),
        { date: pt.date, base, kind: 'skill', name: m[2], msLv: n, from: null, to: +m[3], line: c });
      continue;
    }
    // 「X「a」→「b」」
    m = c.match(/^(?:LV\d+機体の)?(.+?)「\s*([^」]*)\s*」\s*→\s*「\s*([^」]*)\s*」/);
    if (!m) continue;
    const label = m[1].trim(), to = m[3];
    if (r.category === '機体性能') {
      const st = MS_STAT.find(([re]) => re.test(label));
      if (!st) continue;
      used++;
      items.set([base, 'ms', st[1], msLv].join('|'), { date: pt.date, base, kind: 'ms', field: st[1], label, msLv, to, line: c });
    } else if (r.weapon) {
      const st = WEAPON_STAT.find(([re]) => re.test(label));
      if (!st) continue;
      used++;
      items.set([base, 'w', nz(r.weapon), label].join('|'),
        { date: pt.date, base, kind: 'weapon', weapon: r.weapon, label, get: st[1], to, line: c });
    }
  }
}

/* ── 데이터와 맞대기 ────────────────────────────────────────────── */
const same = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-6;
const res = { ok: [], bad: [], miss: [] };
for (const it of items.values()) {
  const mss = msByBase.get(it.base);
  if (!mss) { res.miss.push([it, '데이터에 기체 없음']); continue; }
  if (it.kind === 'skill') {
    const n = it.msLv || Math.min(...mss.map(m => lvOfMs(m.MS名)));
    const named = flatSkills(S[it.base]).filter(s => nz(s.name) === nz(it.name));
    const sk = named.filter(s => covers(s.msLv, n));
    if (!sk.length) {
      /* 다른 기체 LV 행에만 있으면 **데이터가 틀린 것**이다 — 위키 스킬 표의 「LV2～」 가 「LV1～」 이어야 했다
         (헤이즐 아우스라 「オーバーブースト」: 공식·위키 이력 모두 LV1-2 기체인데 표는 LV2～ 에만, 2026-10-27). */
      if (named.length) res.bad.push([it, '기체 LV' + n + ' 에 그 스킬이 없음 — 데이터에는 '
        + named.map(s => s.msLv + ' ' + s.lv).join(' / ') + ' 에만 있다']);
      else res.miss.push([it, '스킬 표에 그 스킬 없음(기체 LV' + n + ')']);
      continue;
    }
    const lvs = [...new Set(sk.map(s => num(s.lv)))];
    (lvs.includes(it.to) ? res.ok : res.bad).push([it, '데이터 LV' + lvs.join('/') + ' (기체 LV' + n + ')']);
  } else if (it.kind === 'ms') {
    const n = it.msLv || Math.min(...mss.map(m => lvOfMs(m.MS名)));
    const m = mss.find(x => lvOfMs(x.MS名) === n);
    if (!m) { res.miss.push([it, '기체 LV' + n + ' 없음']); continue; }
    const have = num(m[it.field]);
    (same(have, num(it.to)) ? res.ok : res.bad).push([it, '데이터 ' + it.field + ' ' + have + ' (기체 LV' + n + ')']);
  } else {
    const id = pageOf(it.base);
    const ws = (id && W[id] && W[id].weapons) || [];
    let w = ws.filter(x => nz(x.name) === nz(it.weapon));
    if (!w.length) w = ws.filter(x => noCnt(x.name) === noCnt(it.weapon));
    if (w.length !== 1) { res.miss.push([it, '무장을 못 맞춤(후보 ' + w.length + ')']); continue; }
    const have = it.get(w[0]).filter(v => v != null);
    if (!have.length) { res.miss.push([it, '데이터에 그 칸이 없음 · ' + w[0].name]); continue; }
    (have.some(v => same(num(v), num(it.to))) ? res.ok : res.bad).push([it, '데이터 ' + have.join('/') + ' · ' + w[0].name]);
  }
}

const show = ([it, why]) => '  ' + it.date + ' ' + it.base + (it.kind === 'weapon' ? ' / ' + it.weapon : '')
  + ' — 공식 「' + it.line + '」 · ' + why;
console.log('공식 조정 공지 ' + patches.length + '개 · 변경 줄 ' + lines + ' · 잴 수 있는 줄 ' + used + ' → 항목 ' + items.size + '개');
console.log('  맞음 ' + res.ok.length + ' · 어긋남 ' + res.bad.length + ' · 못 맞춤 ' + res.miss.length);
if (res.bad.length) { console.log('\n어긋남 — 데이터가 공식과 다르다:'); res.bad.forEach(x => console.log(show(x))); }
if (res.miss.length) { console.log('\n못 맞춤 — 잴 대상을 데이터에서 못 찾았다:'); res.miss.forEach(x => console.log(show(x))); }
if (ALL) { console.log('\n맞음:'); res.ok.forEach(x => console.log(show(x))); }
console.log('\n' + (res.bad.length ? (STRICT ? 'FAIL' : 'WARN') : 'PASS') + ' 공식 대조');
process.exit(STRICT && res.bad.length ? 1 : 0);
