// 공식 대조(official_check)는 앱과 **같은 데이터**를 재는가 — 빌드가 얹는 교정 넷을 대조도 다 얹는지 본다.
//
//   node tools/official_yardstick_check.js
//
// 예전 official_check 는 기체 교정(msData.override.json)에서 wiki_url 만 가져오고, 이력 교정(msData.manual.json) ·
// 이력 반영(history.reflect.json) 은 아예 안 얹었다. 기체 칸 공식값 고정(official.override.json 의 kind:'ms')도
// msData 를 안 넘겨 건너뛰었다. 그래서 위키가 고친 HP · 슬롯이 앱에는 나가는데 대조는 옛 미러값과 대
// 「어긋남」 으로 남았다(ギャプラン（I0） · シルバー・ヘイズ改, 2026-10-31). 반대로 교정이 틀려도 대조가 못 잡는다.
//
// 재는 법 — 임시 폴더에 tools · data 사본을 두고, 지금 「맞음」 인 기체 HP 줄 하나를 골라 그 칸을
// 네 경로로 하나씩 **일부러 틀린 값**으로 얹는다. 대조가 그 경로를 읽는다면 그 줄이 맞음에서 빠져야 한다.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra != null ? '  ' + JSON.stringify(extra) : '')); }
};
const NFC = s => String(s).normalize('NFC');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-yard-'));
try {
  fs.cpSync(path.join(ROOT, 'tools'), path.join(TMP, 'tools'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'data'), path.join(TMP, 'data'), { recursive: true });
  const run = () => execFileSync(process.execPath, [path.join(TMP, 'tools', 'official_check.js'), '--all', '--warn'],
    { encoding: 'utf8', maxBuffer: 64 << 20 });
  const okLines = out => { const i = out.indexOf('\n맞음:'); return i < 0 ? '' : out.slice(i); };
  const rdT = f => JSON.parse(fs.readFileSync(path.join(TMP, 'data', f), 'utf8'));
  const wrT = (f, o) => fs.writeFileSync(path.join(TMP, 'data', f), JSON.stringify(o, null, 1));

  // 「맞음」 인 기체 HP 줄 — 어떤 교정 · 고정도 안 걸린 칸을 고른다(걸려 있으면 뒤 경로가 앞 경로를 덮는다)
  const base0 = run();
  const ov = rdT('msData.override.json');
  const man = (rdT('msData.manual.json').fix) || {};
  const pinned = new Set([].concat(rdT('official.override.json').pins || [], rdT('history.reflect.json').pins || [])
    .filter(p => p.kind === 'ms').map(p => p.ms + '|' + p.field));
  const msNames = new Map(rdT('msData.json').map(m => [NFC(m.MS名), m.MS名]));
  let pick = null;
  for (const l of okLines(base0).split('\n')) {
    const m = l.match(/^  \d{4}-\d\d-\d\d (.+?) — 공식 「(機体HP.*?)」 · 데이터 HP (\d+) \(기체 LV(\d+)\)$/);
    if (!m) continue;
    const key = NFC(m[1]) + '_LV' + m[4], raw = msNames.get(key);
    if (!raw || (ov[raw] && 'HP' in ov[raw]) || (man[raw] && 'HP' in man[raw]) || pinned.has(key + '|HP')) continue;
    pick = { line: l.trim(), key, raw, hp: +m[3] };
    break;
  }
  ok('맞음 인 기체 HP 줄을 고를 수 있다', !!pick);
  if (pick) {
    console.log('  · 고른 줄: ' + pick.line);
    const BAD = pick.hp + 12345;
    const still = () => okLines(run()).includes(pick.line);
    const backup = f => fs.readFileSync(path.join(TMP, 'data', f), 'utf8');
    const restore = (f, s) => fs.writeFileSync(path.join(TMP, 'data', f), s);
    const trial = (label, f, edit) => {
      const s = backup(f); const o = JSON.parse(s); edit(o); wrT(f, o);
      ok(label, !still()); restore(f, s);
    };
    trial('기체 교정(msData.override.json)의 스탯을 대조가 읽는다', 'msData.override.json',
      o => { o[pick.raw] = Object.assign({}, o[pick.raw], { HP: BAD }); });
    trial('이력 교정(msData.manual.json)을 대조가 읽는다', 'msData.manual.json',
      o => { o.fix = o.fix || {}; o.fix[pick.raw] = Object.assign({}, o.fix[pick.raw], { HP: { value: BAD } }); });
    trial('기체 칸 공식값 고정(official.override.json kind:ms)을 대조가 얹는다', 'official.override.json',
      o => { (o.pins = o.pins || []).push({ kind: 'ms', ms: pick.key, field: 'HP', value: BAD, was: pick.hp }); });
    trial('승인된 이력 반영(history.reflect.json)을 대조가 얹는다', 'history.reflect.json',
      o => { o.enabled = true; (o.pins = o.pins || []).push({ kind: 'ms', ms: pick.key, field: 'HP', value: BAD, was: pick.hp, approved: true }); });
    // 손대지 않으면 그대로 맞음 — 위 FAIL 이 사본 탓이 아님을 보인다
    ok('아무것도 안 바꾸면 그 줄은 맞음 그대로', still());
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
