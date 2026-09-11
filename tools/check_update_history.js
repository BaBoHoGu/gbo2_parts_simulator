// 위키 기체 페이지의 「アップデート履歴」를 읽어, 조정의 **최신값**과 우리 데이터를 대조한다.
//
// 왜 필요한가 — 페이지 위쪽의 스탯표가 조정 뒤 갱신되지 않은 채 남아 있는 일이 잦다.
// gbo2.jp 미러도 같은 값에서 같이 낡아, 「미러와 위키가 같다」가 맞다는 근거가 못 된다.
// 이력에는 「2025/05/29 Lv1：18000 → 19000」 처럼 날짜와 전·후 값이 남아 있어 판정이 된다.
//
//   node tools/check_update_history.js            캐시(raw/wiki)로 전수 대조
//   node tools/check_update_history.js --json     결과를 raw/history_flags.json 으로
//
// ⚠ 결과는 「교정 목록」이 아니라 「확인 필요 목록」이다.
// 이력이 불완전한 경우가 있다(ドム 耐ビーム: 표가 이력보다 전 LV +1 인데 이후 기록 없음).
// 이력만 믿고 자동으로 덮어쓰면 맞는 값을 망친다. 사람이 근거를 하나 더 보고 채택한다.
//
// 파서 뼈대는 Claude Desktop 이 위키 92페이지를 훑어 만든 것을 옮겨 다듬었다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'raw', 'wiki');

// [이력 문구, msData 키]
const STAT_KEYS = [
  [/^(?:機体)?HP/, 'HP'],
  [/^耐実弾(?:補正|装甲値?)/, '耐実弾補正'],
  [/^耐ビーム(?:補正|装甲値?)/, '耐ビーム補正'],
  [/^耐格闘(?:補正|装甲値?)/, '耐格闘補正'],
  [/^射撃補正/, '射撃補正'],
  [/^格闘補正/, '格闘補正'],
  [/^スピード/, 'スピード'],
  [/^高速移動/, '高速移動'],
  [/^スラスター/, 'スラスター'],
  [/^近距離パーツスロット/, '近スロット'],
  [/^中距離パーツスロット/, '中スロット'],
  [/^遠距離パーツスロット/, '遠スロット']
];
// 기체 스탯이 아닌 줄 — 무장·스킬·방패. 이것을 안 거르면 무장 위력이 기체 HP 로 들어온다.
const NOT_STAT = /下格闘補正|威力|スキル|シールドHP|シールド装備時|枚装備|射程|ヒート率|発射間隔|OH復帰|リロード|弾数|集束/;

const flat = h => h
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<\/(td|th)>/g, ' | ').replace(/<\/(tr|p|div|li|br)>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t\u3000]+/g, ' ');

/** 「アップデート履歴」 부터 코멘트欄 앞까지. 첫 수집 때 통째로 빼 두었던 구간이다. */
function historyText(html) {
  const lines = flat(html).split('\n').map(l => l.trim()).filter(Boolean);
  // 제목은 목차에도 한 번 나온다 — 목차를 잡으면 바로 뒤가 「コメント欄」이라 0줄이 된다.
  // 날짜 줄이 뒤따르는 쪽이 본문이다.
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if (!/アップデート履歴/.test(lines[k])) continue;
    const near = lines.slice(k + 1, k + 6).some(l => /^20\d\d\/\d\d\/\d\d/.test(l));
    if (near) { i = k; break; }
    i = k;                       // 못 찾으면 마지막 것을 쓴다
  }
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < lines.length; k++) {
    if (/名無しさん|コメント|^\(20\d\d-\d\d-\d\d/.test(lines[k])) break;
    out.push(lines[k]);
  }
  return out;
}

/** 이력 줄들 → [{date, key, lv, from, to, raw}]. lv 가 null 이면 전 LV. */
function parseHistory(lines) {
  const out = [];
  let date = null;
  for (let raw of lines) {
    let line = raw.replace(/\s*→\s*/g, ' → ').replace(/\s+/g, ' ').trim();
    const dm = line.match(/^(20\d\d\/\d\d\/\d\d)\s*[：:]?\s*(.*)$/);
    if (dm) { date = dm[1]; line = dm[2].replace(/^性能調整\s*/, ''); if (!line) continue; }
    if (!date || !line.includes('→') || NOT_STAT.test(line)) continue;
    // 「変形時」 계열은 우리 데이터에 별도 칸이 없다 — 통상시만 본다.
    if (/変形時|変身時|MA形態/.test(line)) continue;
    const hit = STAT_KEYS.find(([re]) => re.test(line));
    if (!hit) continue;
    const key = hit[1];
    const seg = /(?:(?:LV|Lv)\s*(\d+)(?:\s*[-～~]\s*(\d+))?\s*(?:機体)?)?\s*[：:]?\s*(\d+(?:\.\d+)?)\s*→\s*(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = seg.exec(line))) {
      const from = Number(m[3]), to = Number(m[4]);
      if (m[1]) {
        const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
        for (let lv = a; lv <= b; lv++) out.push({ date, key, lv, from, to, raw: line });
      } else {
        out.push({ date, key, lv: null, from, to, raw: line });
      }
    }
  }
  return out;
}

/**
 * 어떤 LV 의 어떤 키에 대해 **날짜가 가장 늦은** 기록을 고른다.
 *
 * 두 가지를 제대로 해야 한다 — 안 그러면 옛 조정을 최신으로 착각한다.
 *   ① 날짜로 고른다. 페이지에 적힌 순서를 믿지 않는다.
 *   ② 「LV 표기 없음(전 LV)」 기록과 「LVn」 기록을 **같은 줄에서 겨룬다**.
 *      따로 세면 전 LV 기록이 나중 LVn 기록을 이겨 버린다.
 */
function latestFor(changes, key, lv) {
  let best = null;
  for (const c of changes) {
    if (c.key !== key) continue;
    if (c.lv != null && c.lv !== lv) continue;
    if (!best || String(c.date) > String(best.date)) best = c;
  }
  return best;
}

function main() {
  const msData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.json'), 'utf8'));
  let override = {};
  try { override = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'msData.override.json'), 'utf8')); } catch { /* 없어도 된다 */ }

  // 페이지 ID → 그 페이지에 실린 LV 별 기체
  const byPage = new Map();
  for (const m of msData) {
    const url = (override[m.MS名] && override[m.MS名].wiki_url) || m.wiki_url || '';
    const id = (String(url).match(/pages\/(\d+)\.html/) || [])[1];
    if (!id) continue;
    const lv = Number((m.MS名.match(/_LV(\d+)/) || [])[1] || 1);
    if (!byPage.has(id)) byPage.set(id, []);
    byPage.get(id).push({ m, lv });
  }

  const flags = [];
  let pages = 0, withHist = 0;
  for (const [id, list] of byPage) {
    const f = path.join(WIKI, id + '.html');
    if (!fs.existsSync(f)) continue;
    pages++;
    const hist = parseHistory(historyText(fs.readFileSync(f, 'utf8')));
    if (!hist.length) continue;
    withHist++;
    const keys = [...new Set(hist.map(c => c.key))];
    for (const t of list) {
      for (const key of keys) {
        const c = latestFor(hist, key, t.lv);
        if (!c) continue;
        const have = t.m[key];
        if (have == null || Number(have) === c.to) continue;
        flags.push({ page: id, MS名: t.m.MS名, key, ours: Number(have),
          history: c.to, from: c.from, date: c.date,
          // 우리 값이 '조정 전' 값이면 딱 한 번 뒤처진 것 — 가장 확실한 신호다
          staleByOne: Number(have) === c.from,
          raw: c.raw.slice(0, 120) });
      }
    }
  }

  flags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  console.log(`캐시 페이지 ${pages}개 · 이력이 있는 페이지 ${withHist}개`);
  const strong = flags.filter(f => f.staleByOne);
  console.log(`어긋나는 칸 ${flags.length}개 — 그중 '조정 전 값 그대로' ${strong.length}개 (가장 확실)\n`);
  const byMs = new Map();
  for (const f of flags) { if (!byMs.has(f.MS名)) byMs.set(f.MS名, []); byMs.get(f.MS名).push(f); }
  console.log(`대상 기체 ${byMs.size}종 (최근 조정 순, 상위 30종)`);
  let shown = 0;
  for (const [nm, fs2] of byMs) {
    if (shown++ >= 30) break;
    console.log('  ' + nm);
    for (const f of fs2) console.log(`     ${f.key.padEnd(12)} 우리 ${String(f.ours).padStart(6)}  ←→  이력 ${String(f.history).padStart(6)}  (${f.date})`);
  }
  if (process.argv.includes('--json')) {
    const out = path.join(ROOT, 'raw', 'history_flags.json');
    fs.writeFileSync(out, JSON.stringify(flags, null, 1) + '\n', 'utf8');
    console.log('\n→ ' + path.relative(ROOT, out));
  }
}
main();
