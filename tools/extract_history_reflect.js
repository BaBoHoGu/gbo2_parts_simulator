// 위키 기체 페이지 하단 「アップデート履歴」 에만 적고 **표는 안 고친 칸**을 찾아 data/history.reflect.json 에 쓴다.
//
//   node tools/extract_history_reflect.js           찾아서 쓴다(enabled 는 파일에 있던 값을 그대로 둔다)
//   node tools/extract_history_reflect.js --list    쓸 내용을 다 보인다(반영 · 모호해서 뺌 · 그 밖에 다름)
//   node tools/extract_history_reflect.js --print   쓰지 않고 보이기만
//
// ■ 왜 — 위키 편집자가 조정 내용을 하단 이력에만 적고 위 표를 안 고치는 일이 있다(사용자 지적 2026-10-27).
//   첫 전수 대조(캐시 607쪽, 이력 항목 6,611): 맞음 6,547 · 표가 이력의 「바뀌기 전」 값에 멈춤 42칸(26기).
//   예: ハンマ・ハンマ 3連装メガ粒子砲 2026-07-23 「Lv1：1300 → 1400 … Lv4：1600 → 1700」 인데 표는 1300~1600.
//
// ■ 무엇을 반영하나 — **좁게** 잡는다.
//   · 표 값이 이력의 「바뀌기 전」 값과 **정확히** 같은 칸만(표가 다른 값이면 무슨 사정인지 모른다 — 손대지 않는다)
//   · 같은 대상(무장 · 항목 · 집속/비집속 · LV)은 **가장 최근 날짜**만
//   · 이력 줄이 모호하면 빼고 알리기만 — 한 줄에 같은 LV 가 두 번(「Lv2：600 → 700 Lv2：700 → 800」),
//     범위가 겹침(「Lv1-3：60 → 65 Lv2：65 → 70」). 이력도 사람이 옮겨 적어 오기가 있다.
//   빌드는 공식값 고정 **뒤에** 이 파일을 얹는다(dataset.js applyHistoryReflect) — 같은 칸이면 공식이 이긴다.
//   위키가 표를 고치면 그 칸은 was 가 안 맞아 저절로 할 일이 없어진다.
//
// 받아 둔 캐시(raw/wiki/*.html)만 읽는다. 캐시는 커밋하지 않으므로 결과를 파일로 남긴다(빌드가 어느 PC 에서나 같게).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const H = require('./lib/wiki_history.js');
const JP = require('./lib/patchnote_jp.js');
const D = require('./lib/dataset.js');
const LIST = process.argv.includes('--list');
const PRINT = process.argv.includes('--print');
const DEST = path.join(ROOT, 'data', 'history.reflect.json');

const rd = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
// 빌드가 보는 것과 같은 기체 데이터로 맞댄다 — 추가 기체 · 위키 스탯 교정 · 이력 손고정을 같은 순서로 얹는다.
// (안 얹었더니 손고정이 이미 고친 10칸이 「표가 낡음」 으로 나왔다, 2026-10-27)
const msData = require('./lib/msdata.js').applyWikiOverride(rd('msData.json'), ROOT);
D.mergeMsAdditions(ROOT, msData);
D.applyMsOverride(ROOT, msData);
D.applyMsManual(ROOT, msData);
const W = rd('weapons.json'), S = rd('ms_skills.json');
// 공식값 고정을 먼저 얹은 상태에서 찾는다 — 빌드와 같은 순서(공식이 고친 칸은 여기서 다시 안 건드린다)
D.applyOfficialPins(ROOT, { weapons: W, msSkills: S, msData });

const gz = s => String(s).replace(/Ζ/g, 'Z');   // 위키 그리스 Ζ ↔ 표기 흔들림
const nz = s => JP.nz(gz(s));
const num = s => { const m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const lvOf = n => Number((String(n).match(/_LV(\d+)$/) || [])[1] || 1);
const fmt = n => String(Math.round(n * 1000) / 1000);

const pages = new Map();
for (const m of msData) {
  const id = (String(m.wiki_url || '').match(/pages\/(\d+)/) || [])[1];
  if (!id) continue;
  const b = String(m.MS名).normalize('NFC').replace(/_LV\d+$/, '');
  if (!pages.has(id)) pages.set(id, { base: b, lv: new Map() });
  pages.get(id).lv.set(lvOf(m.MS名), m);
}

const MS_STAT = [[/^機体HP/, 'HP'], [/^近距離パーツスロット/, '近スロット'], [/^中距離パーツスロット/, '中スロット'], [/^遠距離パーツスロット/, '遠スロット'],
  [/^スラスター(?!消費)/, 'スラスター'], [/^スピード/, 'スピード'], [/^高速移動(?!.*消費)/, '高速移動'], [/^耐実弾補正/, '耐実弾補正'], [/^耐ビーム補正/, '耐ビーム補正'],
  [/^耐格闘補正/, '耐格闘補正'], [/^射撃補正/, '射撃補正'], [/^格闘補正/, '格闘補正']];
const infoKey = (w, k) => Object.keys(w.info || {}).find(x => x.replace(/\s+/g, '') === k);
/* 무장 항목 — 칸 고르기(cell)는 { get, path, write(to) } 를 낸다. 시간 칸은 원문 문자열의 숫자만 바꾼다(「18秒」 → 「15秒」) */
const strCell = (w, k) => { const key = infoKey(w, k); if (!key) return null; const was = w.info[key];
  return { get: num(was), path: 'info.' + key, was, write: to => String(was).replace(/-?\d+(?:\.\d+)?/, fmt(to)) }; };
const W_STAT = [
  { re: /^威力/, perLv: true, cell: (w, lv, q, from) => {
    const l = (w.levels || {})[lv]; if (!l) return null;
    const k = q === 'c' ? 'powerCharged' : q === 'n' ? 'power' : (l.power === from || l.powerCharged == null ? 'power' : 'powerCharged');
    if (l[k] == null) return null;
    return { get: l[k], path: 'levels.' + lv + '.' + k, was: l[k], write: to => to };
  } },
  // 리로드와 OH 복귀도 같은 대상 — 무장마다 둘 중 한 칸만 있고, E팩 빔은 리로드를 「OH復帰時間」 칸에 적는다
  { re: /^リロード時間|^リロード|^オーバーヒート復帰時間|^OH復帰時間/,
    cell: w => strCell(w, 'リロード時間') || strCell(w, 'リロード') || strCell(w, 'OH復帰時間') },
  /* 「クールタイム」 와 「発射間隔」 은 **같은 대상**으로 묶는다 — 단발 무장의 쿨타임은 표의 「発射間隔」 칸에 초로 적히고,
     이력은 같은 칸을 두 이름으로 부른다. 따로 묶었더니 ユニコーンガンダム ビーム・マグナム 이
     2022 「発射間隔延長 5→6」 만 보고 2024 「クールタイム短縮 6→5」 를 못 봐 6초로 되돌릴 뻔했다(사용자 지적 2026-10-27). */
  { re: /^クールタイム|^発射間隔/, cell: w => strCell(w, 'クールタイム')
    || (c => c && /秒/.test(c.was) ? c : null)(strCell(w, '発射間隔')) },
  { re: /^集束時間|^チャージ時間/, cell: w => {
    const key = infoKey(w, '備考'); if (!key) return null; const was = w.info[key];
    // 단위(秒)까지 조각에 넣는다 — 「集束時間：4」 로 끊으면 「集束時間：45秒」 에도 걸린다
    const m = String(was).match(/集束時間[：:]\s*([\d.]+)秒?/); if (!m) return null;
    // 備考 는 긴 문장이라 **조각만** 고정한다(dataset.js applyPins 의 sub) — 통째로 박으면 위키의 다른 글자 수정에 깨진다
    return { get: Number(m[1]), path: 'info.' + key, was, write: to => String(was).replace(m[0], m[0].replace(m[1], fmt(to))),
      sub: to => ({ from: m[0], to: m[0].replace(m[1], fmt(to)) }) };
  } },
];
// 「Lv1：a → b Lv2-3：c → d」 또는 「a → b」. 한 줄에 같은 LV 가 두 번이면 모호하다
const pairsOf = text => {
  const t = String(text).normalize('NFKC'), out = [];
  for (const m of t.matchAll(/Lv\s*(\d+)(?:\s*-\s*(\d+))?\s*[：:]\s*([\d.,]+)\s*(?:%|秒|m)?\s*→\s*([\d.,]+)/gi))
    for (let n = +m[1]; n <= +(m[2] || m[1]); n++) out.push({ lv: n, from: num(m[3]), to: num(m[4]) });
  if (!out.length) { const m = t.match(/^([\d.,]+)\s*(?:%|秒|m|発)?\s*→\s*([\d.,]+)/); if (m) out.push({ lv: 0, from: num(m[1]), to: num(m[2]) }); }
  const seen = new Set(); let dup = false;
  for (const p of out) { if (seen.has(p.lv)) dup = true; seen.add(p.lv); }
  return { pairs: out, ambiguous: dup };
};

const items = new Map();
for (const [id, pg] of pages) {
  let dated;
  try { dated = H.datedEntries(id); } catch { continue; }
  if (!dated) continue;
  const ws = (W[id] && W[id].weapons) || [];
  for (const e of dated) {                    // 오래된 것 → 새것. 같은 열쇠는 뒤가 덮는다(가장 최근이 이긴다)
    let lines; try { lines = H.changesOn(id, e.date) || []; } catch { continue; }
    let top = null, label = null, qual = null;
    for (const l of lines) {
      const t = String(l.text).normalize('NFKC');
      if (l.depth === 0) { top = t; label = null; qual = null; }
      else if (l.depth === 1) { label = t; qual = null; }
      const { pairs, ambiguous } = pairsOf(t);
      /* 집속 단계 — 표에는 집속 값이 한 칸뿐(1단계째). 「集束2段階目」 등은 표에 칸이 없다 → 'x' 로 두고 안 잰다.
         안 그러면 ハンマ・ハンマ 3連装メガ粒子砲 7/23 「2段階目 Lv1：1300 → 1400」 의 「바뀌기 전」 1300 이
         1단계째의 바뀐 뒤 값(=표 1300)과 우연히 같아 「표가 낡음」 으로 잡혔다(2026-10-27). */
      // 「※」 뒤는 「조정 없음」 쪽이다 — 「集束 ※非集束時は調整無し」 는 집속이 대상. 앞부분만 본다(통째로 보면 「非集束」 에 걸렸다)
      const qOf = s0 => { const s = String(s0).split('※')[0];
        return /[2-9２-９]\s*段階/.test(s) ? 'x' : /非集束/.test(s) ? 'n' : /集束/.test(s) ? 'c' : null; };
      if (l.depth >= 2 && !pairs.length) qual = qOf(t) || qual;
      if (!pairs.length || !top) continue;
      /* LV 표기 없는 한 값(「20000 → 18000」)은 가장 낮은 LV 로 본다 — 「Lv1：18000 → 20000」 과 **같은 대상**이어야
         나중 것이 앞의 것을 덮는다. エンゲージゼロ・ヨンファヴィン HP 가 2025-01 하향 뒤 2025-12 원복됐는데
         열쇠가 갈려 하향으로 되돌릴 뻔했다(2026-10-27). */
      const low = Math.min(...pg.lv.keys());
      const st = l.depth === 1 && MS_STAT.find(([re]) => re.test(top));
      if (st) {
        for (const p0 of pairs) { const p = { ...p0, lv: p0.lv || low }; items.set([id, 'ms', st[1], p.lv].join('|'),
          { id, date: e.date, base: pg.base, kind: 'ms', field: st[1], ...p, ambiguous, line: top + ' ' + t }); }
        continue;
      }
      const w = ws.filter(x => nz(x.name) === nz(top));
      if (w.length !== 1 || !label) continue;
      const k = W_STAT.findIndex(s => s.re.test(label));
      if (k < 0) continue;
      const q = qOf(t) || qual;
      if (q === 'x') continue;
      // 위력은 LV 별 — LV 없는 한 값은 무장의 가장 낮은 LV 로(위와 같은 까닭). 시간 칸은 LV 가 없다(0)
      const wLow = Math.min(...Object.keys(w[0].levels || { 1: 0 }).map(Number));
      for (const p0 of pairs) { const p = { ...p0, lv: W_STAT[k].perLv ? (p0.lv || wLow) : 0 };
        items.set([id, 'w', w[0].name, k, q, p.lv].join('|'),
          { id, date: e.date, base: pg.base, kind: 'w', w: w[0], stat: W_STAT[k], q, ...p, ambiguous, line: top + ' › ' + label + ' › ' + t }); }
    }
  }
}

const pins = [], amb = [], other = [];
let ok = 0;
for (const it of items.values()) {
  const pg = pages.get(it.id);
  if (it.kind === 'ms') {
    const lvs = it.lv ? [it.lv] : [Math.min(...pg.lv.keys())];   // LV 없는 한 값은 가장 낮은 LV 만(LV 마다 다른 칸이 있다)
    for (const lv of lvs) {
      const m = pg.lv.get(lv); if (!m || num(m[it.field]) == null) continue;
      const have = num(m[it.field]);
      if (have === it.to) { ok++; continue; }
      const row = { it, lv, have };
      if (have !== it.from) { other.push(row); continue; }
      if (it.ambiguous) { amb.push(row); continue; }
      pins.push({ kind: 'ms', ms: String(m.MS名).normalize('NFC'), field: it.field,
        value: typeof m[it.field] === 'number' ? it.to : fmt(it.to), was: m[it.field], date: it.date, src: '위키 ' + it.id + ' 이력 ' + it.date + ' 「' + it.line + '」' });
    }
  } else {
    const lvs = it.stat.perLv ? (it.lv ? [it.lv] : Object.keys(it.w.levels || {}).map(Number).slice(0, 1)) : [0];
    for (const lv of lvs) {
      const c = it.stat.cell(it.w, lv, it.q, it.from); if (!c || c.get == null) continue;
      if (c.get === it.to) { ok++; continue; }
      const row = { it, lv, have: c.get };
      if (c.get !== it.from) { other.push(row); continue; }
      if (it.ambiguous) { amb.push(row); continue; }
      pins.push({ kind: 'weapon', page: it.id, weapon: it.w.name, path: c.path,
        ...(c.sub ? { sub: c.sub(it.to) } : { value: c.write(it.to), was: c.was }),
        date: it.date, ms: it.base, src: '위키 ' + it.id + ' 이력 ' + it.date + ' 「' + it.line + '」' });
    }
  }
}
// 같은 칸에 두 줄이 걸리면(같은 備考 를 두 항목이 고침 등) 앞의 것만 — 뒤 것은 was 가 안 맞아 어차피 안 걸린다
const seen = new Set();
const uniq = pins.filter(p => { const k = JSON.stringify([p.kind, p.ms, p.page, p.weapon, p.path, p.field]); if (seen.has(k)) return false; seen.add(k); return true; });

/* 「그 밖에 다름」 을 방향으로 가른다 — 바뀐 방향(to − from)으로 봐서
     앞섬: 표가 바뀐 뒤보다 더 나아갔다(그 뒤 조정이 또 있었는데 이력 꼴이 달라 못 읽었을 가능성이 크다 — 표가 맞을 공산)
     뒤처짐: 표가 바뀌기 전보다도 더 뒤다(조정을 두 번 이상 놓친 칸일 수 있다 — 가장 의심스럽다)
     엇갈림: 그 밖(단위 · 해석 · 이력 오기) */
const dirOf = r => {
  const d = r.it.to - r.it.from;
  if (!d) return 'odd';
  if (Math.sign(r.have - r.it.to) === Math.sign(d)) return 'ahead';
  if (Math.sign(r.it.from - r.have) === Math.sign(d)) return 'behind';
  return 'odd';
};
const show = r => '  ' + r.it.date + ' ' + r.it.base + (r.lv ? ' LV' + r.lv : '') + ' — 「' + r.it.line + '」 · 표 ' + r.have;
console.log('위키 이력 항목 ' + items.size + ' · 맞음 ' + ok + ' · 반영 ' + uniq.length + '칸(' + new Set(uniq.map(p => p.ms)).size + '기)'
  + ' · 모호해서 뺌 ' + amb.length + ' · 그 밖에 다름 ' + other.length);
if (LIST || PRINT) {
  console.log('\n[반영]'); for (const p of uniq) console.log('  ' + p.date + ' ' + p.ms + ' · ' + (p.weapon ? p.weapon + ' ' + p.path : p.field)
    + ' : ' + JSON.stringify(p.was).slice(0, 30) + ' → ' + JSON.stringify(p.value).slice(0, 30));
  console.log('\n[모호해서 뺌 — 이력 줄 오기]'); amb.forEach(r => console.log(show(r)));
  if (LIST) {
    const by = { behind: [], odd: [], ahead: [] };
    for (const r of other) by[dirOf(r)].push(r);
    console.log('\n[그 밖에 다름 — 손대지 않음] 뒤처짐 ' + by.behind.length + ' · 엇갈림 ' + by.odd.length + ' · 앞섬 ' + by.ahead.length);
    for (const [k, name] of [['behind', '뒤처짐 — 표가 바뀌기 전보다도 뒤(조정을 여러 번 놓쳤을 수 있다)'], ['odd', '엇갈림 — 단위 · 해석 · 이력 오기'], ['ahead', '앞섬 — 표가 이력보다 더 나아감(표가 맞을 공산)']]) {
      console.log('\n  ── ' + name);
      by[k].sort((a, b) => b.it.date.localeCompare(a.it.date)).forEach(r => console.log(show(r)));
    }
  }
}
if (!PRINT) {
  const prev = fs.existsSync(DEST) ? JSON.parse(fs.readFileSync(DEST, 'utf8')) : {};
  /* 확인 표시(approved)를 이어받는다. 열쇠는 칸 + 이력 날짜 — 값 꼴(통째 → 조각)이 바뀌어도 같은 칸 같은 이력이면 같은 것.
     approved 가 없던 옛 파일은 켜져 있었으면(enabled) 그 칸들을 확인한 것으로 본다(2026-10-27 사람이 목록을 보고 켰다). */
  const keyOf = p => JSON.stringify([p.kind, p.ms, p.page, p.weapon, p.path, p.field, p.date]);
  const okPrev = new Set((prev.pins || []).filter(p => p.approved === true || (p.approved == null && prev.enabled)).map(keyOf));
  const APPROVE = process.argv.includes('--approve');
  for (const p of uniq) p.approved = APPROVE || okPrev.has(keyOf(p));
  const pending = uniq.filter(p => !p.approved);
  fs.writeFileSync(DEST, JSON.stringify({
    _주석: [
      '위키 하단 이력에만 적고 표는 안 고친 칸 — tools/extract_history_reflect.js 가 만든다(손으로 고치지 말 것).',
      '표 값이 이력의 「바뀌기 전」 값일 때만 「바뀐 뒤」 값으로(was · 備考 는 조각 sub). 빌드는 공식값 고정 뒤에 얹는다.',
      'enabled 를 true 로 해야 빌드가 얹는다 — 목록을 사람이 확인한 뒤 켠다(2026-10-27).',
      '빌드는 approved 인 칸만 얹는다. 새로 찾은 칸은 false — history_reflect_check 가 배포 요약에 알리고,',
      '사람이 목록(--list)을 보고 node tools/extract_history_reflect.js --approve 로 승인한다(2026-10-28).',
    ],
    enabled: !!prev.enabled,
    pins: uniq,
    ambiguous: amb.map(r => ({ ms: r.it.base, lv: r.lv, line: r.it.line, date: r.it.date, have: r.have })),
  }, null, 1) + '\n');
  console.log('→ data/history.reflect.json (enabled ' + !!prev.enabled + ' · 확인 ' + (uniq.length - pending.length) + ' · 확인 전 ' + pending.length + ')');
  for (const p of pending) console.log('  · 확인 전: ' + p.date + ' ' + p.ms + ' · ' + (p.weapon ? p.weapon + ' ' + p.path : p.field)
    + ' : ' + JSON.stringify(p.sub ? p.sub.from : p.was).slice(0, 30) + ' → ' + JSON.stringify(p.sub ? p.sub.to : p.value).slice(0, 30));
}
