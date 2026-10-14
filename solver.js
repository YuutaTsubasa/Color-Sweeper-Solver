// ColorSweeper 解題核心
// 盤面上每格是一個「顏色變數」；符號規則的圖案（每個符號 8 個方向的同色/異色）是額外的變數。
// 各種規則都化為「限制」，每個限制提供 feasible(dom)：在目前候選下是否還可能成立（不可能時回傳原因）。
// 推理：Lv1 單一限制 → Lv2 兩個計數限制比對 → Lv3 假設法 → Lv4 窮舉。
(function (global) {
  'use strict';

  const PALETTE = [
    { key: 'p', name: '紫' }, { key: 'b', name: '藍' }, { key: 'r', name: '粉' }, { key: 'g', name: '綠' },
  ];
  // [dr, dc, 箭頭, 名稱]
  const DIRS = [
    [-1, 0, '↑', '上'], [-1, 1, '↗', '右上'], [0, 1, '→', '右'], [1, 1, '↘', '右下'],
    [1, 0, '↓', '下'], [1, -1, '↙', '左下'], [0, -1, '←', '左'], [-1, -1, '↖', '左上'],
  ];
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const SYMBOLS = ['⧗', '⇌', '✱', '◆', '✚', '◎'];
  const SAME = 0, DIFF = 1;

  const bit = (c) => 1 << c;
  const popcount = (m) => { let k = 0; while (m) { m &= m - 1; k++; } return k; };
  const single = (m) => (m && !(m & (m - 1))) ? 31 - Math.clz32(m) : -1;
  const bitsOf = (m) => { const out = []; for (let c = 0; m >> c; c++) if (m & bit(c)) out.push(c); return out; };
  const uniq = (arr) => [...new Set(arr)];

  // ---------- 幾何 ----------

  const inside = (n, r, c) => r >= 0 && r < n && c >= 0 && c < n;
  function neighbors(n, i) {
    const out = [];
    for (let d = 0; d < 8; d++) { const j = neighborDir(n, i, d); if (j >= 0) out.push(j); }
    return out;
  }
  function neighborDir(n, i, d) {
    const r = Math.floor(i / n) + DIRS[d][0], c = (i % n) + DIRS[d][1];
    return inside(n, r, c) ? r * n + c : -1;
  }
  function rayCells(n, i, d) {
    const out = [];
    let r = Math.floor(i / n) + DIRS[d][0], c = (i % n) + DIRS[d][1];
    while (inside(n, r, c)) { out.push(r * n + c); r += DIRS[d][0]; c += DIRS[d][1]; }
    return out;
  }
  function knightCells(n, i) {
    const r0 = Math.floor(i / n), c0 = i % n, out = [];
    for (const [dr, dc] of KNIGHT) if (inside(n, r0 + dr, c0 + dc)) out.push((r0 + dr) * n + c0 + dc);
    return out;
  }
  function lineCells(n, kind, idx) {
    return Array.from({ length: n }, (_, k) => (kind === 'row' ? idx * n + k : k * n + idx));
  }
  const cellName = (n, i) => String.fromCharCode(65 + (i % n)) + (Math.floor(i / n) + 1);
  const lineName = (n, kind, idx) => (kind === 'row' ? `第 ${idx + 1} 列` : `第 ${String.fromCharCode(65 + idx)} 欄`);

  // 偽裝：斜體的非零偶數，實際可能是一半
  const allowed = (k, fake) => (fake && k > 0 && k % 2 === 0 ? [k, k / 2] : [k]);

  // ---------- 盤面資料 ----------

  // 顏色以「色位」0~3 表示（對應使用者配色的四格）；used = 這題出現的色位。
  // 內部一律以 4 色計算，未使用的色位直接從候選中排除。
  function emptyPuzzle(n, used) {
    if (used == null) used = 3;
    if (typeof used === 'number') used = Array.from({ length: used }, (_, k) => k);
    return {
      n, K: 4, used: used.slice(),
      cells: Array.from({ length: n * n }, () => ({ color: null, clue: null })),
      rows: Array.from({ length: n }, () => ({})),
      cols: Array.from({ length: n }, () => ({})),
    };
  }

  // ---------- 建立模型 ----------
  // overlay：解題中解出的格子在遊戲裡顯示的線索 i → { color, clue }

  function buildModel(puzzle, overlay) {
    const n = puzzle.n, K = puzzle.K, NC = n * n;
    const nv = NC + SYMBOLS.length * 8;
    const auxVar = (id, d) => NC + id * 8 + d;
    // 偽裝規則：只要規則存在，所有非零偶數都可能是實際值的兩倍
    const fk = (o) => !!(puzzle.fake || o.fake) && o.k > 0 && o.k % 2 === 0;
    const cellAt = (i) => (overlay && overlay.has(i) ? overlay.get(i) : puzzle.cells[i]);
    const cons = [];
    const strips = { h: [], v: [] };

    for (let i = 0; i < NC; i++) {
      const cell = cellAt(i), cl = cell.clue;
      if (!cl) continue;
      const name = cellName(n, i);
      if (cl.type === 'num') {
        cons.push(countSame(i, neighbors(n, i), allowed(cl.k, fk(cl)), { k: cl.k, fake: fk(cl), tag: '', area: '周圍', name }));
      } else if (cl.type === 'ray') {
        cons.push(countSame(i, rayCells(n, i, cl.dir), allowed(cl.k, fk(cl)),
          { k: cl.k, fake: fk(cl), tag: DIRS[cl.dir][2], area: `${DIRS[cl.dir][2]} 方向上`, name }));
      } else if (cl.type === 'knight') {
        const kc = Object.assign({}, cl, { k: cl.k == null ? 1 : cl.k }), k = kc.k;
        cons.push(countSame(i, knightCells(n, i), allowed(k, fk(kc)), { k, fake: fk(kc), tag: '♞', area: '騎士可跳到的格子中', name }));
      } else if (cl.type === 'sym') {
        for (let d = 0; d < 8; d++) {
          const j = neighborDir(n, i, d);
          if (j >= 0) cons.push(symRel(i, j, auxVar(cl.id, d), cl.id, d));
        }
      } else if (cl.type === 'pair') {
        const j = neighborDir(n, i, cl.dir);
        if (j >= 0) cons.push(pairEq(i, j, neighbors(n, i), neighbors(n, j)));
      } else if (cl.type === 'code') {
        strips[cl.orient === 'v' ? 'v' : 'h'][cl.pos - 1] = i;
      } else if (cl.type === 'bar') {
        cons.push(barRun(n, i, cl.axis === 'v' ? 'v' : 'h', allowed(cl.k, fk(cl)), name));
      } else if (cl.type === 'poly' && cl.shape && cl.shape.length) {
        cons.push(polyRegion(n, i, cl.shape, name));
      } else if (cl.type === 'mirror') {
        // 沿箭頭方向找第一個指回來的對稱線索；兩者之間（含兩端）顏色呈對稱
        const ray = rayCells(n, i, cl.dir);
        const back = (cl.dir + 4) % 8;
        const t = ray.findIndex((j) => { const c2 = cellAt(j).clue; return c2 && c2.type === 'mirror' && c2.dir === back; });
        if (t >= 0 && i < ray[t]) {
          const seg = [i].concat(ray.slice(0, t + 1));
          for (let a = 0, b = seg.length - 1; a < b; a++, b--) cons.push(mirrorEq(seg[a], seg[b], i, ray[t]));
        }
      }
    }
    const strip = (strips.h.filter((x) => x != null).length >= strips.v.filter((x) => x != null).length ? strips.h : strips.v)
      .filter((x) => x != null);

    for (const kind of ['row', 'col']) {
      (kind === 'row' ? puzzle.rows : puzzle.cols).forEach((lc, idx) => {
        if (!lc) return;
        const cells = lineCells(n, kind, idx), ln = lineName(n, kind, idx);
        const area = kind === 'row' ? '這一列中' : '這一欄中';
        if (lc.count) cons.push(countColor(lc.count.color, cells, allowed(lc.count.k, fk(lc.count)), { k: lc.count.k, fake: fk(lc.count), area, name: ln }));
        if (lc.major) cons.push(majority(cells, lc.major.color, ln, K));
        if (lc.code && strip.length >= 2) cons.push(codeLine(cells, strip, lc.code === 'o', ln));
        if (lc.streak) cons.push(lineRuns(cells, 'streak', null, allowed(lc.streak.k, fk(lc.streak)), ln));
        if (lc.double) cons.push(lineRuns(cells, 'double', null, allowed(lc.double.k, fk(lc.double)), ln));
        if (lc.blocks) cons.push(lineRuns(cells, 'blocks', lc.blocks.color, allowed(lc.blocks.k, fk(lc.blocks)), ln));
      });
    }

    const scopeSet = new Set();
    cons.forEach((c) => c.scope.forEach((v) => scopeSet.add(v)));
    const PRI = { count: 0, eq: 1, sym: 1, bar: 2, poly: 2, pair: 3, runs: 3, major: 4, code: 4 };
    cons.sort((a, b) => PRI[a.type] - PRI[b.type]);
    return { n, K, NC, nv, cons, relevant: scopeSet, strip };
  }

  const usedMask = (p) => (p.used || [0, 1, 2]).reduce((m, k) => m | bit(k), 0);

  function initialDomains(puzzle) {
    const all = usedMask(puzzle);
    const dom = puzzle.cells.map((c) => (c.color != null ? bit(c.color) : all));
    for (let k = 0; k < SYMBOLS.length * 8; k++) dom.push(3);
    return dom;
  }

  // ---------- 文字 ----------

  function fmt(model) {
    const n = model.n;
    const varName = (v) => (v < model.NC ? cellName(n, v)
      : `${SYMBOLS[Math.floor((v - model.NC) / 8)]}${DIRS[(v - model.NC) % 8][2]}`);
    const varH = (v) => `<b class="cn">${varName(v)}</b>`;
    const listH = (arr) => arr.map(varH).join('、');
    const listT = (arr) => arr.map(varName).join('、');
    const colorH = (c) => `<span class="chip c${c}">${PALETTE[c].name}</span>`;
    const valH = (v, a) => (v < model.NC ? colorH(a) : `<b>${a === SAME ? '同色' : '異色'}</b>`);
    const valT = (v, a) => (v < model.NC ? PALETTE[a].name : (a === SAME ? '同色' : '異色'));
    return { varName, varH, listH, listT, colorH, valH, valT };
  }

  // ---------- 限制：同色計數（基本、射線、騎士）與指定色計數（行列計數） ----------

  // 目標顏色已確定時，計算現況
  function countState(con, dom) {
    const c = con.fixed != null ? con.fixed : single(dom[con.ref]);
    if (c < 0) return null;
    const b = bit(c), yes = [], unk = [];
    for (const j of con.S) {
      if (dom[j] === b) yes.push(j);
      else if (dom[j] & b) unk.push(j);
    }
    const feas = con.V.filter((t) => t >= yes.length && t <= yes.length + unk.length);
    return { c, yes, unk, feas };
  }

  function countBase(extra) {
    return Object.assign({
      type: 'count',
      feasible(dom, F) {
        const colors = this.fixed != null ? [this.fixed] : bitsOf(dom[this.ref]);
        const bad = [];
        for (const c of colors) {
          let lo = 0, hi = 0;
          for (const j of this.S) {
            const d = dom[j];
            if (d === bit(c)) { lo++; hi++; } else if (d & bit(c)) hi++;
          }
          if (this.V.some((t) => t >= lo && t <= hi)) return null;
          bad.push({ c, lo, hi });
        }
        if (!F) return 'x';
        const want = this.V.join(' 或 ');
        return bad.map(({ c, lo, hi }) => {
          const pre = this.fixed == null && colors.length > 1 ? `${F.varH(this.ref)} 是${F.colorH(c)}時，` : '';
          const range = lo === hi ? `剛好 ${lo} 格` : `只能是 ${lo}～${hi} 格`;
          return `${pre}${this.area}${F.colorH(c)}${range}，不符合 ${want}`;
        }).join('；') || '沒有可用的顏色';
      },
    }, extra);
  }

  function countSame(ref, S, V, meta) {
    return countBase({
      ref, S, V, fixed: null, scope: [ref].concat(S), area: meta.area, refs: [ref],
      labelH(dom, F) {
        const c = single(dom[ref]);
        const txt = `${meta.tag}${c >= 0 ? PALETTE[c].name : '?'}${meta.k}`;
        return `<span class="clue-ref c${c >= 0 ? c : 'x'}${meta.fake ? ' fake' : ''}">${txt}</span>(${meta.name})`;
      },
      labelT(dom) { const c = single(dom[ref]); return `${meta.tag}${c >= 0 ? PALETTE[c].name : '?'}${meta.k}(${meta.name})`; },
    });
  }

  function countColor(color, S, V, meta) {
    return countBase({
      ref: null, S, V, fixed: color, scope: S.slice(), area: meta.area, refs: [],
      labelH() { return `${meta.name}<span class="clue-ref c${color}${meta.fake ? ' fake' : ''}">計數${PALETTE[color].name}${meta.k}</span>`; },
      labelT() { return `${meta.name}計數${PALETTE[color].name}${meta.k}`; },
    });
  }

  // 計數限制的直觀推理
  function countTemplate(con, dom, F) {
    const st = countState(con, dom);
    if (!st || !st.unk.length || !st.feas.length) return null;
    const { c, yes, unk, feas } = st;
    const maxT = Math.max(...feas), minT = Math.min(...feas);
    let mode = null;
    if (maxT === yes.length) mode = 'full';
    else if (minT === yes.length + unk.length) mode = 'exact';
    if (!mode) return null;
    const effects = unk.map((v) => ({ v, c, val: mode === 'exact' }));
    if (!F) return { effects };
    const clue = con.labelH(dom, F), col = F.colorH(c), t = feas.length === 1 ? feas[0] : (mode === 'full' ? maxT : minT);
    let fakeNote = '';
    if (con.V.length > 1) fakeNote = `（斜體偽裝數字：實際是 ${con.V.join(' 或 ')}；依目前狀況只可能是 ${feas.join(' 或 ')}）<br>`;
    let html, short;
    if (mode === 'full') {
      const why = t === 0
        ? `${clue} ${con.area}不能有任何${col}。`
        : `${clue} ${con.area}已經有 ${t} 格${col}（${F.listH(yes)}），數量已滿。`;
      html = `${fakeNote}${why}<br>所以 ${F.listH(unk)} 都<b>不是</b>${col}（打 ✕）。`;
      short = `${con.labelT(dom)} 已滿 → ${F.listT(unk)} 不是${PALETTE[c].name}`;
    } else {
      const need = t - yes.length;
      let why = `${clue} ${con.area}需要 ${t} 格${col}`;
      if (yes.length) why += `，已確定 ${yes.length} 格（${F.listH(yes)}），還差 ${need} 格`;
      why += `。可能是${col}的只剩 ${F.listH(unk)}，剛好 ${need} 格。`;
      html = `${fakeNote}${why}<br>所以${unk.length > 1 ? '它們<b>全部都是</b>' : ` ${F.listH(unk)} <b>是</b>`}${col}。`;
      short = `${con.labelT(dom)} 候選剛好 → ${F.listT(unk)} 是${PALETTE[c].name}`;
    }
    return {
      level: 1, kind: 'count', title: mode === 'full' ? '線索已滿 → 其餘格排除' : '候選剛好夠 → 全部填色',
      html, short, effects, refs: con.refs.concat(yes),
    };
  }

  // ---------- 限制：符號 ----------

  function symRel(i, j, p, id, d) {
    return {
      type: 'sym', i, j, p, id, d, scope: [i, j, p], refs: [i],
      feasible(dom, F) {
        for (const pv of bitsOf(dom[p])) {
          const ci = dom[i], cj = dom[j];
          if (pv === SAME ? (ci & cj) : !(ci === cj && single(ci) >= 0)) return null;
        }
        if (!F) return 'x';
        const pv = single(dom[p]);
        if (pv === SAME) return `符號 ${SYMBOLS[id]} 的 ${DIRS[d][2]} 方向是同色，但 ${F.varH(i)} 與 ${F.varH(j)} 不可能同色`;
        if (pv === DIFF) return `符號 ${SYMBOLS[id]} 的 ${DIRS[d][2]} 方向是異色，但 ${F.varH(i)} 與 ${F.varH(j)} 一定同色`;
        return '符號關係無法成立';
      },
      labelH(dom, F) { return `符號 <b>${SYMBOLS[id]}</b>(${F.varName(i)})`; },
      labelT() { return `符號${SYMBOLS[id]}`; },
    };
  }

  function symTemplate(con, dom, F) {
    const { i, j, p, id, d } = con;
    const ci = single(dom[i]), cj = single(dom[j]), pv = single(dom[p]);
    const sym = `<b>${SYMBOLS[id]}</b>`, dir = DIRS[d][2];
    let effects = null, html = '', short = '';
    if (pv < 0 && ci >= 0 && cj >= 0) {
      const same = ci === cj;
      effects = [{ v: p, c: same ? SAME : DIFF, val: true }];
      if (F) {
        html = `符號格 ${F.varH(i)}(${F.colorH(ci)}) 的 ${dir} 方向是 ${F.varH(j)}(${F.colorH(cj)})，兩者<b>${same ? '同色' : '異色'}</b>。<br>` +
          `所以符號 ${sym} 的圖案中，${dir} 方向是「${same ? '同色' : '異色'}」——其他 ${sym} 格的 ${dir} 方向也一樣。`;
        short = `${F.varName(i)} 與 ${dir} 的 ${F.varName(j)} ${same ? '同色' : '異色'} → 符號${SYMBOLS[id]} ${dir}=${same ? '同色' : '異色'}`;
      }
    } else if (pv >= 0) {
      const [src, dst, c] = ci >= 0 && cj < 0 ? [i, j, ci] : cj >= 0 && ci < 0 ? [j, i, cj] : [-1, -1, -1];
      if (src < 0) return null;
      if (pv === SAME) effects = [{ v: dst, c, val: true }];
      else if (dom[dst] & bit(c)) effects = [{ v: dst, c, val: false }];
      else return null;
      if (F) {
        html = `符號 ${sym} 的圖案中 ${dir} 方向是「${pv === SAME ? '同色' : '異色'}」（從其他 ${sym} 格得知）。<br>` +
          `${F.varH(i)} 的 ${dir} 方向是 ${F.varH(j)}，所以 ${F.varH(dst)} ${pv === SAME ? `<b>與 ${F.varH(src)} 同色</b>，是${F.colorH(c)}` : `<b>不是</b>${F.colorH(c)}（與 ${F.varH(src)} 異色）`}。`;
        short = `符號${SYMBOLS[id]} ${dir}=${pv === SAME ? '同色' : '異色'} → ${F.varName(dst)} ${pv === SAME ? '是' : '不是'}${PALETTE[c].name}`;
      }
    } else return null;
    if (!F) return { effects };
    return { level: 1, kind: 'sym', title: pv < 0 ? '符號圖案：得知一個方向' : '符號圖案：套用到其他符號格', html, short, effects, refs: [i, j] };
  }

  // ---------- 限制：成對（兩格的基本規則數字相同） ----------

  function pairEq(a, b, Na, Nb) {
    return {
      type: 'pair', a, b, scope: uniq([a, b].concat(Na, Nb)), refs: [a, b],
      feasible(dom, F) {
        const range = (x, N, cx, y, cy) => {
          let lo = 0, hi = 0;
          for (const j of N) {
            const d = j === y ? bit(cy) : dom[j];
            if (d === bit(cx)) { lo++; hi++; } else if (d & bit(cx)) hi++;
          }
          return [lo, hi];
        };
        for (const ca of bitsOf(dom[a])) {
          for (const cb of bitsOf(dom[b])) {
            const [l1, h1] = range(a, Na, ca, b, cb), [l2, h2] = range(b, Nb, cb, a, ca);
            if (Math.max(l1, l2) <= Math.min(h1, h2)) return null;
          }
        }
        return F ? `${F.varH(a)} 與 ${F.varH(b)} 周圍同色格的數量不可能相等` : 'x';
      },
      labelH(dom, F) { return `成對線索 ${F.varH(a)}⇔${F.varH(b)}`; },
      labelT(dom, F) { return `成對${F.varName(a)}⇔${F.varName(b)}`; },
    };
  }

  // ---------- 限制：主要（最多的顏色 / 平手） ----------

  function majority(cells, color, ln, K) {
    return {
      type: 'major', scope: cells.slice(), refs: [],
      feasible(dom, F) {
        const doms = cells.map((j) => dom[j]);
        if (doms.some((d) => !d)) return F ? '有格子沒有可用顏色' : 'x';
        // Hall 條件：每個顏色子集 T，落在 T 的格數介於「只能是 T」與「可能是 T」之間
        const lowT = [], highT = [];
        for (let T = 1; T < (1 << K); T++) {
          lowT[T] = doms.filter((d) => (d & ~T) === 0).length;
          highT[T] = doms.filter((d) => d & T).length;
        }
        const x = new Array(K).fill(0), L = cells.length;
        const ok = () => {
          for (let T = 1; T < (1 << K); T++) {
            let s = 0; for (let c = 0; c < K; c++) if (T & bit(c)) s += x[c];
            if (s < lowT[T] || s > highT[T]) return false;
          }
          const mx = Math.max(...x);
          if (color == null) return x.filter((v) => v === mx).length >= 2;
          return x.every((v, c) => c === color || v < x[color]);
        };
        const rec = (c, left) => {
          if (c === K - 1) { x[c] = left; return ok(); }
          for (let v = 0; v <= left; v++) { x[c] = v; if (rec(c + 1, left - v)) return true; }
          return false;
        };
        if (rec(0, L)) return null;
        if (!F) return 'x';
        return color == null ? `${ln}無法出現「並列最多」的顏色` : `${F.colorH(color)}無法成為${ln}唯一最多的顏色`;
      },
      labelH(dom, F) { return `${ln}<span class="clue-ref ${color == null ? 'cx' : 'c' + color}">${color == null ? '⚔ 平手' : '👑' + PALETTE[color].name}</span>`; },
      labelT() { return `${ln}${color == null ? '平手' : '主要' + PALETTE[color].name}`; },
    };
  }

  // ---------- 限制：密碼（這一列含有/不含密碼序列） ----------

  function codeLine(cells, strip, contains, ln) {
    const L = strip.length;
    // 位置 p 的配對：cells[p+t] 必須與 strip[t] 同色
    const pairsAt = (p) => strip.map((s, t) => [cells[p + t], s]);
    return {
      type: 'code', scope: uniq(cells.concat(strip)), refs: strip.slice(),
      feasible(dom, F) {
        if (contains) {
          for (let p = 0; p + L <= cells.length; p++) {
            // 等價類取交集
            const parent = new Map();
            const find = (v) => { while (parent.has(v) && parent.get(v) !== v) v = parent.get(v); return v; };
            const val = new Map();
            let ok = true;
            for (const [u, w] of pairsAt(p)) {
              const ru = find(u), rw = find(w);
              const du = val.has(ru) ? val.get(ru) : dom[ru], dw = val.has(rw) ? val.get(rw) : dom[rw];
              if (ru !== rw) { parent.set(ru, rw); parent.set(rw, rw); }
              const m = du & dw;
              val.set(rw, m);
              if (!m) { ok = false; break; }
            }
            if (ok) return null;
          }
          return F ? `${ln}放不下密碼序列（${F.listH(strip)} 的顏色依序連續出現）` : 'x';
        }
        for (let p = 0; p + L <= cells.length; p++) {
          const forced = pairsAt(p).every(([u, w]) => u === w || (single(dom[u]) >= 0 && dom[u] === dom[w]));
          if (forced) {
            return F ? `${F.listH(cells.slice(p, p + L))} 會依序組成密碼序列，但${ln}不應出現密碼` : 'x';
          }
        }
        return null;
      },
      labelH() { return `${ln}<span class="clue-ref cx">密碼${contains ? '◎ 有' : '⊘ 無'}</span>`; },
      labelT() { return `${ln}密碼${contains ? '有' : '無'}`; },
    };
  }

  // ---------- 限制：對稱（對稱位置的兩格同色） ----------

  function mirrorEq(a, b, ca, cb) {
    return {
      type: 'eq', a, b, scope: [a, b], refs: [ca, cb],
      feasible(dom, F) {
        if (dom[a] & dom[b]) return null;
        return F ? `${F.varH(a)} 與 ${F.varH(b)} 在對稱位置，必須同色，但沒有共同的可能顏色` : 'x';
      },
      labelH(dom, F) { return `對稱線索 ${F.varH(ca)}↔${F.varH(cb)}`; },
      labelT(dom, F) { return `對稱${F.varName(ca)}↔${F.varName(cb)}`; },
    };
  }

  function eqTemplate(con, dom, F) {
    const { a, b } = con;
    const m = dom[a] & dom[b];
    if (!m || (m === dom[a] && m === dom[b])) return null;
    const effects = [];
    for (const [x, y] of [[a, b], [b, a]]) {
      for (const c of bitsOf(dom[x])) if (!(dom[y] & bit(c))) effects.push({ v: x, c, val: false });
    }
    if (!F) return { effects };
    let html = `${con.labelH(dom, F)}：${F.varH(a)} 與 ${F.varH(b)} 位在對稱的位置，必須<b>同色</b>。<br>`;
    const src = single(dom[a]) >= 0 ? a : single(dom[b]) >= 0 ? b : -1;
    if (src >= 0) {
      const dst = src === a ? b : a, c = single(dom[src]);
      html += `${F.varH(src)} 是${F.colorH(c)}，所以 ${F.varH(dst)} 也是${F.colorH(c)}。`;
    } else {
      html += `兩格只能是共同的可能顏色：${bitsOf(m).map(F.colorH).join('、')}。`;
    }
    return {
      level: 1, kind: 'eq', title: '對稱：兩格同色', html,
      short: `${con.labelT(dom, F)} → ${F.varName(a)}、${F.varName(b)} 同色`,
      effects, refs: con.refs.concat([a, b]),
    };
  }

  // ---------- 限制：棒狀（線索所在方塊在指定方向上的長度） ----------

  function barRun(n, i, axis, V, name) {
    const r0 = Math.floor(i / n), c0 = i % n;
    const at = (p) => (axis === 'h' ? r0 * n + p : p * n + c0);
    const pos = axis === 'h' ? c0 : r0;
    const maxV = Math.max(...V);
    const scope = [i];
    for (let p = Math.max(0, pos - maxV); p <= Math.min(n - 1, pos + maxV); p++) if (p !== pos) scope.push(at(p));
    const axisName = axis === 'h' ? '橫向' : '直向';
    return {
      type: 'bar', scope, refs: [i],
      feasible(dom, F) {
        for (const c of bitsOf(dom[i])) {
          const b = bit(c);
          for (const t of V) {
            // 長度 t 的方塊放在 [s, s+t)，必須包含線索格，兩端外側不能同色
            for (let s = pos - t + 1; s <= pos; s++) {
              if (s < 0 || s + t > n) continue;
              let ok = true;
              for (let p = s; p < s + t && ok; p++) if (!(dom[at(p)] & b)) ok = false;
              if (ok && s - 1 >= 0 && dom[at(s - 1)] === b) ok = false;
              if (ok && s + t < n && dom[at(s + t)] === b) ok = false;
              if (ok) return null;
            }
          }
        }
        return F ? `${F.varH(i)} 所在的${axisName}方塊長度不可能是 ${V.join(' 或 ')}` : 'x';
      },
      labelH(dom) {
        const c = single(dom[i]);
        return `<span class="clue-ref c${c >= 0 ? c : 'x'}">棒狀${axis === 'h' ? '═' : '‖'}${V[0]}</span>(${name})`;
      },
      labelT() { return `棒狀${V[0]}(${name})`; },
    };
  }

  // ---------- 限制：多邊形（線索所在區域的形狀，可旋轉不可翻轉） ----------

  function normShape(cells) {
    const mr = Math.min(...cells.map((p) => p[0])), mc = Math.min(...cells.map((p) => p[1]));
    return cells.map(([r, c]) => [r - mr, c - mc]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  }
  function rotations(shape) {
    const out = [], seen = new Set();
    let cur = shape;
    for (let k = 0; k < 4; k++) {
      const nm = normShape(cur), key = JSON.stringify(nm);
      if (!seen.has(key)) { seen.add(key); out.push(nm); }
      cur = cur.map(([r, c]) => [c, -r]);
    }
    return out;
  }

  function polyRegion(n, i, shape, name) {
    const r0 = Math.floor(i / n), c0 = i % n;
    // 所有可能的擺法：每種旋轉 × 以圖形中每一格對齊線索格
    const placements = [];
    for (const rot of rotations(shape)) {
      for (const [ar, ac] of rot) {
        const cells = [];
        let ok = true;
        for (const [r, c] of rot) {
          const rr = r - ar + r0, cc = c - ac + c0;
          if (!inside(n, rr, cc)) { ok = false; break; }
          cells.push(rr * n + cc);
        }
        if (!ok) continue;
        const set = new Set(cells), border = new Set();
        for (const v of cells) {
          for (const d of [0, 2, 4, 6]) { const j = neighborDir(n, v, d); if (j >= 0 && !set.has(j)) border.add(j); }
        }
        placements.push({ cells, border: [...border] });
      }
    }
    const scope = uniq([i].concat(...placements.map((p) => p.cells.concat(p.border))));
    return {
      type: 'poly', scope, refs: [i],
      feasible(dom, F) {
        for (const c of bitsOf(dom[i])) {
          const b = bit(c);
          for (const p of placements) {
            if (p.cells.every((v) => dom[v] & b) && p.border.every((v) => dom[v] !== b)) return null;
          }
        }
        return F ? `${F.varH(i)} 所在的區域無法形成指定的形狀（${shape.length} 格）` : 'x';
      },
      labelH(dom) {
        const c = single(dom[i]);
        return `<span class="clue-ref c${c >= 0 ? c : 'x'}">多邊形</span>(${name})`;
      },
      labelT() { return `多邊形(${name})`; },
    };
  }

  // ---------- 限制：連線 / 雙格 / 方格（行列中的方塊統計） ----------
  // 連線：最長方塊長度；雙格：長度剛好 2 的方塊數（不分色）；方格：指定顏色的方塊數。
  // 動態規劃逐格掃描，狀態 = (前一格顏色, 目前方塊長度, 統計值)

  function lineRuns(cells, kind, color, V, ln) {
    const maxV = Math.max(...V), L = cells.length;
    const lenCap = kind === 'streak' ? maxV + 1 : kind === 'double' ? 3 : 1;
    const feasibleWith = (dom) => {
      let states = new Set(['-1,0,0']);
      for (let p = 0; p < L; p++) {
        const next = new Set();
        for (const key of states) {
          const [prev, len, stat] = key.split(',').map(Number);
          for (const c of bitsOf(dom[cells[p]])) {
            let nl, ns = stat;
            if (c === prev) nl = Math.min(len + 1, lenCap);
            else {
              if (kind === 'double' && len === 2) ns++;   // 前一個方塊結束
              if (kind === 'blocks' && c === color) ns++; // 新的指定色方塊開始
              nl = 1;
            }
            if (kind === 'streak') { if (nl > maxV) continue; ns = Math.max(ns, nl); }
            else if (ns > maxV) continue;
            next.add(`${c},${nl},${ns}`);
          }
        }
        states = next;
        if (!states.size) return false;
      }
      for (const key of states) {
        const [, len, stat] = key.split(',').map(Number);
        if (V.includes(kind === 'double' && len === 2 ? stat + 1 : stat)) return true;
      }
      return false;
    };
    const what = kind === 'streak' ? '最長方塊的長度' : kind === 'double' ? '長度剛好 2 的方塊數' : `${PALETTE[color].name}方塊的數量`;
    const tag = kind === 'streak' ? `連線${V[0]}` : kind === 'double' ? `雙格${V[0]}` : `方格${PALETTE[color].name}${V[0]}`;
    return {
      type: 'runs', scope: cells.slice(), refs: [],
      feasible(dom, F) {
        if (feasibleWith(dom)) return null;
        return F ? `${ln}${what}不可能是 ${V.join(' 或 ')}` : 'x';
      },
      labelH() { return `${ln}<span class="clue-ref ${color == null ? 'cx' : 'c' + color}">${tag}</span>`; },
      labelT() { return `${ln}${tag}`; },
    };
  }

  // ---------- 通用單一限制推理（逐一試每個候選值） ----------

  function gacEffects(con, dom, F) {
    const out = [];
    for (const v of con.scope) {
      if (popcount(dom[v]) < 2) continue;
      for (const a of bitsOf(dom[v])) {
        const d2 = dom.slice(); d2[v] = bit(a);
        const why = con.feasible(d2, F);
        if (why) out.push({ v, a, why });
      }
    }
    return out;
  }

  function deduce(con, dom, F) {
    if (con.type === 'count') { const t = countTemplate(con, dom, F); if (t) return t; }
    if (con.type === 'sym') { const t = symTemplate(con, dom, F); if (t) return t; }
    if (con.type === 'eq') { const t = eqTemplate(con, dom, F); if (t) return t; }
    const elims = gacEffects(con, dom, F);
    if (!elims.length) return null;
    const effects = elims.map((e) => ({ v: e.v, c: e.a, val: false }));
    if (!F) return { effects };
    const html = `看 ${con.labelH(dom, F)}：<ul>` +
      elims.map((e) => `<li>若 ${F.varH(e.v)} 是${F.valH(e.v, e.a)}：${e.why} → <b>排除</b></li>`).join('') + '</ul>';
    const short = `${con.labelT(dom, F)} → ` + elims.map((e) => `${F.varName(e.v)}≠${F.valT(e.v, e.a)}`).join('、');
    const TITLE = { count: '線索數量檢查', sym: '符號關係', pair: '成對規則', major: '主要規則', code: '密碼規則', eq: '對稱規則', bar: '棒狀規則', poly: '多邊形規則', runs: '行列方塊規則' };
    return { level: 1, kind: con.type, title: TITLE[con.type], html, short, effects, refs: con.refs };
  }

  // ---------- Lv2：兩個同色計數限制比對 ----------

  function findPair(model, dom, F) {
    const items = [];
    for (const con of model.cons) {
      if (con.type !== 'count') continue;
      const st = countState(con, dom);
      if (!st || !st.unk.length || st.feas.length !== 1) continue;
      items.push({ con, c: st.c, r: st.feas[0] - st.yes.length, unk: st.unk });
    }
    for (let x = 0; x < items.length; x++) {
      for (let y = 0; y < items.length; y++) {
        if (x === y) continue;
        const P = items[x], Q = items[y];
        if (P.c !== Q.c) continue;
        const setQ = new Set(Q.unk), setP = new Set(P.unk);
        const I = P.unk.filter((v) => setQ.has(v));
        if (!I.length) continue;
        const A = P.unk.filter((v) => !setQ.has(v)), B = Q.unk.filter((v) => !setP.has(v));
        const lo = Math.max(0, P.r - A.length, Q.r - B.length), hi = Math.min(I.length, P.r, Q.r);
        if (lo > hi) continue;
        const c = P.c;
        let effects = null, why = '';
        if (B.length && Q.r - hi === B.length) {
          effects = B.map((v) => ({ v, c, val: true }));
          if (F) {
            why = `${hi === I.length ? `共同候選只有 ${I.length} 格` : `${P.con.labelH(dom, F)} 只差 ${P.r} 格`}，所以共同候選最多只能有 ${hi} 格${F.colorH(c)}。<br>` +
              `${Q.con.labelH(dom, F)} 還差 ${Q.r} 格，剩下至少 ${Q.r - hi} 格必須落在它專屬的 ${F.listH(B)}，剛好 ${B.length} 格 → <b>全部都是</b>${F.colorH(c)}。`;
          }
        } else if (B.length && Q.r - lo === 0 && lo > 0) {
          effects = B.map((v) => ({ v, c, val: false }));
          if (F) {
            why = `${P.con.labelH(dom, F)} 還差 ${P.r} 格，但它專屬的候選${A.length ? `（${F.listH(A)}）` : ''}只有 ${A.length} 格，所以共同候選至少要有 ${lo} 格${F.colorH(c)}。<br>` +
              `而 ${Q.con.labelH(dom, F)} 只差 ${Q.r} 格，光共同候選就補滿了 → 它專屬的 ${F.listH(B)} 都<b>不是</b>${F.colorH(c)}。`;
          }
        }
        if (!effects) continue;
        if (!F) return { effects };
        const intro = `比較兩個${F.colorH(c)}的計數線索：<ul>` +
          `<li>${P.con.labelH(dom, F)} 還差 ${P.r} 格，候選：${F.listH(P.unk)}</li>` +
          `<li>${Q.con.labelH(dom, F)} 還差 ${Q.r} 格，候選：${F.listH(Q.unk)}</li>` +
          `<li>共同候選：${F.listH(I)}</li></ul>`;
        return {
          level: 2, kind: 'pair2', title: '兩個線索交叉比對', html: intro + why,
          short: `比較 ${P.con.labelT(dom, F)} 與 ${Q.con.labelT(dom, F)} → ${F.listT(effects.map((e) => e.v))} ${effects[0].val ? '是' : '不是'}${PALETTE[c].name}`,
          effects, refs: P.con.refs.concat(Q.con.refs), shared: I,
        };
      }
    }
    return null;
  }

  // ---------- 矛盾與傳播 ----------

  function findContradiction(model, dom, F) {
    for (let v = 0; v < model.NC; v++) {
      if (!dom[v]) return { v, html: F ? `${F.varH(v)} 沒有任何顏色可填` : 'x' };
    }
    for (const con of model.cons) {
      const why = con.feasible(dom, F);
      if (why) return { con, html: F ? `${con.labelH(dom, F)}：${why}` : 'x' };
    }
    return null;
  }

  function applyEffects(dom, effects) {
    const out = dom.slice();
    for (const e of effects) out[e.v] = e.val ? out[e.v] & bit(e.c) : out[e.v] & ~bit(e.c);
    return out;
  }

  function findLogic(model, dom, F) {
    for (const con of model.cons) {
      const st = deduce(con, dom, F);
      if (st) return st;
    }
    return findPair(model, dom, F);
  }

  function propagate(model, dom, maxSteps, F) {
    let cur = dom.slice();
    const chain = [];
    for (;;) {
      const bad = findContradiction(model, cur, F);
      if (bad) return { contradiction: bad, chain, dom: cur };
      if (chain.length >= maxSteps) return { contradiction: null, chain, dom: cur };
      const st = findLogic(model, cur, F);
      if (!st) return { contradiction: null, chain, dom: cur };
      chain.push(st);
      cur = applyEffects(cur, st.effects);
    }
  }

  // ---------- Lv3：假設法 ----------

  function openVars(model, dom) {
    return [...model.relevant].filter((v) => popcount(dom[v]) > 1).sort((a, b) => a - b);
  }

  function findTrial(model, dom, F) {
    const order = openVars(model, dom);
    for (const limit of [1, 3, 6, 12, 1000]) {
      let best = null;
      for (const v of order) {
        for (const a of bitsOf(dom[v])) {
          const tried = dom.slice(); tried[v] = bit(a);
          const res = propagate(model, tried, limit, null);
          if (res.contradiction && (!best || res.chain.length < best.len)) best = { v, a, len: res.chain.length };
        }
      }
      if (best) {
        const { v, a } = best;
        const tried = dom.slice(); tried[v] = bit(a);
        const res = propagate(model, tried, limit, F);
        let html = `假設 ${F.varH(v)} 是${F.valH(v, a)}：`;
        html += res.chain.length ? '<ol class="chain">' + res.chain.map((s) => `<li>${s.short}</li>`).join('') + '</ol>' : '<br>';
        html += `→ <b class="bad">矛盾</b>：${res.contradiction.html}。<br>所以 ${F.varH(v)} <b>不是</b>${F.valH(v, a)}。`;
        const refs = new Set();
        res.chain.forEach((s) => s.refs.forEach((r) => refs.add(r)));
        if (res.contradiction.con) res.contradiction.con.refs.forEach((r) => refs.add(r));
        return {
          level: 3, kind: 'trial', title: `假設法（${res.chain.length + 1} 步內出現矛盾）`, html,
          short: `假設 ${F.varName(v)} 是${F.valT(v, a)} 會矛盾 → 不是${F.valT(v, a)}`,
          effects: [{ v, c: a, val: false }], refs: [...refs],
        };
      }
    }
    return null;
  }

  // ---------- Lv4：窮舉 ----------

  function quickPropagate(model, dom) {
    for (;;) {
      if (findContradiction(model, dom, null)) return false;
      const st = findLogic(model, dom, null);
      if (!st) return true;
      const nd = applyEffects(dom, st.effects);
      for (let v = 0; v < dom.length; v++) dom[v] = nd[v];
    }
  }

  function hasSolution(model, dom, budget) {
    const rel = [...model.relevant];
    const dfs = (cur) => {
      if (--budget.left < 0) throw budget;
      if (!quickPropagate(model, cur)) return false;
      let pick = -1, best = 99;
      for (const v of rel) { const pc = popcount(cur[v]); if (pc > 1 && pc < best) { best = pc; pick = v; } }
      if (pick < 0) return true;
      for (const a of bitsOf(cur[pick])) {
        const nx = cur.slice(); nx[pick] = bit(a);
        if (dfs(nx)) return true;
      }
      return false;
    };
    try { return dfs(dom.slice()); } catch (e) { if (e === budget) return null; throw e; }
  }

  function findSearch(model, dom, F) {
    const budget = { left: 20000 };
    for (const v of openVars(model, dom)) {
      for (const a of bitsOf(dom[v])) {
        const tried = dom.slice(); tried[v] = bit(a);
        const ok = hasSolution(model, tried, budget);
        if (ok === null) return null;
        if (!ok) {
          return {
            level: 4, kind: 'search', title: '窮舉搜尋',
            html: `前面的邏輯推不動了，改用電腦窮舉：<br>把 ${F.varH(v)} 設為${F.valH(v, a)}後，試遍所有可能都無法滿足全部線索。<br>所以 ${F.varH(v)} <b>不是</b>${F.valH(v, a)}。<br><small>（通常代表需要很長的假設鏈，或者有剛解出的格子還沒輸入新線索。）</small>`,
            short: `窮舉：${F.varName(v)} 不是${F.valT(v, a)}`,
            effects: [{ v, c: a, val: false }], refs: [],
          };
        }
      }
    }
    return null;
  }

  // ---------- 對外介面 ----------

  function nextStep(model, dom, opts) {
    opts = opts || {};
    const F = fmt(model);
    const bad = findContradiction(model, dom, F);
    if (bad) return { status: 'error', html: `盤面有矛盾：${bad.html}。請檢查輸入是否正確。`, contradiction: bad };
    const openCells = openVars(model, dom).filter((v) => v < model.NC);
    if (!openCells.length) {
      const unconstrained = [];
      for (let v = 0; v < model.NC; v++) if (popcount(dom[v]) > 1) unconstrained.push(v);
      return { status: 'done', unconstrained };
    }
    let st = findLogic(model, dom, F) || findTrial(model, dom, F);
    if (!st && opts.allowSearch !== false) st = findSearch(model, dom, F);
    if (!st) return { status: 'stuck', html: '找不到任何確定的推論。' };
    // 補充：排除後只剩一色的格子
    const after = applyEffects(dom, st.effects), det = [];
    for (const v of uniq(st.effects.map((e) => e.v))) {
      if (v < model.NC && single(dom[v]) < 0 && single(after[v]) >= 0) det.push({ v, c: single(after[v]) });
    }
    if (det.length && st.effects.some((e) => !e.val)) {
      st.html += '<div class="det">' + det.map((d) => `→ ${F.varH(d.v)} 只剩${F.colorH(d.c)}可填，確定是${F.colorH(d.c)}。`).join('<br>') + '</div>';
    }
    st.determined = det;
    return { status: 'step', step: st };
  }

  // ---------- 匯入匯出 ----------

  function serialize(p) { return JSON.stringify(p); }

  function parse(text) {
    text = text.trim();
    if (text.startsWith('{')) {
      const p = JSON.parse(text);
      if (!p.n || !Array.isArray(p.cells) || p.cells.length !== p.n * p.n) throw new Error('格式不正確');
      // 舊格式只有 K（顏色數）：視為使用前 K 個色位
      if (!Array.isArray(p.used)) p.used = Array.from({ length: p.K || 3 }, (_, k) => k);
      p.K = 4;
      p.rows = p.rows || Array.from({ length: p.n }, () => ({}));
      p.cols = p.cols || Array.from({ length: p.n }, () => ({}));
      return p;
    }
    // 舊版文字格式：. / p3 / y …（只含基本規則）
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[\s,]+/).filter(Boolean));
    const n = rows.length;
    const p = emptyPuzzle(n, 3);
    const OLD = { p: 0, y: 1, g: 2, b: 1, r: 2 };
    rows.forEach((row, r) => {
      if (row.length !== n) throw new Error(`第 ${r + 1} 列有 ${row.length} 格，應為 ${n} 格`);
      row.forEach((tok, c) => {
        if (tok === '.') return;
        const m = /^([a-zA-Z])([0-8])?$/.exec(tok);
        if (!m || !(m[1].toLowerCase() in OLD)) throw new Error(`看不懂「${tok}」`);
        p.cells[r * n + c] = { color: OLD[m[1].toLowerCase()], clue: m[2] != null ? { type: 'num', k: Number(m[2]) } : null };
      });
    });
    return p;
  }

  const api = {
    PALETTE, DIRS, SYMBOLS, SAME, DIFF, bit, single, popcount, bitsOf, usedMask,
    // 解說文字使用的顏色名稱（跟著使用者配色）
    setColorNames(names) { names.forEach((nm, k) => { if (PALETTE[k] && nm) PALETTE[k].name = nm; }); },
    neighbors, neighborDir, rayCells, knightCells, lineCells, cellName,
    emptyPuzzle, buildModel, initialDomains, applyEffects, findContradiction, nextStep, hasSolution,
    serialize, parse, fmt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CSSolver = api;
})(typeof window !== 'undefined' ? window : globalThis);
