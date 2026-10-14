// 隨機產生「已知答案」的盤面（涵蓋各種規則與組合），逐步求解並檢查每一步推論都與答案一致。
// 用法：node tests/soundness.js [亂數種子]
const S = require(require('path').resolve(__dirname, '..', 'solver.js'));
let seed = +(process.argv[2] || 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

function gen(n, K, rules) {
  const sol = Array.from({ length: n * n }, () => Math.floor(rnd() * K));
  const p = S.emptyPuzzle(n, K);
  const same = (i, set) => set.filter((j) => sol[j] === sol[i]).length;
  const truthAux = new Map(); // aux var -> SAME/DIFF
  const used = new Set();
  const free = () => { for (let t = 0; t < 50; t++) { const i = Math.floor(rnd() * n * n); if (!used.has(i)) { used.add(i); return i; } } return -1; };
  const numClue = (k) => {
    const c = { k };
    if (rules.includes('fake') && rnd() < 0.4) {
      if (k > 0 && 2 * k <= 8 && rnd() < 0.5) { c.k = 2 * k; c.fake = true; } else if (k > 0 && k % 2 === 0) c.fake = true;
    }
    return c;
  };
  let mirrorDone = false;
  const nClues = Math.floor(n * n * (0.3 + rnd() * 0.25));
  for (let t = 0; t < nClues; t++) {
    const i = free(); if (i < 0) break;
    const type = pick(rules.filter((r) => ['num', 'ray', 'knight', 'sym', 'pair', 'bar', 'poly', 'mirror'].includes(r)));
    let clue = null;
    if (type === 'num') clue = Object.assign({ type: 'num' }, numClue(same(i, S.neighbors(n, i))));
    if (type === 'ray') { const dir = pick([0, 2, 4, 6]); clue = Object.assign({ type: 'ray', dir }, numClue(same(i, S.rayCells(n, i, dir)))); }
    if (type === 'knight') clue = Object.assign({ type: 'knight' }, numClue(same(i, S.knightCells(n, i))));
    if (type === 'sym') {
      const id = Math.floor(rnd() * 2);
      // 與已知圖案一致才放
      let ok = true; const pat = [];
      for (let d = 0; d < 8; d++) {
        const j = S.neighborDir(n, i, d); if (j < 0) continue;
        const v = n * n + id * 8 + d, val = sol[i] === sol[j] ? S.SAME : S.DIFF;
        if (truthAux.has(v) && truthAux.get(v) !== val) ok = false;
        pat.push([v, val]);
      }
      if (ok) { pat.forEach(([v, val]) => truthAux.set(v, val)); clue = { type: 'sym', id }; }
    }
    if (type === 'pair') {
      const dir = pick([2, 4]); const j = S.neighborDir(n, i, dir);
      if (j >= 0 && !used.has(j) && same(i, S.neighbors(n, i)) === same(j, S.neighbors(n, j))) { used.add(j); clue = { type: 'pair', dir }; p.cells[j] = { color: sol[j], clue: null }; }
    }
    if (type === 'bar') {
      const axis = rnd() < 0.5 ? 'h' : 'v', r0 = Math.floor(i / n), c0 = i % n;
      const at = (q) => axis === 'h' ? r0 * n + q : q * n + c0; const pos = axis === 'h' ? c0 : r0;
      let a = pos, b = pos; while (a - 1 >= 0 && sol[at(a - 1)] === sol[i]) a--; while (b + 1 < n && sol[at(b + 1)] === sol[i]) b++;
      clue = Object.assign({ type: 'bar', axis }, numClue(b - a + 1));
    }
    if (type === 'poly') {
      const comp = [i], seen = new Set([i]);
      for (let q = 0; q < comp.length; q++) for (const d of [0, 2, 4, 6]) { const j = S.neighborDir(n, comp[q], d); if (j >= 0 && !seen.has(j) && sol[j] === sol[i]) { seen.add(j); comp.push(j); } }
      if (comp.length <= 6) clue = { type: 'poly', shape: comp.map((v) => [Math.floor(v / n), v % n]) };
    }
    if (type === 'mirror' && !mirrorDone) {
      for (const d of [2, 4, 3, 5]) {
        const ray = S.rayCells(n, i, d);
        for (let t = 1; t < ray.length; t++) {
          const seg = [i].concat(ray.slice(0, t + 1));
          if (seg.every((v, q) => sol[v] === sol[seg[seg.length - 1 - q]]) && !used.has(ray[t])) {
            used.add(ray[t]); p.cells[ray[t]] = { color: sol[ray[t]], clue: { type: 'mirror', dir: (d + 4) % 8 } };
            clue = { type: 'mirror', dir: d }; mirrorDone = true; break;
          }
        }
        if (clue) break;
      }
    }
    if (!clue) { continue; }
    const hideColor = rules.includes('preview') && clue.k != null && rnd() < 0.3;
    p.cells[i] = { color: hideColor ? null : sol[i], clue };
  }
  // 行列線索
  let strip = null;
  if (rules.includes('code')) {
    const r = Math.floor(rnd() * n), c = Math.floor(rnd() * (n - 2));
    strip = [0, 1, 2].map((t) => r * n + c + t);
    strip.forEach((v, t) => { p.cells[v] = { color: rnd() < 0.5 ? sol[v] : null, clue: { type: 'code', pos: t + 1, orient: 'h' } }; });
  }
  for (const kind of ['row', 'col']) {
    for (let idx = 0; idx < n; idx++) {
      const cells = S.lineCells(n, kind, idx), lc = {};
      if (rules.includes('count') && rnd() < 0.4) { const color = Math.floor(rnd() * K); lc.count = Object.assign({ color }, numClue(cells.filter((v) => sol[v] === color).length)); }
      if (rules.includes('major') && rnd() < 0.4) {
        const cnt = Array.from({ length: K }, (_, c) => cells.filter((v) => sol[v] === c).length), mx = Math.max(...cnt);
        lc.major = { color: cnt.filter((x) => x === mx).length > 1 ? null : cnt.indexOf(mx) };
      }
      if (strip && rnd() < 0.5) {
        const code = strip.map((v) => sol[v]);
        let has = false;
        for (let q = 0; q + 3 <= n; q++) if (code.every((c, t) => sol[cells[q + t]] === c)) has = true;
        lc.code = has ? 'o' : 'x';
      }
      const runs = []; for (let q = 0; q < n; q++) { if (q && sol[cells[q]] === sol[cells[q - 1]]) runs[runs.length - 1].len++; else runs.push({ c: sol[cells[q]], len: 1 }); }
      if (rules.includes('streak') && rnd() < 0.4) lc.streak = numClue(Math.max(...runs.map((x) => x.len)));
      if (rules.includes('double') && rnd() < 0.4) lc.double = numClue(runs.filter((x) => x.len === 2).length);
      if (rules.includes('blocks') && rnd() < 0.4) { const color = Math.floor(rnd() * K); lc.blocks = Object.assign({ color }, numClue(runs.filter((x) => x.c === color).length)); }
      (kind === 'row' ? p.rows : p.cols)[idx] = lc;
    }
  }
  return { p, sol, truthAux };
}

const RULESETS = [
  ['num', 'bar'], ['num', 'poly'], ['num', 'mirror'], ['streak', 'num'], ['double', 'num'], ['blocks', 'num'], ['streak', 'double', 'blocks', 'bar', 'poly', 'mirror', 'fake'],
  ['num'], ['num', 'ray'], ['num', 'knight'], ['num', 'sym'], ['sym'], ['num', 'pair'],
  ['num', 'count'], ['count', 'major'], ['num', 'major'], ['num', 'code'], ['num', 'fake'],
  ['num', 'preview'], ['num', 'ray', 'knight', 'sym', 'pair', 'count', 'major', 'code', 'fake', 'preview'],
];
const stats = {};
let unsound = 0, errors = 0;
const t0 = Date.now();
for (let t = 0; t < 200; t++) {
  const rules = RULESETS[t % RULESETS.length];
  const n = 5 + (t % 3), K = rules.includes('code') || t % 4 === 0 ? 4 : 3;
  const { p, sol, truthAux } = gen(n, K, rules);
  const model = S.buildModel(p, null);
  let dom = S.initialDomains(p);
  const key = rules.join('+');
  stats[key] = stats[key] || { runs: 0, solved: 0, steps: 0, lv: [0, 0, 0, 0, 0] };
  stats[key].runs++;
  for (let guard = 0; guard < 400; guard++) {
    const r = S.nextStep(model, dom);
    if (r.status === 'error') { errors++; console.log('ERROR', key, r.html.replace(/<[^>]+>/g, '')); break; }
    if (r.status === 'done') { if (!r.unconstrained.length) stats[key].solved++; break; }
    if (r.status === 'stuck') break;
    for (const e of r.step.effects) {
      let truth;
      if (e.v < n * n) truth = sol[e.v]; else if (truthAux.has(e.v)) truth = truthAux.get(e.v); else continue;
      if ((truth === e.c) !== e.val) { unsound++; console.log('UNSOUND', key, r.step.kind, r.step.short); }
    }
    stats[key].steps++; stats[key].lv[r.step.level]++;
    dom = S.applyEffects(dom, r.step.effects);
  }
}
console.log(JSON.stringify(stats));
console.log('unsound', unsound, 'errors', errors, 'ms', Date.now() - t0);
