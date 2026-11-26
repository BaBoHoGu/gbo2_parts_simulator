// 같은 날짜의 공식 한국어 글 ↔ 일본어 글을 바르게 짝짓는가 (tools/lib/patchnote_parse.js pairArticles).
//   node tools/notice_pair_check.js
//
// ■ 왜 — 2026-11-26 조정은 글이 셋(범용 · 강습 · 지원)이었다. 한국어판은 글 번호가 범용 → 지원 으로 **줄고**
//   일본어판은 **는다**. 번호 순으로 짝짓던 탓에 한국어 지원 ↔ 일본어 범용이 붙어 22기가 엇갈렸다
//   (한국어 「유니콘 건담」 ↔ 일본어 「풀 아머 건담[타입 B]」). 2024-11-21 도 같은 꼴이었다(그때는 기체 수가 달라 걸러졌다).
//   제목의 타입 꼬리표로 짝짓는다. 아래 글 번호 · 제목은 실제 공지 그대로다.
'use strict';
const path = require('path');
const P = require(path.join(__dirname, 'lib', 'patchnote_parse.js'));

let pass = 0, fail = 0;
const ok = (label, good, extra) => {
  console.log((good ? '  PASS ' : '  FAIL ') + label + (!good && extra !== undefined ? '  — ' + JSON.stringify(extra) : ''));
  good ? pass++ : fail++;
};
const pairsOf = (ks, js) => { const r = P.pairArticles(ks, js); return r.pairs ? Object.fromEntries(r.pairs) : r; };

/* ① 2026-11-26 — 번호 순서가 KR/JP 거꾸로 */
{
  const kr = [
    { id: '202469', title: '유닛 관련 조정 【범용 타입】<2026년 11월 실시>' },
    { id: '202457', title: '유닛 관련 조정 【강습 타입】<2026년 11월 실시>' },
    { id: '202445', title: '유닛 관련 조정 【지원 타입】<2026년 11월 실시>' }];
  const jp = [
    { id: '201847', title: 'ユニット関連の調整 【汎用タイプ】＜2026年11月実施＞' },
    { id: '201848', title: 'ユニット関連の調整 【強襲タイプ】＜2026年11月実施＞' },
    { id: '201849', title: 'ユニット関連の調整 【支援タイプ】＜2026年11月実施＞' }];
  const p = pairsOf(kr, jp);
  ok('2026-11-26 범용 ↔ 汎用', p['202469'] === '201847', p);
  ok('2026-11-26 강습 ↔ 強襲', p['202457'] === '201848', p);
  ok('2026-11-26 지원 ↔ 支援 (번호 순이면 汎用 과 붙었다)', p['202445'] === '201849', p);
  ok('글 목록 순서를 섞어도 같다', pairsOf([...kr].reverse(), jp)['202445'] === '201849');
}
/* ② 2024-11-21 — KR 번호가 강습 < 범용 < 지원 */
{
  const kr = [{ id: '158156', title: '유닛 관련 조정 【범용 타입】 <2024년 11월 실시>' },
    { id: '158140', title: '유닛 관련 조정 【강습 타입】 <2024년 11월 실시>' },
    { id: '158165', title: '유닛 관련 조정 【지원 타입】 <2024년 11월 실시>' }];
  const jp = [{ id: '157040', title: 'ユニット関連の調整 【汎用タイプ】＜2024年11月実施＞' },
    { id: '157349', title: 'ユニット関連の調整 【強襲タイプ】＜2024年11月実施＞' },
    { id: '157351', title: 'ユニット関連の調整 【支援タイプ】＜2024年11月実施＞' }];
  const p = pairsOf(kr, jp);
  ok('2024-11-21 강습 ↔ 強襲 · 범용 ↔ 汎用', p['158140'] === '157349' && p['158156'] === '157040', p);
}
/* ③ 꼬리표가 없는 날은 예전처럼 번호 순 */
{
  const p = pairsOf([{ id: '20', title: '유닛 관련 조정 <2026년 10월 실시>' }], [{ id: '10', title: 'ユニット関連の調整 ＜2026年10月実施＞' }]);
  ok('꼬리표 없는 글 하나 ↔ 하나', p['20'] === '10', p);
}
/* ④ 모르면 짝짓지 않는다 — 틀린 짝보다 일본어판 없는 쪽이 낫다 */
{
  const r1 = P.pairArticles([{ id: '1', title: '【범용 타입】' }, { id: '2', title: '조정' }], [{ id: '3', title: '【汎用タイプ】' }, { id: '4', title: '【支援タイプ】' }]);
  ok('꼬리표가 한쪽에만 있으면 짝짓지 않는다', r1.pairs === null, r1);
  const r2 = P.pairArticles([{ id: '1', title: '【범용 타입】' }, { id: '2', title: '【강습 타입】' }], [{ id: '3', title: '【汎用タイプ】' }, { id: '4', title: '【支援タイプ】' }]);
  ok('짝 없는 타입이 있으면 짝짓지 않는다', r2.pairs === null, r2);
  const r3 = P.pairArticles([{ id: '1', title: '【범용 타입】' }], [{ id: '3', title: '【汎用タイプ】' }, { id: '4', title: '【支援タイプ】' }]);
  ok('글 수가 다르면 짝짓지 않는다', r3.pairs === null, r3);
  ok('꼬리표는 여러 개 중에서도 찾는다 (【재게재】【범용 타입】)', P.articleType('【재게재】 유닛 관련 조정 【범용 타입】') === 'gen');
  ok('꼬리표 밖의 낱말은 안 본다', P.articleType('지원 요청 안내') === null);
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
