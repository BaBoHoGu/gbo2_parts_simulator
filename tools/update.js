// 신규/변경 기체를 감지해 데이터를 받고 추출·재빌드까지 자동으로 한다.
//   node tools/update.js            감지 → 변경 있으면 받기·추출·재빌드
//   node tools/update.js --check    감지만 하고 리포트 (반영 안 함)
//
// 출처
//   기체 스탯·wiki_url : https://gbo2.jp/data/msData.json  (공식 데이터 미러)
//   커스텀 파츠·강화   : gbo2.jp 앱 번들 (/assets/index-*.js)
//   무장·스킬·격투방향 : 일본 위키 (raw/wiki, msData 의 wiki_url 로 받음)
//   이미지             : gbo2.jp/images
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REMOTE = path.join(ROOT, 'raw', 'remote');
const CHECK_ONLY = process.argv.includes('--check');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const rdJson = (...p) => JSON.parse(rd(...p));

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const run = (script, args = []) => {
  console.log(`\n▶ ${script} ${args.join(' ')}`.trimEnd());
  execFileSync(process.execPath, [path.join('tools', script), ...args], { cwd: ROOT, stdio: 'inherit' });
};

const pageId = url => (String(url || '').match(/pages\/(\d+)\.html/) || [])[1];
// 변경 감지에 쓰는 계산 관련 필드 (표기·설명 등 잡음은 뺀다)
const STAT_KEYS = ['属性', 'コスト', 'HP', '耐実弾補正', '耐ビーム補正', '耐格闘補正',
  '射撃補正', '格闘補正', 'スピード', '高速移動', 'スラスター',
  '旋回_地上_通常時', '旋回_宇宙_通常時', '近スロット', '中スロット', '遠スロット'];

(async () => {
  fs.mkdirSync(REMOTE, { recursive: true });
  console.log('■ gbo2.jp 최신 데이터를 확인합니다…');

  // 1) 원격 msData 내려받아 비교
  const remoteBuf = await get('https://gbo2.jp/data/msData.json');
  fs.writeFileSync(path.join(REMOTE, 'msData.json'), remoteBuf);
  const remote = JSON.parse(remoteBuf.toString('utf8'));
  const local = rdJson('data', 'msData.json');

  const localByName = new Map(local.map(m => [m.MS名, m]));
  const remoteNames = new Set(remote.map(m => m.MS名));

  const added = remote.filter(m => !localByName.has(m.MS名));
  const removed = local.filter(m => !remoteNames.has(m.MS名));
  const changed = [];
  for (const m of remote) {
    const o = localByName.get(m.MS名);
    if (!o) continue;
    const diff = STAT_KEYS.filter(k => m[k] !== o[k]);
    if (diff.length) changed.push({ ms: m, diff });
  }

  // 2) 앱 번들(파츠·강화) 변경 확인 — 번들을 받아 임시 폴더에 추출하고 내용을 실제 대조한다
  let partsChanged = false, remoteAppOk = false;
  try {
    const home = (await get('https://gbo2.jp/')).toString('utf8');
    const asset = (home.match(/\/assets\/index-[\w-]+\.js/) || [])[0];
    if (asset) {
      const bundle = await get('https://gbo2.jp' + asset);
      fs.writeFileSync(path.join(REMOTE, 'app.js'), bundle);
      remoteAppOk = true;
      const tmp = path.join(REMOTE, 'extract');
      fs.mkdirSync(tmp, { recursive: true });
      execFileSync(process.execPath,
        [path.join('tools', 'extract_data.js'), path.join(REMOTE, 'app.js'), tmp],
        { cwd: ROOT, stdio: 'ignore' });
      const same = f => fs.existsSync(path.join(tmp, f)) &&
        fs.readFileSync(path.join(tmp, f), 'utf8') === fs.readFileSync(path.join(ROOT, 'data', f), 'utf8');
      partsChanged = !(same('parts.json') && same('fullst.json'));
      const cnt = j => Object.values(JSON.parse(fs.readFileSync(path.join(tmp, j), 'utf8'))).reduce((a, b) => a + b.length, 0);
      const localCnt = Object.values(rdJson('data', 'parts.json')).reduce((a, b) => a + b.length, 0);
      console.log(`  파츠: 현재 ${localCnt}개 / 원격 ${cnt('parts.json')}개` + (partsChanged ? '  ← 변경' : ''));
    }
  } catch (e) {
    console.log('  (앱 번들 확인 건너뜀: ' + e.message + ')');
  }

  // 3) 리포트
  console.log('\n■ 변경 요약');
  console.log(`  기체  현재 ${local.length} / 원격 ${remote.length}`);
  console.log(`  신규  ${added.length}`);
  added.forEach(m => console.log(`     + ${m.MS名}  (${m.属性} 코스트${m.コスト})  ${m.wiki_url}`));
  console.log(`  스탯 변경  ${changed.length}`);
  changed.slice(0, 20).forEach(c => console.log(`     ~ ${c.ms.MS名}: ${c.diff.map(k => k + ' ' + localByName.get(c.ms.MS名)[k] + '→' + c.ms[k]).join(', ')}`));
  if (changed.length > 20) console.log(`     … 외 ${changed.length - 20}건`);
  console.log(`  삭제  ${removed.length}` + (removed.length ? '  ' + removed.slice(0, 5).map(m => m.MS名).join(', ') : ''));
  console.log(`  파츠 변경  ${partsChanged ? '있음' : '없음'}`);

  const nothing = !added.length && !changed.length && !removed.length && !partsChanged;
  if (nothing) { console.log('\n✔ 이미 최신 상태입니다.'); return; }
  if (CHECK_ONLY) { console.log('\n(--check: 감지만 하고 반영하지 않았습니다. 반영하려면 --check 없이 실행하세요.)'); return; }

  // 4) 반영 — 변경 종류에 따라 필요한 단계만 실행한다.
  console.log('\n■ 변경을 반영합니다…');
  const msChanged = added.length || changed.length || removed.length;

  // (a) 파츠·강화 (앱 번들이 바뀐 경우)
  if (partsChanged && fs.existsSync(path.join(REMOTE, 'app.js'))) {
    fs.copyFileSync(path.join(REMOTE, 'app.js'), path.join(ROOT, 'raw', 'app.js'));
    run('extract_data.js');
  }

  // (b) 기체(스탯·신규·삭제)가 바뀐 경우에만 msData 교체 + 위키·무장·스킬 갱신
  if (msChanged) {
    fs.copyFileSync(path.join(REMOTE, 'msData.json'), path.join(ROOT, 'data', 'msData.json'));

    // 변경된 기체의 위키 캐시는 지워 다시 받게 한다 (신규는 캐시에 없어 자동으로 받는다)
    const wikiDir = path.join(ROOT, 'raw', 'wiki');
    let refetch = 0;
    for (const c of changed) {
      const id = pageId(c.ms.wiki_url);
      const f = id && path.join(wikiDir, id + '.html');
      if (f && fs.existsSync(f)) { fs.rmSync(f); refetch++; }
    }
    if (refetch) console.log(`  변경 기체 위키 캐시 ${refetch}개 삭제 (재수신 대상)`);

    // 새·변경 기체의 위키 페이지 ID만 골라 그것만 받는다 (배포본은 캐시가 비어 있으므로
    // 전체를 받지 않도록 반드시 --pages 로 한정한다).
    const targetIds = [...new Set([...added, ...changed.map(c => c.ms)]
      .map(m => pageId(m.wiki_url)).filter(Boolean))];

    // 위키 받기 → 무장·스킬 추출(증분 병합) → 무장명 한글화 → 이미지
    // --merge: 위키 캐시 전체 없이 새/변경 페이지만 기존 데이터에 덮어쓴다(배포본 대응).
    if (targetIds.length) run('fetch_wiki.js', ['--pages=' + targetIds.join(',')]);
    run('extract_weapons.js', ['--merge']);
    run('find_buff_skills.js', ['--ui', '--merge']);
    run('build_weapon_i18n.js');
    run('fetch_images.js');
  }

  // (c) 언제나 재빌드
  run('build.js');

  // 5) 마무리 리포트 — 새 기체 한글명은 사람이 확인해야 한다
  const msDict = rdJson('data', 'i18n', 'ms.json');
  const base = n => n.replace(/_LV\d+$/, '');
  const needKo = [...new Set(added.map(m => base(m.MS名)))].filter(n => !msDict[n]);
  console.log('\n✔ 반영 완료.');
  if (needKo.length) {
    console.log(`\n※ 새 기체 ${needKo.length}종은 한글명 사전(data/i18n/ms.json)에 없어 일본어로 표시됩니다.`);
    console.log('  다음을 ms.json 에 추가하면 한글로 나옵니다:');
    needKo.forEach(n => console.log(`     "${n}": "",`));
  }
})().catch(e => { console.error('\n✗ 업데이트 실패:', e.message); process.exit(1); });
