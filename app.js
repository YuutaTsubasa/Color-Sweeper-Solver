(function () {
  'use strict';
  const S = window.CSSolver;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'colorsweeper-puzzle-v2';
  const COLOR_HOTKEYS = ['q', 'w', 'e', 'r'];
  const ROMAN = ['I', 'II', 'III'];
  const CLUE_TYPES = [
    ['none', '無'], ['num', '數字'], ['ray', '射線'], ['knight', '騎士'], ['bar', '棒狀'], ['poly', '多邊形'],
    ['sym', '符號'], ['pair', '成對'], ['mirror', '對稱'], ['code', '密碼格'],
  ];
  // 帶數字的格子線索
  const NUM_TYPES = ['num', 'ray', 'knight', 'bar'];
  // 對稱線索的三角形：以「→」為基準旋轉
  const dirAngle = (d) => (d - 2) * 45;

  // 範例：基本 + 射線 + 列計數 + 欄主要
  const SAMPLE = '{"n":6,"K":3,"cells":[{"color":null,"clue":null},{"color":0,"clue":{"type":"num","k":0}},{"color":2,"clue":{"type":"ray","dir":2,"k":1}},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":0,"clue":{"type":"num","k":1}},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":0,"clue":{"type":"num","k":3}},{"color":1,"clue":{"type":"num","k":1}},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":0,"clue":{"type":"num","k":2}},{"color":2,"clue":{"type":"num","k":2}},{"color":null,"clue":null},{"color":null,"clue":null},{"color":1,"clue":{"type":"num","k":2}},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":null,"clue":null},{"color":0,"clue":{"type":"ray","dir":2,"k":0}},{"color":null,"clue":null}],"rows":[{},{"count":{"color":1,"k":3}},{"count":{"color":2,"k":2}},{},{"count":{"color":1,"k":2}},{}],"cols":[{"major":{"color":1}},{"major":{"color":0}},{"major":{"color":null}},{"major":{"color":2}},{},{"major":{"color":2}}]}';

  // 網址 #p=… 帶的盤面（分享連結）優先
  const fromLink = loadFromHash();
  let puzzle = fromLink || load() || S.parse(SAMPLE);
  let mode = 'edit';
  let sel = 0;              // 選取的格子
  let selLine = null;       // 選取的行列 {kind, idx}
  let lastColor = 0;
  // 解題狀態
  let model = null, dom = null, history = [], log = [], current = null, revealed = true;
  let reveal = new Map();   // 解出的格子在遊戲中顯示的線索：i → clue 或 null（沒有線索）

  function load() {
    try { const t = localStorage.getItem(STORE_KEY); return t ? S.parse(t) : null; } catch (e) { return null; }
  }
  // 盤面編進網址：base64url(JSON)
  function puzzleLink() {
    const b64 = btoa(unescape(encodeURIComponent(S.serialize(Object.assign({}, puzzle, { colors: palette() }))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.href.split('#')[0] + '#p=' + b64;
  }
  function loadFromHash() {
    const m = /^#p=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return null;
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      return S.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) { return null; }
  }

  // 換成另一個盤面時，舊的解題進度不能沿用
  function resetSolveState() {
    dom = null; model = null; solvedFor = null; current = null; history = []; log = []; reveal = new Map();
    try { localStorage.removeItem(SOLVE_KEY); } catch (e) { /* 無所謂 */ }
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, S.serialize(puzzle)); } catch (e) { /* 無法儲存就算了 */ }
  }

  const NC = () => puzzle.n * puzzle.n;
  const usedColors = () => puzzle.used || [0, 1, 2];

  // ---------- 配色：每個人的遊戲配色不同，存在這台裝置上 ----------
  const THEME_KEY = 'colorsweeper-theme';
  const DEFAULT_THEME = [
    { name: '紫', hex: '#cdc9ec' }, { name: '藍', hex: '#4570f5' }, { name: '粉', hex: '#ec4a83' }, { name: '綠', hex: '#6dd5a6' },
  ];
  let theme = loadTheme();

  function loadTheme() {
    try {
      const t = JSON.parse(localStorage.getItem(THEME_KEY));
      if (Array.isArray(t) && t.length === 4 && t.every((x) => /^#[0-9a-f]{6}$/i.test(x.hex))) return t;
    } catch (e) { /* 用預設 */ }
    return DEFAULT_THEME.map((x) => Object.assign({}, x));
  }
  function saveTheme() { try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch (e) { /* 無法儲存就算了 */ } }

  // 依底色亮度決定文字用黑或白；邊框/✕ 用加深一點的顏色
  function hexRgb(hex) { const v = parseInt(hex.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
  function shade(hex, f) { return '#' + hexRgb(hex).map((x) => Math.round(x * f).toString(16).padStart(2, '0')).join(''); }
  function luminance(hex) { const [r, g, b] = hexRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

  // 盤面可以附帶自己的配色（例如分享連結）；沒有就用「我的配色」
  const validColors = (c) => Array.isArray(c) && c.length === 4 && c.every((x) => x && /^#[0-9a-f]{6}$/i.test(x.hex));
  const palette = () => (validColors(puzzle.colors) ? puzzle.colors : theme);

  function applyTheme() {
    const root = document.documentElement.style;
    palette().forEach((t, k) => {
      const light = luminance(t.hex) > 0.6;
      root.setProperty(`--c${k}-bg`, t.hex);
      root.setProperty(`--c${k}-fg`, light ? '#2b2a33' : '#ffffff');
      root.setProperty(`--c${k}`, light ? shade(t.hex, 0.7) : t.hex);
    });
    S.setColorNames(palette().map((t) => t.name || '?'));
  }

  // 這題用到的顏色：點色塊切換（遊戲 2 色、4 色時每次隨機抽顏色，照當下畫面點即可）
  function renderUsedColors() {
    const used = new Set(usedColors());
    $('used-colors').innerHTML = palette().map((t, k) =>
      `<button class="swatch${used.has(k) ? ' on' : ''}" data-slot="${k}" style="background:${t.hex}" title="${t.name}"><span>${used.has(k) ? '✓' : ''}</span></button>`).join('') +
      `<span class="hint">這題 ${used.size} 色</span>`;
  }
  function toggleUsed(k) {
    const used = new Set(usedColors());
    if (used.has(k)) {
      if (used.size <= 2) { flash('至少要 2 種顏色'); return; }
      const inUse = puzzle.cells.some((c) => c.color === k) ||
        puzzle.rows.concat(puzzle.cols).some((lc) => lc && ((lc.count && lc.count.color === k) || (lc.major && lc.major.color === k) || (lc.blocks && lc.blocks.color === k)));
      if (inUse) { flash(`盤面上還有用到「${palette()[k].name}」，先改掉那些格子或線索再取消`); return; }
      used.delete(k);
    } else used.add(k);
    puzzle.used = [...used].sort();
    if (!puzzle.used.includes(lastColor)) lastColor = puzzle.used[0];
    save(); syncSettings(); render();
  }

  function renderThemeEditor() {
    const own = palette() !== theme;
    $('theme-owner').innerHTML = own
      ? '這題<b>附帶自己的配色</b>（來自分享連結），下面修改的是這題的配色。' +
        '<button id="btn-colors-save" class="ghost">存成我的配色</button><button id="btn-colors-drop" class="ghost">改用我的配色</button>'
      : '';
    $('theme-editor').innerHTML = palette().map((t, k) =>
      `<div class="row"><input type="color" data-slot="${k}" value="${t.hex}"><input type="text" data-slot="${k}" value="${t.name}" maxlength="4" class="tname"></div>`).join('');
  }
  const isSolved = (i) => mode === 'solve' && puzzle.cells[i].color == null && S.single(dom[i]) >= 0;
  const allSolved = () => dom.slice(0, NC()).every((m) => S.single(m) >= 0);
  const pendingCells = () => (allSolved() ? []
    : Array.from({ length: NC() }, (_, i) => i).filter((i) => isSolved(i) && !reveal.has(i) && puzzle.cells[i].clue == null));

  // ---------- 線索顯示 ----------

  const isFake = (k) => !!puzzle.fake && k > 0 && k % 2 === 0;

  function clueHTML(clue, i) {
    if (!clue) return '';
    const fake = isFake(clue.k) ? ' fake' : '';
    switch (clue.type) {
      case 'num': return `<span class="num${fake}">${clue.k}</span>`;
      case 'ray': return `<span class="num sm${fake}">${clue.k}</span><span class="arrow">${S.DIRS[clue.dir][2]}</span>`;
      case 'knight': return `<span class="glyph">♞</span>${clue.k != null && clue.k !== 1 ? `<span class="sub${fake}">${clue.k}</span>` : ''}`;
      case 'sym': return `<span class="glyph">${S.SYMBOLS[clue.id]}</span>`;
      case 'pair': return `<span class="pair-mark d${clue.dir}">◀▶</span>`;
      case 'code': return `<span class="code-mark">${clue.pos > 1 ? (clue.orient === 'v' ? '⌄' : '›') : ''}${ROMAN[clue.pos - 1]}${clue.pos < 3 ? (clue.orient === 'v' ? '⌄' : '›') : ''}</span>`;
      case 'bar': return `<span class="num bar-${clue.axis === 'v' ? 'v' : 'h'}${fake}">${clue.k}</span>`;
      case 'poly': return shapeHTML(clue.shape || []);
      case 'mirror': return `<span class="glyph tri" style="transform:rotate(${dirAngle(clue.dir)}deg)">▶</span>`;
      default: return '';
    }
  }

  // 多邊形線索：把形狀畫成小方塊
  function shapeHTML(shape) {
    if (!shape.length) return '<span class="glyph">▦</span>';
    const mr = Math.min(...shape.map((p) => p[0])), mc = Math.min(...shape.map((p) => p[1]));
    const h = Math.max(...shape.map((p) => p[0])) - mr + 1, w = Math.max(...shape.map((p) => p[1])) - mc + 1;
    const on = new Set(shape.map(([r, c]) => `${r - mr},${c - mc}`));
    let cells = '';
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells += `<i class="${on.has(`${r},${c}`) ? 'on' : ''}"></i>`;
    return `<span class="shape" style="grid-template-columns:repeat(${w},1fr)">${cells}</span>`;
  }

  function lineBadges(lc) {
    if (!lc) return '';
    const out = [];
    if (lc.streak) out.push(`<span class="badge cx${isFake(lc.streak.k) ? ' fake' : ''}" title="連線：最長方塊">━${lc.streak.k}</span>`);
    if (lc.double) out.push(`<span class="badge cx${isFake(lc.double.k) ? ' fake' : ''}" title="雙格：長度 2 的方塊數">▮▮${lc.double.k}</span>`);
    if (lc.blocks) out.push(`<span class="badge sq c${lc.blocks.color}${isFake(lc.blocks.k) ? ' fake' : ''}" title="方格：該色方塊數">${lc.blocks.k}</span>`);
    if (lc.count) out.push(`<span class="badge c${lc.count.color}${isFake(lc.count.k) ? ' fake' : ''}">${lc.count.k}</span>`);
    if (lc.major) out.push(lc.major.color == null ? '<span class="badge cx">⚔</span>' : `<span class="badge c${lc.major.color}">👑</span>`);
    if (lc.code) out.push(`<span class="badge cx">${lc.code === 'o' ? '◎' : '⊘'}</span>`);
    return out.join('');
  }

  // 已排除的顏色：在格子左上角畫小 ✕
  function xMarks(i) {
    const m = dom[i], xs = [];
    for (const k of usedColors()) if (!(m & S.bit(k))) xs.push(`<span class="c${k}">✕</span>`);
    return xs.length ? `<span class="xs">${xs.join('')}</span>` : '';
  }

  // 目前格子實際的「顏色、線索」（解題中含解出的顏色與新線索）
  function effCell(i) {
    const cell = puzzle.cells[i];
    if (mode === 'solve' && cell.color == null) {
      const s = S.single(dom[i]);
      if (s >= 0 && reveal.get(i)) return { color: s, clue: reveal.get(i), solved: true };
      if (s >= 0) return { color: s, clue: cell.clue, solved: true };
    }
    return { color: cell.color, clue: cell.clue, solved: false };
  }

  // ---------- 盤面繪製 ----------

  function render() {
    const n = puzzle.n, board = $('board');
    board.style.setProperty('--n', n);
    const targets = new Map(), refs = new Set(), shared = new Set();
    if (mode === 'solve' && current && current.step) {
      if (revealed) current.step.effects.forEach((e) => { if (e.v < NC()) targets.set(e.v, e); });
      current.step.refs.forEach((r) => { if (r < NC()) refs.add(r); });
      if (revealed) (current.step.shared || []).forEach((r) => shared.add(r));
    }
    const contra = mode === 'solve' && current && current.contradiction;
    const contraCells = new Set();
    if (contra) { if (contra.v != null) contraCells.add(contra.v); if (contra.con) contra.con.refs.forEach((r) => contraCells.add(r)); }
    const pendingSet = new Set(mode === 'solve' ? pendingCells() : []);

    const html = ['<div class="corner"></div>'];
    for (let c = 0; c < n; c++) {
      const s = selLine && selLine.kind === 'col' && selLine.idx === c ? ' selected' : '';
      html.push(`<div class="hdr top${s}" data-kind="col" data-idx="${c}"><div class="badges">${lineBadges(puzzle.cols[c])}</div><span class="coord">${String.fromCharCode(65 + c)}</span></div>`);
    }
    for (let r = 0; r < n; r++) {
      const s = selLine && selLine.kind === 'row' && selLine.idx === r ? ' selected' : '';
      html.push(`<div class="hdr left${s}" data-kind="row" data-idx="${r}"><div class="badges">${lineBadges(puzzle.rows[r])}</div><span class="coord">${r + 1}</span></div>`);
      for (let c = 0; c < n; c++) {
        const i = r * n + c, ec = effCell(i);
        const cls = ['cell'];
        let inner = '';
        if (ec.clue || (ec.color != null && !ec.solved)) {
          cls.push('clue', ec.color != null ? 'c' + ec.color : 'cu');
          let ch = clueHTML(ec.clue, i);
          if (mode === 'solve' && ec.clue && ['num', 'ray', 'knight'].includes(ec.clue.type) && ec.color != null) {
            const area = ec.clue.type === 'num' ? S.neighbors(n, i) : ec.clue.type === 'ray' ? S.rayCells(n, i, ec.clue.dir) : S.knightCells(n, i);
            if (area.every((j) => S.single(dom[j]) >= 0)) ch = `<span class="spent">${ch}</span>`;
          }
          inner = ch;
          // 顏色未知的線索格（密碼格、預覽數字）也要顯示已排除的顏色
          if (mode === 'solve' && ec.color == null) inner += xMarks(i);
        } else if (ec.color != null) {
          inner = `<span class="fill c${ec.color}"></span>`;
          if (pendingSet.has(i)) inner += '<span class="pending" title="還沒輸入遊戲中這格的線索">?</span>';
        } else if (mode === 'solve') {
          inner = xMarks(i);
        }
        if (i === sel && !selLine) cls.push('selected');
        if (targets.has(i)) {
          const e = targets.get(i);
          cls.push('target', 't' + e.c);
          inner += `<span class="tag">${e.val ? '●' : '✕'}</span>`;
        }
        if (refs.has(i)) cls.push('ref');
        if (shared.has(i)) cls.push('shared');
        if (contraCells.has(i)) cls.push('contra');
        html.push(`<div class="${cls.join(' ')}" data-i="${i}" title="${S.cellName(n, i)}">${inner}</div>`);
      }
    }
    board.innerHTML = html.join('');
    renderCellInfo();
    renderKnowledge();
    if (mode === 'edit') renderCellEditor();
    renderRevealBox();
  }

  function renderCellInfo() {
    const n = puzzle.n;
    if (selLine) { $('cell-info').textContent = `選取：${selLine.kind === 'row' ? `第 ${selLine.idx + 1} 列` : `第 ${String.fromCharCode(65 + selLine.idx)} 欄`}`; return; }
    const ec = effCell(sel);
    let t = `選取：${S.cellName(n, sel)}`;
    if (ec.color != null) t += ` ・ ${S.PALETTE[ec.color].name}${ec.solved ? '（已解出）' : ''}`;
    else if (mode === 'solve') {
      const opts = S.bitsOf(dom[sel]).map((k) => S.PALETTE[k].name);
      t += ` ・ 可能：${opts.join('、')}`;
      if (!model.relevant.has(sel)) t += '（沒有線索涵蓋這格）';
    } else t += ' ・ 顏色未知';
    $('cell-info').textContent = t;
  }

  // 解題中：符號圖案與密碼的已知資訊
  function renderKnowledge() {
    const box = $('knowledge');
    if (mode !== 'solve') { box.innerHTML = ''; return; }
    const parts = [];
    const used = new Set();
    for (let i = 0; i < NC(); i++) { const ec = effCell(i); if (ec.clue && ec.clue.type === 'sym') used.add(ec.clue.id); }
    const auxTargets = new Set(current && current.step && revealed ? current.step.effects.filter((e) => e.v >= NC()).map((e) => e.v) : []);
    // 3×3 迷你圖的方向排列
    const LAYOUT = [7, 0, 1, 6, -1, 2, 5, 4, 3];
    for (const id of [...used].sort()) {
      const cells = LAYOUT.map((d) => {
        if (d < 0) return `<span class="mc center">${S.SYMBOLS[id]}</span>`;
        const v = NC() + id * 8 + d, m = dom[v];
        const t = auxTargets.has(v) ? ' hit' : '';
        if (m === 1) return `<span class="mc same${t}" title="同色">=</span>`;
        if (m === 2) return `<span class="mc diff${t}" title="異色">≠</span>`;
        return `<span class="mc unk${t}">?</span>`;
      });
      parts.push(`<div class="sym-card"><div class="mini">${cells.join('')}</div><div class="hint">符號 ${S.SYMBOLS[id]}</div></div>`);
    }
    if (model.strip.length >= 2) {
      const chips = model.strip.map((v, t) => {
        const s = S.single(dom[v]);
        return s >= 0 ? `<span class="badge c${s}">${ROMAN[t]}</span>` : `<span class="badge cu">${ROMAN[t]}?</span>`;
      });
      parts.push(`<div class="sym-card"><div class="row">${chips.join('')}</div><div class="hint">密碼</div></div>`);
    }
    box.innerHTML = parts.length ? `<div class="hint">已知圖案（= 同色、≠ 異色、? 未知）</div><div class="row">${parts.join('')}</div>` : '';
  }

  // ---------- 線索編輯器（編輯模式與解題中補輸入共用） ----------

  function btn(label, data, on, extra) {
    return `<button class="ghost opt${on ? ' sel' : ''}${extra ? ' ' + extra : ''}" ${data}>${label}</button>`;
  }
  function maxCountFor(i, clue) {
    const n = puzzle.n;
    if (clue.type === 'ray') return S.rayCells(n, i, clue.dir).length;
    if (clue.type === 'knight') return S.knightCells(n, i).length;
    if (clue.type === 'bar') return n;
    return S.neighbors(n, i).length;
  }

  // 回傳 HTML；事件以 data-act 屬性處理
  function clueEditorHTML(i, clue) {
    const type = clue ? clue.type : 'none';
    let h = '<div class="row">' + CLUE_TYPES.map(([t, nm]) => btn(nm, `data-act="type" data-v="${t}"`, t === type)).join('') + '</div>';
    if (!clue) return h;
    if (clue.type === 'ray') {
      h += '<div class="row"><span class="lbl-s">方向</span>' + [0, 2, 4, 6].map((d) => btn(S.DIRS[d][2], `data-act="dir" data-v="${d}"`, clue.dir === d)).join('') + '</div>';
    }
    if (clue.type === 'bar') {
      h += '<div class="row"><span class="lbl-s">方向</span>' +
        btn('橫向（數字上下有槓）', 'data-act="axis" data-v="h"', clue.axis !== 'v') +
        btn('直向（數字左右有槓）', 'data-act="axis" data-v="v"', clue.axis === 'v') + '</div>';
    }
    if (clue.type === 'mirror') {
      h += '<div class="row"><span class="lbl-s">指向</span>' + [0, 1, 2, 3, 4, 5, 6, 7].map((d) => btn(S.DIRS[d][2], `data-act="dir" data-v="${d}"`, clue.dir === d)).join('') + '</div>' +
        '<p class="hint">兩個互相指向的對稱線索之間（含兩端），顏色排列會左右對稱。</p>';
    }
    if (clue.type === 'poly') {
      // 5×5 小畫板：點格子切換，畫出遊戲中的形狀
      const on = new Set((clue.shape || []).map(([r, c]) => `${r},${c}`));
      let g = '';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) g += `<button class="pcell${on.has(`${r},${c}`) ? ' on' : ''}" data-act="shape" data-v="${r},${c}"></button>`;
      h += `<div class="row"><span class="lbl-s">形狀</span><div class="pgrid">${g}</div>${btn('清除形狀', 'data-act="shape-clear"', false)}</div>` +
        `<p class="hint">照遊戲線索上的小圖點出形狀（${on.size} 格）。可以旋轉，不能翻轉，位置不用對齊。</p>`;
    }
    if (NUM_TYPES.includes(clue.type)) {
      const max = maxCountFor(i, clue), k = clue.k == null ? 1 : clue.k;
      h += '<div class="row"><span class="lbl-s">數字</span>' + Array.from({ length: max + 1 }, (_, v) => btn(v, `data-act="k" data-v="${v}"`, k === v, 'numbtn')).join('') + '</div>';
    }
    if (clue.type === 'sym') {
      h += '<div class="row"><span class="lbl-s">符號</span>' + S.SYMBOLS.map((g, id) => btn(g, `data-act="sym" data-v="${id}"`, clue.id === id, 'glyphbtn')).join('') + '</div>' +
        '<p class="hint">遊戲中的符號圖示不一定一樣，只要同一種符號選同一個就好。</p>';
    }
    if (clue.type === 'pair') {
      h += '<div class="row"><span class="lbl-s">另一格在</span>' + [[2, '右邊 →'], [4, '下面 ↓'], [6, '左邊 ←'], [0, '上面 ↑']].map(([d, nm]) => btn(nm, `data-act="dir" data-v="${d}"`, clue.dir === d)).join('') + '</div>';
    }
    if (clue.type === 'code') {
      h += '<div class="row"><span class="lbl-s">第幾位</span>' + [1, 2, 3].map((p) => btn(ROMAN[p - 1], `data-act="pos" data-v="${p}"`, clue.pos === p)).join('') + '</div>';
      h += '<div class="row"><span class="lbl-s">方向</span>' + btn('橫向（左→右）', 'data-act="orient" data-v="h"', clue.orient !== 'v') + btn('直向（上→下）', 'data-act="orient" data-v="v"', clue.orient === 'v') + '</div>';
    }
    return h;
  }

  function applyClueAct(clue, act, v, checked) {
    if (act === 'type') {
      if (v === 'none') return null;
      if (clue && clue.type === v) return clue;
      if (v === 'num') return { type: 'num', k: clue && clue.k != null ? clue.k : 1 };
      if (v === 'ray') return { type: 'ray', dir: 2, k: clue && clue.k != null ? clue.k : 1 };
      if (v === 'knight') return { type: 'knight', k: 1 };
      if (v === 'sym') return { type: 'sym', id: 0 };
      if (v === 'pair') return { type: 'pair', dir: 2 };
      if (v === 'code') return { type: 'code', pos: 1, orient: 'h' };
      if (v === 'bar') return { type: 'bar', axis: 'h', k: clue && clue.k != null ? clue.k : 1 };
      if (v === 'poly') return { type: 'poly', shape: [[0, 0]] };
      if (v === 'mirror') return { type: 'mirror', dir: 2 };
    }
    const c = Object.assign({}, clue);
    if (act === 'axis') c.axis = v;
    if (act === 'shape-clear') c.shape = [];
    if (act === 'shape') {
      const [r, cc] = v.split(',').map(Number);
      const rest = (c.shape || []).filter(([a, b]) => a !== r || b !== cc);
      c.shape = rest.length < (c.shape || []).length ? rest : rest.concat([[r, cc]]);
    }
    if (act === 'k') c.k = Number(v);
    if (act === 'dir') c.dir = Number(v);
    if (act === 'fake') c.fake = checked || undefined;
    if (act === 'sym') c.id = Number(v);
    if (act === 'pos') c.pos = Number(v);
    if (act === 'orient') c.orient = v;
    return c;
  }

  function lineEditorHTML(lc) {
    let h = `<h3>${selLine.kind === 'row' ? `第 ${selLine.idx + 1} 列` : `第 ${String.fromCharCode(65 + selLine.idx)} 欄`} 的線索</h3>`;
    h += '<div class="row"><span class="lbl-s">計數</span>' + btn('無', 'data-lact="count-color" data-v="-1"', !lc.count) +
      usedColors().map((c) => btn(S.PALETTE[c].name, `data-lact="count-color" data-v="${c}"`, lc.count && lc.count.color === c, `colbtn c${c}`)).join('') + '</div>';
    if (lc.count) {
      h += '<div class="row"><span class="lbl-s">數量</span>' + Array.from({ length: puzzle.n + 1 }, (_, v) => btn(v, `data-lact="count-k" data-v="${v}"`, lc.count.k === v, 'numbtn')).join('') + '</div>';
    }
    h += '<div class="row"><span class="lbl-s">主要</span>' + btn('無', 'data-lact="major" data-v="none"', !lc.major) +
      usedColors().map((c) => btn('👑' + S.PALETTE[c].name, `data-lact="major" data-v="${c}"`, lc.major && lc.major.color === c, `colbtn c${c}`)).join('') +
      btn('⚔ 平手', 'data-lact="major" data-v="tie"', lc.major && lc.major.color == null) + '</div>';
    h += '<div class="row"><span class="lbl-s">密碼</span>' + btn('無', 'data-lact="code" data-v="none"', !lc.code) +
      btn('◎ 有出現', 'data-lact="code" data-v="o"', lc.code === 'o') + btn('⊘ 不會出現', 'data-lact="code" data-v="x"', lc.code === 'x') + '</div>';
    const numRow = (label, act, cur, max) => `<div class="row"><span class="lbl-s">${label}</span>` + btn('無', `data-lact="${act}" data-v="-1"`, cur == null) +
      Array.from({ length: max + 1 }, (_, v) => btn(v, `data-lact="${act}" data-v="${v}"`, cur === v, 'numbtn')).join('') + '</div>';
    h += numRow('連線', 'streak', lc.streak ? lc.streak.k : null, puzzle.n);
    h += numRow('雙格', 'double', lc.double ? lc.double.k : null, Math.floor(puzzle.n / 2));
    h += '<div class="row"><span class="lbl-s">方格</span>' + btn('無', 'data-lact="blocks-color" data-v="-1"', !lc.blocks) +
      usedColors().map((c) => btn(S.PALETTE[c].name, `data-lact="blocks-color" data-v="${c}"`, lc.blocks && lc.blocks.color === c, `colbtn c${c}`)).join('') + '</div>';
    if (lc.blocks) {
      h += '<div class="row"><span class="lbl-s">方塊數</span>' + Array.from({ length: Math.ceil(puzzle.n / 2) + 1 }, (_, v) => btn(v, `data-lact="blocks-k" data-v="${v}"`, lc.blocks.k === v, 'numbtn')).join('') + '</div>';
    }
    h += '<p class="hint">計數＝該色格數；方格＝該色方塊數；連線＝最長方塊長度；雙格＝長度 2 的方塊數。</p>';
    return h;
  }

  function renderCellEditor() {
    const box = $('cell-editor');
    if (selLine) {
      const arr = selLine.kind === 'row' ? puzzle.rows : puzzle.cols;
      box.innerHTML = lineEditorHTML(arr[selLine.idx] || {});
      return;
    }
    const cell = puzzle.cells[sel];
    let h = `<h3>${S.cellName(puzzle.n, sel)} 格子</h3>`;
    h += '<div class="row"><span class="lbl-s">顏色</span>' + btn('未知', 'data-act="color" data-v="-1"', cell.color == null) +
      usedColors().map((c, idx) => btn(`${S.PALETTE[c].name} <kbd>${COLOR_HOTKEYS[idx].toUpperCase()}</kbd>`, `data-act="color" data-v="${c}"`, cell.color === c, `colbtn c${c}`)).join('') + '</div>';
    h += '<div class="lbl-s">線索</div>' + clueEditorHTML(sel, cell.clue);
    if (cell.clue && cell.color == null && NUM_TYPES.includes(cell.clue.type)) {
      h += '<p class="hint">顏色未知的數字線索 = 預覽規則（顏色要填色後才知道）。</p>';
    }
    box.innerHTML = h;
  }

  // ---------- 編輯 ----------

  function setCellColor(c) {
    const cell = puzzle.cells[sel];
    cell.color = c < 0 ? null : c;
    if (c >= 0) lastColor = c;
    save(); render();
  }
  function setCellClue(clue) {
    const cell = puzzle.cells[sel];
    if (clue && NUM_TYPES.includes(clue.type)) clue.k = Math.min(clue.k == null ? 1 : clue.k, maxCountFor(sel, clue));
    if (clue && !cell.clue && cell.color == null && clue.type !== 'code') cell.color = lastColor;
    cell.clue = clue;
    save(); render();
  }
  function setLine(act, v, checked) {
    const arr = selLine.kind === 'row' ? puzzle.rows : puzzle.cols;
    const lc = Object.assign({}, arr[selLine.idx] || {});
    if (act === 'count-color') lc.count = v < 0 ? undefined : Object.assign({ k: 0 }, lc.count, { color: Number(v) });
    if (act === 'count-k') lc.count = Object.assign({}, lc.count, { k: Number(v) });
    if (act === 'count-fake') lc.count = Object.assign({}, lc.count, { fake: checked || undefined });
    if (act === 'major') lc.major = v === 'none' ? undefined : { color: v === 'tie' ? null : Number(v) };
    if (act === 'code') lc.code = v === 'none' ? undefined : v;
    if (act === 'streak') lc.streak = Number(v) < 0 ? undefined : { k: Number(v) };
    if (act === 'double') lc.double = Number(v) < 0 ? undefined : { k: Number(v) };
    if (act === 'blocks-color') lc.blocks = Number(v) < 0 ? undefined : Object.assign({ k: 1 }, lc.blocks, { color: Number(v) });
    if (act === 'blocks-k') lc.blocks = Object.assign({}, lc.blocks, { k: Number(v) });
    arr[selLine.idx] = JSON.parse(JSON.stringify(lc));
    save(); render();
  }
  function flash(msg) { $('cell-info').textContent = msg; }

  function resize(n) {
    n = Math.max(3, Math.min(12, n | 0));
    const old = puzzle, np = S.emptyPuzzle(n, usedColors());
    np.fake = old.fake;
    if (old.colors) np.colors = old.colors;
    for (let r = 0; r < Math.min(n, old.n); r++) {
      for (let c = 0; c < Math.min(n, old.n); c++) {
        const cell = Object.assign({}, old.cells[r * old.n + c]);
        np.cells[r * n + c] = cell;
      }
      np.rows[r] = old.rows[r] || {};
      np.cols[r] = old.cols[r] || {};
    }
    puzzle = np; sel = 0; selLine = null; resetSolveState(); save(); render();
  }

  // ---------- 解題 ----------

  function rebuildModel() {
    const ov = new Map();
    for (let i = 0; i < NC(); i++) {
      if (puzzle.cells[i].color == null && S.single(dom[i]) >= 0 && reveal.get(i)) ov.set(i, { color: S.single(dom[i]), clue: reveal.get(i) });
    }
    model = S.buildModel(puzzle, ov);
    saveSolve();
  }

  // ---------- 解題進度保存：切換分頁或重新整理都不會不見 ----------
  const SOLVE_KEY = 'colorsweeper-solve';
  let solvedFor = null; // 目前進度對應的盤面內容

  function saveSolve() {
    solvedFor = S.serialize(puzzle);
    try { localStorage.setItem(SOLVE_KEY, JSON.stringify({ p: solvedFor, dom, reveal: [...reveal], log })); } catch (e) { /* 無法儲存就算了 */ }
  }
  function loadSolve() {
    try { return JSON.parse(localStorage.getItem(SOLVE_KEY)); } catch (e) { return null; }
  }

  // 進入解題分頁：盤面沒改就原封不動接續；有改就保留已推出的結果，並提醒可以重新開始
  function enterSolve() {
    const key = S.serialize(puzzle);
    if (dom && model && solvedFor === key) { updateButtons(); render(); return; } // 連同顯示中的提示一起保留
    const prev = dom && solvedFor ? { p: solvedFor, dom, reveal: [...reveal], log } : loadSolve();
    const fresh = S.initialDomains(puzzle);
    if (!prev || !Array.isArray(prev.dom) || prev.dom.length !== fresh.length) { startSolve(); return; }
    dom = fresh.map((m, i) => m & prev.dom[i]);
    reveal = new Map((prev.reveal || []).filter(([i]) => puzzle.cells[i] && puzzle.cells[i].color == null));
    log = prev.log || []; history = []; current = null;
    rebuildModel(); renderLog();
    if (dom.some((m, i) => i < NC() && !m) || S.findContradiction(model, dom, null)) {
      startSolve();
      $('step').innerHTML = '<p class="hint">盤面修改後跟之前的解題進度有衝突，已重新開始。</p>';
      return;
    }
    $('step').innerHTML = prev.p === key
      ? '<p class="hint">已接續上次的解題進度。</p>'
      : '<p class="hint">已保留之前的解題進度。如果剛才修改的是<b>先前輸入錯誤的線索</b>，請按「重新開始」重新推理。</p>';
    updateButtons(); render();
  }

  function startSolve() {
    dom = S.initialDomains(puzzle);
    history = []; log = []; current = null; reveal = new Map();
    rebuildModel();
    renderLog();
    $('step').innerHTML = '<p class="hint">按「提示下一步」開始。推理由淺到深：單一線索 → 兩線索比對 → 假設法 → 窮舉。</p>';
    const bad = S.findContradiction(model, dom, S.fmt(model));
    if (bad) showResult({ status: 'error', html: `盤面有矛盾：${bad.html}。請檢查輸入是否正確。`, contradiction: bad });
    updateButtons();
    render();
  }

  const LV_NAME = ['', '基礎', '比對', '假設', '窮舉'];

  function showResult(res) {
    current = res;
    const box = $('step');
    if (res.status === 'step') {
      const st = res.step;
      if (!revealed) {
        box.innerHTML = `<h4><span class="lv lv${st.level}">Lv${st.level} ${LV_NAME[st.level]}</span> 看看框起來的線索</h4>` +
          '<p class="hint">想想看這些線索能推出什麼？再按一次「提示下一步」顯示推理與答案。</p>';
      } else {
        box.innerHTML = `<h4><span class="lv lv${st.level}">Lv${st.level} ${LV_NAME[st.level]}</span>${st.title}</h4><div>${st.html}</div>`;
      }
      const pend = pendingCells().length;
      if (st.level >= 3 && pend) {
        box.innerHTML += `<p class="tip">💡 有 ${pend} 格解出後還沒輸入線索（標 <b>?</b>）。遊戲裡如果有冒出新線索，先輸入進來，可能有更簡單的推法。</p>`;
      }
    } else if (res.status === 'done' && !res.unconstrained.length) {
      box.innerHTML = '<p class="done">🎉 全部解完了！</p>';
    } else if (res.status === 'done' || res.status === 'stuck') {
      const pend = pendingCells();
      let t = '<p><b>目前的線索推不下去了。</b></p>';
      if (pend.length) {
        t += `<p>遊戲中填好格子後可能會出現新線索。請看看這些剛解出的格子（標 <b>?</b>），把遊戲裡顯示的線索輸入進來（點格子 → 選線索；沒有就選「無」）：<br>${pend.map((i) => `<b class="cn">${S.cellName(puzzle.n, i)}</b>`).join('、')}</p>`;
        sel = pend[0]; selLine = null;
      } else {
        t += '<p class="hint">目前的線索不足以推定剩下的格子。請確認遊戲中的線索都有輸入（包含行列外的線索），或檢查是否有輸入錯誤。</p>';
      }
      box.innerHTML = t;
    } else {
      box.innerHTML = `<p class="bad">${res.html}</p>`;
    }
    updateButtons();
    render();
  }

  function compute(cb) {
    $('step').innerHTML = '<p class="hint">計算中…</p>';
    setTimeout(() => cb(S.nextStep(model, dom)), 10);
  }

  function hint() {
    if (current && current.status === 'step') {
      if (!revealed) { revealed = true; showResult(current); }
      return;
    }
    revealed = !$('opt-reveal').checked;
    compute(showResult);
  }

  function apply(then) {
    if (!current || current.status !== 'step') return;
    history.push(dom);
    dom = S.applyEffects(dom, current.step.effects);
    log.push(current.step.short);
    rebuildModel();
    renderLog();
    current = null;
    revealed = !$('opt-reveal').checked;
    if (then) compute(showResult); else { updateButtons(); render(); }
  }

  function undo() {
    if (!history.length) return;
    dom = history.pop(); log.pop(); rebuildModel(); renderLog();
    current = null;
    $('step').innerHTML = '<p class="hint">已復原一步。</p>';
    updateButtons(); render();
  }

  function solveAll() {
    $('step').innerHTML = '<p class="hint">計算中…</p>';
    setTimeout(() => {
      let res;
      for (let guard = 0; guard < 2000; guard++) {
        res = S.nextStep(model, dom);
        if (res.status !== 'step') break;
        history.push(dom);
        dom = S.applyEffects(dom, res.step.effects);
        log.push(res.step.short);
        rebuildModel();
      }
      renderLog();
      revealed = true;
      showResult(res);
    }, 10);
  }

  function renderLog() {
    $('log').innerHTML = log.map((t) => `<li>${t}</li>`).join('');
    $('log-count').textContent = log.length;
  }

  function updateButtons() {
    const hasStep = current && current.status === 'step';
    $('btn-apply').disabled = !hasStep || !revealed;
    $('btn-undo').disabled = !history.length;
    if (!dom) return;
    const total = puzzle.cells.filter((c) => c.color == null).length;
    const done = Array.from({ length: NC() }, (_, i) => i).filter(isSolved).length;
    const pend = pendingCells().length;
    $('progress').textContent = `已確定 ${done} / ${total} 格` + (pend ? ` ・ ${pend} 格待輸入線索（?）` : '');
    $('btn-none-rest').hidden = !pend;
  }

  // ---------- 解出格子的新線索 ----------

  function renderRevealBox() {
    const box = $('reveal-box');
    if (mode !== 'solve' || selLine || !isSolved(sel)) { box.hidden = true; return; }
    box.hidden = false;
    const s = S.single(dom[sel]);
    $('reveal-title').innerHTML = `<b class="cn">${S.cellName(puzzle.n, sel)}</b> 已解出為<span class="chip c${s}">${S.PALETTE[s].name}</span>，遊戲中這格顯示的線索是？` +
      (reveal.has(sel) ? '' : ' <span class="hint">（尚未輸入）</span>');
    $('reveal-editor').innerHTML = clueEditorHTML(sel, reveal.get(sel) || null);
  }

  function setReveal(clue) {
    if (!isSolved(sel)) return;
    if (clue && NUM_TYPES.includes(clue.type)) {
      const max = maxCountFor(sel, clue);
      if (clue.k > max) { flash(`${S.cellName(puzzle.n, sel)} 這個方向只有 ${max} 格`); return; }
    }
    const name = S.cellName(puzzle.n, sel);
    const wasNew = !reveal.has(sel);
    reveal.set(sel, clue);
    rebuildModel();
    current = null;
    const bad = S.findContradiction(model, dom, S.fmt(model));
    if (bad) {
      showResult({ status: 'error', html: `輸入 ${name} 的線索後出現矛盾：${bad.html}。請確認是否輸入正確。`, contradiction: bad });
      return;
    }
    $('step').innerHTML = `<p class="hint">已記錄 ${name} 的線索。繼續輸入其他標 ? 的格子，或按「提示下一步」。</p>`;
    // 數字或「無」輸入完就跳下一格；其他類型可能還要調整參數，停在原格
    if (wasNew && (!clue || clue.type === 'num')) {
      const pend = pendingCells();
      if (pend.length) sel = pend.find((i) => i > sel) ?? pend[0];
    }
    updateButtons(); render();
  }

  function noneForRest() {
    pendingCells().forEach((i) => reveal.set(i, null));
    rebuildModel(); current = null;
    $('step').innerHTML = '<p class="hint">其餘解出的格子都設為「沒有線索」。</p>';
    updateButtons(); render();
  }

  // 把目前進度（解出的顏色與線索）寫回輸入盤面
  function saveProgress() {
    for (let i = 0; i < NC(); i++) {
      if (isSolved(i)) puzzle.cells[i] = { color: S.single(dom[i]), clue: reveal.get(i) || puzzle.cells[i].clue || null };
    }
    save();
    startSolve();
    $('step').innerHTML = '<p class="hint">已把目前進度存成新的盤面（「① 輸入盤面」也會看到）。</p>';
  }

  // ---------- 模式切換與事件 ----------

  function setMode(m) {
    mode = m;
    $('tab-edit').classList.toggle('active', m === 'edit');
    $('tab-solve').classList.toggle('active', m === 'solve');
    $('panel-edit').hidden = m !== 'edit';
    $('panel-solve').hidden = m !== 'solve';
    if (m === 'solve') { selLine = null; enterSolve(); } else render();
  }

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('board').addEventListener('click', (ev) => {
    const hdr = ev.target.closest('.hdr');
    if (hdr && mode === 'edit') { selLine = { kind: hdr.dataset.kind, idx: Number(hdr.dataset.idx) }; render(); return; }
    const el = ev.target.closest('.cell');
    if (!el) return;
    sel = Number(el.dataset.i); selLine = null;
    render();
  });

  $('cell-editor').addEventListener('click', (ev) => {
    const lel = ev.target.closest('[data-lact]');
    if (lel) { setLine(lel.dataset.lact, lel.dataset.v, lel.checked); return; }
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'color') { setCellColor(Number(el.dataset.v)); return; }
    setCellClue(applyClueAct(puzzle.cells[sel].clue, el.dataset.act, el.dataset.v, el.checked));
  });
  $('reveal-editor').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    setReveal(applyClueAct(reveal.get(sel) || null, el.dataset.act, el.dataset.v, el.checked));
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.target.closest?.('input, textarea, select') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const n = puzzle.n, r = Math.floor(sel / n), c = sel % n;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[ev.key]) {
      const [dr, dc] = moves[ev.key];
      const rr = Math.max(0, Math.min(n - 1, r + dr)), cc = Math.max(0, Math.min(n - 1, c + dc));
      sel = rr * n + cc; selLine = null; render(); ev.preventDefault(); return;
    }
    const k = ev.key.toLowerCase();
    if (mode !== 'edit') {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (current && current.status === 'step' && revealed) apply(true); else hint(); }
      else if (/^[0-8]$/.test(k) && isSolved(sel)) { ev.preventDefault(); setReveal({ type: 'num', k: Number(k) }); }
      else if (['-', 'n', 'delete', 'backspace'].includes(k) && isSolved(sel)) { ev.preventDefault(); setReveal(null); }
      return;
    }
    if (selLine) return;
    const ci = COLOR_HOTKEYS.indexOf(k);
    if (ci >= 0 && ci < usedColors().length) setCellColor(usedColors()[ci]);
    else if (/^[0-8]$/.test(k)) {
      const cl = puzzle.cells[sel].clue;
      const next = cl && NUM_TYPES.includes(cl.type) ? Object.assign({}, cl, { k: Number(k) }) : { type: 'num', k: Number(k) };
      if (next.k > maxCountFor(sel, next)) { flash(`${S.cellName(n, sel)} 最多 ${maxCountFor(sel, next)}`); return; }
      setCellClue(next);
    } else if (k === 'delete' || k === 'backspace') { puzzle.cells[sel] = { color: null, clue: null }; save(); render(); }
    else return;
    ev.preventDefault();
  });

  $('btn-resize').addEventListener('click', () => resize(Number($('size').value)));
  // 不用 confirm()：有些內嵌瀏覽器會直接擋掉對話框。改成 3 秒內再按一次才清空
  let clearArmed = null;
  $('btn-clear').addEventListener('click', () => {
    const b = $('btn-clear');
    if (!clearArmed) {
      b.textContent = '再按一次確認清空';
      clearArmed = setTimeout(() => { clearArmed = null; b.textContent = '清空'; }, 3000);
      return;
    }
    clearTimeout(clearArmed); clearArmed = null; b.textContent = '清空';
    const fake = puzzle.fake;
    puzzle = S.emptyPuzzle(puzzle.n, usedColors());
    resetSolveState();
    puzzle.fake = fake;
    sel = 0; selLine = null; save(); render();
  });
  $('btn-sample').addEventListener('click', () => {
    puzzle = S.parse(SAMPLE); resetSolveState(); syncSettings(); sel = 0; selLine = null; save(); render();
  });
  $('btn-export').addEventListener('click', () => { $('io').value = S.serialize(puzzle); $('io-msg').textContent = ''; });
  $('btn-share').addEventListener('click', async () => {
    const url = puzzleLink();
    $('io').value = url;
    try { await navigator.clipboard.writeText(url); $('io-msg').textContent = '已複製分享連結：打開連結就會載入這個盤面。'; }
    catch (e) { $('io-msg').textContent = '分享連結在上面的文字框裡，請手動複製。'; }
  });
  $('btn-import').addEventListener('click', () => {
    try {
      puzzle = S.parse($('io').value); resetSolveState(); syncSettings(); sel = 0; selLine = null; save(); render();
      $('io-msg').textContent = `已匯入 ${puzzle.n}×${puzzle.n} 盤面。`;
    } catch (e) { $('io-msg').textContent = '匯入失敗：' + e.message; }
  });

  $('btn-hint').addEventListener('click', hint);
  $('btn-apply').addEventListener('click', () => apply(true));
  $('btn-undo').addEventListener('click', undo);
  $('btn-all').addEventListener('click', solveAll);
  $('btn-restart').addEventListener('click', startSolve);
  $('btn-none-rest').addEventListener('click', noneForRest);
  $('btn-save-progress').addEventListener('click', saveProgress);

  function syncSettings() { $('size').value = puzzle.n; $('opt-fake').checked = !!puzzle.fake; applyTheme(); renderUsedColors(); renderThemeEditor(); }
  $('opt-fake').addEventListener('change', (ev) => { puzzle.fake = ev.target.checked || undefined; save(); render(); });
  $('used-colors').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-slot]'); if (b) toggleUsed(Number(b.dataset.slot));
  });
  $('theme-editor').addEventListener('input', (ev) => {
    const el = ev.target, k = Number(el.dataset.slot);
    if (Number.isNaN(k)) return;
    const pal = palette();
    if (el.type === 'color') pal[k].hex = el.value; else pal[k].name = el.value.trim() || `色${k + 1}`;
    if (pal === theme) saveTheme(); else save();
    applyTheme(); renderUsedColors(); render();
  });
  $('theme-owner').addEventListener('click', (ev) => {
    if (ev.target.id === 'btn-colors-save') { theme = puzzle.colors.map((x) => Object.assign({}, x)); saveTheme(); }
    if (ev.target.id === 'btn-colors-drop') { delete puzzle.colors; save(); }
    applyTheme(); syncSettings(); render();
  });
  $('btn-theme-reset').addEventListener('click', () => {
    delete puzzle.colors; save();
    theme = DEFAULT_THEME.map((x) => Object.assign({}, x));
    saveTheme(); applyTheme(); syncSettings(); render();
  });

  if (fromLink) {
    resetSolveState(); save();
    window.history.replaceState(null, '', location.pathname + location.search);
  }
  applyTheme();
  lastColor = usedColors()[0];
  syncSettings();
  render();
})();
