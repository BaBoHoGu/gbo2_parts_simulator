// <table> HTML 을 rowspan/colspan 을 펼친 2차원 배열로 만든다.
// 셀 텍스트 정리(clean)는 호출자마다 달라(<br>→' ' vs ' / ' 등) 인자로 받는다.
function parseTable(html, clean) {
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

module.exports = { parseTable };
