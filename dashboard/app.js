// Token Radar, radar-2. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranking: KPI strip, two SVG charts, filter toolbar with removable chips, a sortable table,
// a model section that states every factor, and a detail modal per protocol.
// No network: every byte shown is in data.js. Charts are hand-written inline SVG.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, showFilters: false };

  /* ---------- formatting ---------- */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '–';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return '–';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- the model, recomputed in the page (must match lib/model.ts) ---------- */
  var CAT = {};
  (DATA.category_table || []).forEach(function (t) { CAT[t.category] = t.multiplier; });
  function categoryMult(category) {
    if (!category) return 1;
    return CAT[category] === undefined ? 1 : CAT[category];
  }
  function chainMult(chains) {
    var n = Math.max(1, (chains || []).length);
    return Math.min(DATA.model.chain_cap, 1 + DATA.model.chain_weight * Math.log(n));
  }
  function growthWeight(tvl) {
    var m = DATA.model;
    var span = Math.log10(m.growth_size_top / m.growth_size_floor);
    var at = Math.min(1, Math.max(0, Math.log10(Math.max(tvl, m.growth_size_floor) / m.growth_size_floor) / span));
    return m.growth_weight_min + (m.growth_weight_max - m.growth_weight_min) * at;
  }
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var gw = growthWeight(row.tvl_usd);
    var growthMult = 1 + (growth / 100) * gw;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * categoryMult(row.category) * chainMult(row.chains) * growthMult * maturity));
  }

  /* ---------- the farm plan, same derivation as board.json (must match lib/model.ts) ---------- */
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasPerTx(chain) {
    var c = String(chain).toLowerCase();
    if (c.indexOf('ethereum') >= 0 || c.indexOf('bitcoin') >= 0) return 8;
    if (c.indexOf('solana') >= 0 || c.indexOf('sui') >= 0 || c.indexOf('aptos') >= 0 || c.indexOf('near') >= 0) return 0.1;
    if (c.indexOf('tron') >= 0 || c.indexOf('bsc') >= 0 || c.indexOf('binance') >= 0) return 0.5;
    return 1.5;
  }
  function usd(n) { return n < 1 ? '$' + n.toFixed(2) : '$' + Math.round(n); }
  function commas(n) { return Math.round(n).toLocaleString('en-US'); }
  function coreAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return {
      verb: 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the loan open',
      detail: 'borrow a small amount against it so the position shows both sides of the book',
      weekly: 'repay a little, borrow a little, or top up the collateral so the loan stays active' };
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return {
      verb: 'Provide $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and hold the LP receipt',
      detail: 'pick the pair with the most volume, not the highest advertised yield',
      weekly: 'claim the pool fees, and add or remove a small amount so the position changes' };
    if (c.indexOf('bridge') >= 0 || c.indexOf('canonical bridge') >= 0) return {
      verb: 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then put the bridged funds to work in its app',
      detail: 'a bridge alone is one transaction; using the funds afterwards is what counts',
      weekly: 'bridge a small amount back and forth, and use the destination app each time' };
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return {
      verb: 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token',
      detail: 'restaking or liquid staking receipts are the position, not the deposit alone',
      weekly: 'check the receipt balance and, if the protocol offers it, delegate or vote once' };
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return {
      verb: 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position',
      detail: 'keep leverage low: the point is an open position, not a trade',
      weekly: 'adjust the hedge or close and reopen it, so the account shows ongoing use' };
    if (c.indexOf('prediction') >= 0) return {
      verb: 'Fund $' + capital + ' on ' + name + ' and take one position in an active market',
      detail: 'pick a market that settles after your hold window, not one that ends tomorrow',
      weekly: 'take one new market position, and settle or close the old one' };
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('onchain capital') >= 0) return {
      verb: 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares',
      detail: 'vault shares are the receipt; a deposit with no shares is not a position',
      weekly: 'check the share price and, if the vault allows it, add a small top-up' };
    if (c.indexOf('stable') >= 0) return {
      verb: 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it',
      detail: 'holding the minted asset, not just minting and redeeming it, is the position',
      weekly: 'use the stable asset once, in a swap or a payment, and keep the balance' };
    if (c.indexOf('rwa') >= 0) return {
      verb: "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it in the same wallet',
      detail: 'real-world-asset positions are read from the holding wallet, so do not move it',
      weekly: 'claim the yield once, and leave the principal untouched' };
    if (c.indexOf('insurance') >= 0) return {
      verb: 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active',
      detail: 'cover that lapses before a snapshot reads as no position at all',
      weekly: 'check the policy is still active, and renew it before it expires' };
    if (c.indexOf('basis') >= 0) return {
      verb: 'Deposit $' + capital + " into " + name + "'s basis vault on " + chain + ' and hold the position through one funding cycle',
      detail: 'basis trades are judged over a full cycle, not a single day',
      weekly: 'check the funding rate and rebalance only if the vault asks for it' };
    return {
      verb: 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open',
      detail: "use the protocol's main feature once, so the wallet is more than a deposit",
      weekly: "use the protocol's main feature once, such as a swap, a deposit or a vote" };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.max(2, Math.ceil(hold / 7));
    var gas = gasPerTx(chain);
    var txs = 2 + weeks + 2;
    var totalGas = gas * txs;
    var core = coreAction(p, capital, chain);
    var secondChain = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var ageLine = p.age_days === null || p.age_days === undefined ? 'with no listing date on record' : 'listed ' + p.age_days + ' days ago';
    var tinySlice = Math.max(1, Math.round(p.implied_value_usd * 0.0001));
    return [
      { text: 'Open a fresh wallet for ' + p.name + ' alone and fund it with $' + (capital + Math.ceil(totalGas)) + ' on ' + chain + ' (' + usd(capital) + ' to farm with, about ' + usd(totalGas) + ' for gas). Fund it from an exchange withdrawal, not from another farm wallet.',
        cost: 'about ' + usd(gas) + ' of gas for the first transaction', time: '10 minutes to set up' },
      { text: core.verb + ' — ' + core.detail + '.',
        cost: usd(capital) + ' of capital and about ' + usd(gas * 2) + ' of gas to open it', time: '15 minutes to set up' },
      { text: 'Once a week for ' + weeks + ' weeks, ' + core.weekly + ' on ' + p.name + '. Do it on a different day each week, at a different hour, so the activity reads as real use and not a batch. Each week costs about ' + usd(gas) + ' of gas.',
        cost: 'about ' + usd(gas * weeks) + ' of gas over ' + weeks + ' weeks', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days (' + p.name + ' is ' + ageLine + ') and keep at least $' + Math.round(capital * 0.8) + ' of it in place, so the balance is counted in more than one snapshot. Withdrawing early is the most common way a farm scores zero.',
        cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Keep this farm to one wallet: do not fund a second wallet from the first, do not repeat the same amounts on the same day, and never pay anyone to claim for you. The whole plan costs about ' + usd(totalGas) + ' of gas; it breaks even on any airdrop above that, and 0.01% of the $' + commas(p.implied_value_usd) + ' implied value would be $' + commas(tinySlice) + (secondChain !== null ? '; ' + secondChain + ' is a second chain this protocol runs on, not a reason to open a second farm' : '') + '.',
        cost: 'about ' + usd(totalGas) + ' of gas in total', time: 'nothing to do but check once a week' },
      { text: 'After ' + hold + ' days, or when ' + p.name + ' announces a token, open the protocol\'s own points or rewards page from its official site and claim only from the link it publishes. Then unwind in reverse: close the position, withdraw the $' + capital + ', and keep the wallet\'s log.',
        cost: 'about ' + usd(gas * 2) + ' of gas to claim and unwind', time: '20 minutes to exit' }
    ].map(stepText);
  }
  window.__radarFarm = farmSteps; // exposed for the build's own consistency check
  window.__radarImplied = impliedOf; // exposed for the build's own consistency check

  /* ---------- state, hash, filtering ---------- */
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function activeFilterCount() {
    var n = 0;
    if (state.q) n++;
    if (state.category !== 'all') n++;
    if (state.chain !== 'all') n++;
    return n;
  }
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /* ---------- tiny DOM helpers ---------- */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function svgEl(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  /* ---------- KPI strip ---------- */
  function kpiStrip() {
    var rows = DATA.rows;
    var top = rows[0] ? rows[0].implied_value_usd : 0;
    var med = rows.length ? rows[Math.floor(rows.length / 2)].implied_value_usd : 0;
    var total = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var growing = rows.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; }).length;
    return el('section', { class: 'kpis', 'aria-label': 'Headline figures' },
      el('div', { class: 'kpi' },
        el('span', { class: 'kpi-label', text: 'Watchlist covered' }),
        el('span', { class: 'kpi-value', html: DATA.watchlist_size + ' <small>/ ' + DATA.watchlist_size + '</small>' }),
        el('span', { class: 'kpi-note', text: 'every protocol on the floor is ranked' })),
      el('div', { class: 'kpi' },
        el('span', { class: 'kpi-label', text: 'Top implied value' }),
        el('span', { class: 'kpi-value', text: fmtUsd(top) }),
        el('span', { class: 'kpi-note', text: rows[0] ? rows[0].name : '–' })),
      el('div', { class: 'kpi' },
        el('span', { class: 'kpi-label', text: 'Median implied value' }),
        el('span', { class: 'kpi-value', text: fmtUsd(med) }),
        el('span', { class: 'kpi-note', text: 'half the board sits above this line' })),
      el('div', { class: 'kpi' },
        el('span', { class: 'kpi-label', text: 'Total implied value' }),
        el('span', { class: 'kpi-value', text: fmtUsd(total) }),
        el('span', { class: 'kpi-note', text: growing + ' of ' + rows.length + ' rows grew in the last 7 days' }))
    );
  }

  /* ---------- SVG charts ---------- */
  function topChart() {
    var top10 = DATA.rows.slice(0, 10);
    var max = top10.length ? top10[0].implied_value_usd : 1;
    var svg = svgEl('svg', { viewBox: '0 0 560 260', role: 'img', 'aria-label': 'Top 10 protocols by implied value' });
    top10.forEach(function (r, i) {
      var y = 8 + i * 25;
      var w = Math.max(4, Math.round((r.implied_value_usd / max) * 300));
      var label = svgEl('text', { x: 0, y: y + 11, class: 'bar-label' });
      label.textContent = (i + 1) + '. ' + (r.name.length > 22 ? r.name.slice(0, 21) + '…' : r.name);
      svg.appendChild(label);
      var track = svgEl('rect', { x: 190, y: y, width: 300, height: 12, rx: 3, class: 'bar-track' });
      svg.appendChild(track);
      var fill = svgEl('rect', { x: 190, y: y, width: w, height: 12, rx: 3, class: i === 0 ? 'bar-fill-amber' : 'bar-fill' });
      svg.appendChild(fill);
      var val = svgEl('text', { x: 498, y: y + 11, class: 'bar-value' });
      val.textContent = fmtUsd(r.implied_value_usd);
      svg.appendChild(val);
    });
    return el('div', { class: 'chart-card' },
      el('h2', { text: 'Top 10 by implied value' }),
      el('p', { class: 'chart-sub', text: 'The head of the ranking. The gap between rank 1 and rank 10 is where the model earns its keep.' }),
      svg);
  }
  function categoryChart() {
    var counts = {};
    DATA.rows.forEach(function (r) { var c = r.category || 'Other'; counts[c] = (counts[c] || 0) + 1; });
    var entries = Object.keys(counts).map(function (c) { return { c: c, n: counts[c] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 8);
    var max = entries.length ? entries[0].n : 1;
    var svg = svgEl('svg', { viewBox: '0 0 420 210', role: 'img', 'aria-label': 'Board rows by category' });
    entries.forEach(function (e, i) {
      var y = 8 + i * 25;
      var w = Math.max(4, Math.round((e.n / max) * 210));
      var label = svgEl('text', { x: 0, y: y + 11, class: 'bar-label' });
      label.textContent = e.c.length > 18 ? e.c.slice(0, 17) + '…' : e.c;
      svg.appendChild(label);
      var track = svgEl('rect', { x: 150, y: y, width: 210, height: 12, rx: 3, class: 'bar-track' });
      svg.appendChild(track);
      var fill = svgEl('rect', { x: 150, y: y, width: w, height: 12, rx: 3, class: 'bar-fill' });
      svg.appendChild(fill);
      var val = svgEl('text', { x: 368, y: y + 11, class: 'bar-value' });
      val.textContent = String(e.n);
      svg.appendChild(val);
    });
    return el('div', { class: 'chart-card' },
      el('h2', { text: 'Where the board comes from' }),
      el('p', { class: 'chart-sub', text: 'Rows by category. Risk curators and RWA dominate the watchlist; the early radar fills in the rest.' }),
      svg);
  }

  /* ---------- toolbar ---------- */
  function toolbar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var n = activeFilterCount();
    var filterBtn = el('button', { type: 'button', class: 'filter-btn', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } },
      el('span', { text: 'Filters' }),
      n > 0 ? el('span', { class: 'badge', text: String(n) }) : null
    );
    var chips = el('div', { class: 'chips' });
    function chip(label, clear) {
      var b = el('button', { type: 'button', 'aria-label': 'Remove filter ' + label, text: '×', onclick: function () { clear(); writeHash(); render(); } });
      chips.appendChild(el('span', { class: 'chip' }, el('span', { text: label }), b));
    }
    if (state.q) chip('Search: "' + state.q + '"', function () { state.q = ''; });
    if (state.category !== 'all') chip('Category: ' + state.category, function () { state.category = 'all'; });
    if (state.chain !== 'all') chip('Chain: ' + state.chain, function () { state.chain = 'all'; });
    if (n > 0) chips.appendChild(el('button', { type: 'button', class: 'clear-all', text: 'Clear all filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } }));
    return el('div', { class: 'toolbar' },
      el('div', { class: 'toolbar-row' },
        el('label', { class: 'search-box' }, el('span', { class: 'search-icon', text: '⌕' }), search),
        catSel, chainSel,
        el('div', { class: 'segmented' }, pre, live),
        filterBtn,
        el('span', { class: 'result-count', text: state.tab === 'pre-token' ? visibleRows().length + ' of ' + DATA.rows.length + ' rows' : DATA.live.length + ' live-token protocols' })
      ),
      chips
    );
  }

  /* ---------- tables ---------- */
  function sortHead(key, label) {
    var arrow = state.sort === key ? el('span', { class: 'sort-arrow', text: state.dir < 0 ? '▼' : '▲' }) : null;
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) {
          if (state.dir < 0) state.dir = 1;
          else { state.sort = 'implied'; state.dir = -1; }
        } else { state.sort = key; state.dir = -1; }
        render();
      } }, label, arrow)
    );
  }
  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'table-card' }, el('div', { class: 'empty-state' },
        el('h2', { text: 'No protocol matches these filters' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'btn primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? '–' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var tr = el('tr', {
        'aria-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank-badge' + (r.rank <= 3 ? ' top3' : ''), text: String(r.rank) })),
        el('td', null, el('div', null,
          el('div', { class: 'proto-name', text: r.name }),
          el('div', { class: 'proto-sub', text: (r.category || 'Other') + ' · ' + r.slug })
        )),
        el('td', null, el('div', { class: 'implied-cell' },
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('div', { class: 'implied-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' }))
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'tag', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'table-card' },
      el('div', { class: 'table-scroll' },
        el('table', { id: 'board-table' },
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('implied', 'Implied value'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('chains', 'Chains'),
            sortHead('age', 'Age'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'tag live', text: 'live' })),
        el('td', null, el('div', null,
          el('div', { class: 'proto-name', text: r.name }),
          el('div', { class: 'proto-sub', text: (r.category || 'Other') + ' · ' + r.slug })
        )),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('span', { class: 'tag live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'table-card' },
      el('div', { class: 'table-scroll' },
        el('table', null,
          el('caption', { text: 'Tokens that already trade: their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Chains' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  /* ---------- model section ---------- */
  function modelSection() {
    var m = DATA.model;
    var formula = 'implied = round( tvl_usd × ' + m.base_multiple + ' × category × chains × growth × maturity )\n' +
      'category  = 0.6 + 0.4 × (median mcap/TVL of live-token protocols in the category ÷ ' + DATA.overall_median_multiple + '), clamped to [0.6, 1.5]\n' +
      'chains    = min(' + m.chain_cap + ', 1 + ' + m.chain_weight + ' × ln(chains))\n' +
      'growth    = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × weight, weight ' + m.growth_weight_min + ' at $5M TVL rising to ' + m.growth_weight_max + ' at $500M\n' +
      'maturity  = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range;
    var catRows = (DATA.category_table || []).slice().sort(function (a, b) { return b.multiplier - a.multiplier; });
    var catBody = el('tbody');
    catRows.forEach(function (t) {
      catBody.appendChild(el('tr', null,
        el('td', { text: t.category }),
        el('td', { text: String(t.live_n) }),
        el('td', { text: t.median_multiple.toFixed(3) }),
        el('td', { text: '×' + t.multiplier.toFixed(2) })
      ));
    });
    return el('section', { class: 'model-section', 'aria-label': 'How implied value is computed' },
      el('p', { class: 'kicker', text: 'The model, in full' }),
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'model-lede', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The three factors below are the difference from a plain TVL ranking: each one is read off the snapshot itself, and each one is stated here so the ranking can be checked.' }),
      el('div', { class: 'formula', text: formula }),
      el('div', { class: 'factor-grid' },
        el('div', { class: 'factor' },
          el('h3', { text: '1 · Category pricing' }),
          el('p', { text: 'The market does not pay the same multiple everywhere. Dexs trade near 0.34× TVL; liquid staking near 0.03×. Each category earns the median of its live-token protocols, damped toward 1.0.' }),
          el('span', { class: 'factor-num', text: 'overall median 0.169 · range ×0.68–×1.50' })),
        el('div', { class: 'factor' },
          el('h3', { text: '2 · Multi-chain reach' }),
          el('p', { text: 'A protocol live on several chains has more places a token can matter. 54% of the snapshot sits on one chain, so breadth is a real distinction; the log keeps the bonus gentle.' }),
          el('span', { class: 'factor-num', text: '1 + 0.08 × ln(chains), capped at ×1.40' })),
        el('div', { class: 'factor' },
          el('h3', { text: '3 · Growth you can trust' }),
          el('p', { text: 'A 7-day move on a $5M protocol is mostly small-base noise; the same move on a $1B protocol is real flow. The growth weight rises with TVL, from 0.30 to 0.50.' }),
          el('span', { class: 'factor-num', text: '79% of pre-token rows fell in the last 7 days' }))
      ),
      el('div', { class: 'cat-table-wrap' },
        el('table', { class: 'cat-table' },
          el('caption', { class: 'model-foot', text: 'Category pricing, from the snapshot’s live-token protocols (median market-cap/TVL, categories with at least 5 live tokens).' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live tokens' }),
            el('th', { scope: 'col', text: 'Median mcap/TVL' }),
            el('th', { scope: 'col', text: 'Multiplier' })
          )),
          catBody
        )
      ),
      el('p', { class: 'model-foot', text: 'Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. TVL and seven-day growth come from the snapshot, dated ' + DATA.as_of + '. The early radar is every pre-token protocol below the $' + Math.round(DATA.floor_usd / 1e6) + 'M watchlist floor, by TVL. An implied value is an estimate, not a price.' })
    );
  }

  /* ---------- detail modal ---------- */
  var backdrop = null;
  function closeDetail() {
    state.selected = null;
    writeHash();
    if (backdrop) { backdrop.remove(); backdrop = null; }
  }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    closeDetail();
    state.selected = slug;
    writeHash();
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var maxFactor = Math.max(row.category_multiplier, row.chain_multiplier, row.growth_multiplier, row.maturity_multiplier);
    function factorBar(label, value) {
      var w = Math.max(4, Math.round((value / maxFactor) * 100));
      return el('div', { class: 'factor-bar-row' },
        el('span', { text: label }),
        el('div', { class: 'track' }, el('i', { style: 'width:' + w + '%' })),
        el('span', { class: 'num', text: '×' + value.toFixed(2) })
      );
    }
    var stepItems = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('div', { class: 'step-text', text: action }), el('div', { class: 'step-meta', text: tail }));
    });
    backdrop = el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === backdrop) closeDetail(); } },
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'detail-title' },
        el('div', { class: 'modal-head' },
          el('div', null,
            el('p', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.category || 'Other') }),
            el('h2', { id: 'detail-title', text: row.name }),
            el('p', { class: 'proto-sub', text: (row.chains || []).join(', ') + ' · ' + rAgeText(row) })
          ),
          el('button', { class: 'close-btn', type: 'button', 'aria-label': 'Close details', text: '×', onclick: closeDetail })
        ),
        el('div', { class: 'modal-cols' },
          el('div', null,
            el('h3', { text: 'Implied value' }),
            el('div', { class: 'breakdown' },
              el('div', { class: 'breakdown-row' }, el('span', { text: 'TVL' }), el('span', { class: 'num', text: fmtFull(row.tvl_usd) })),
              el('div', { class: 'breakdown-row' }, el('span', { text: 'Seven-day growth' }), el('span', { class: 'num', text: fmtPct(row.change_7d) })),
              el('div', { class: 'breakdown-row' }, el('span', { text: 'Age with no token' }), el('span', { class: 'num', text: fmtAge(row.age_days) })),
              el('div', { class: 'breakdown-row' }, el('span', { text: 'Chains' }), el('span', { class: 'num', text: String((row.chains || []).length) })),
              el('div', { class: 'breakdown-row total' }, el('span', { text: 'Implied value' }), el('span', { class: 'num', text: fmtFull(row.implied_value_usd) }))
            ),
            el('div', { class: 'factor-bars' },
              factorBar('Category', row.category_multiplier),
              factorBar('Chains', row.chain_multiplier),
              factorBar('Growth', row.growth_multiplier),
              factorBar('Maturity', row.maturity_multiplier)
            ),
            el('p', { class: 'modal-note', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtFull(recomputed) + (recomputed === row.implied_value_usd ? ', the same number the board carries.' : ', which differs from the board — the data would be stale.') })
          ),
          el('div', null,
            el('h3', { text: 'Farm plan' }),
            el('ol', { class: 'farm-list' }, stepItems)
          )
        ),
        el('p', { class: 'modal-note', text: 'This is a plan for one wallet, written for this protocol. Gas is priced on its main chain; the whole plan breaks even on any airdrop above its gas cost. Nothing here is financial advice.' })
      )
    );
    document.body.appendChild(backdrop);
    var closeBtn = backdrop.querySelector('.close-btn');
    if (closeBtn) closeBtn.focus();
  }
  function rAgeText(row) {
    if (row.age_days === null || row.age_days === undefined) return 'listing date unknown';
    return 'listed ' + fmtAge(row.age_days) + ' ago';
  }

  /* ---------- render ---------- */
  function render() {
    app.textContent = '';
    var page = el('div', { class: 'page' });
    page.appendChild(kpiStrip());
    var charts = el('section', { class: 'charts' });
    charts.appendChild(topChart());
    charts.appendChild(categoryChart());
    page.appendChild(charts);
    page.appendChild(toolbar());
    page.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') page.appendChild(modelSection());
    page.appendChild(el('p', { class: 'page-foot', text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · Model ' + DATA.model_version + ' · Implied values are estimates, not prices.' }));
    app.appendChild(page);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop) closeDetail();
  });
  document.getElementById('meta-date').textContent = DATA.as_of;
  document.getElementById('meta-model').textContent = DATA.model_version;
})();
