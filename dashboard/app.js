// Token Radar's dashboard (radar-2), restructured: the same page, built from small named
// pieces — lookup tables for the farm actions, tier tables for capital and hold, split model
// helpers, and one helper per rendered part. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer
// with the model's own inputs and the protocol's farm plan, a category table of the comparable
// multiples, and a model sandbox that re-ranks the board live. No network: every byte it shows
// is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = { weight: DATA.model.growth_weight, floor: DATA.model.maturity_floor, cap: DATA.model.multiple_cap };
  var sandboxOn = false;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  /** Short dollars: $1.54B, $212.2M, $850K, else the full currency format. */
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var units = [[1e9, 'B', 2], [1e6, 'M', 1]];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(n) >= units[i][0]) return '$' + (n / units[i][0]).toFixed(units[i][2]) + units[i][1];
    }
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // The model in two small pieces: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are visibly
  // the same arithmetic. The sandbox runs the same pieces with its own constants.
  function growthFactorOf(row, m) {
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    growth = clamp(growth, m.growth_floor, m.growth_cap);
    return 1 + (growth / 100) * m.growth_weight;
  }
  function maturityFactorOf(row, m) {
    var age = row.age_days === null || row.age_days === undefined ? DATA.median_age_days : row.age_days;
    var years = Math.log(1 + Math.max(0, age === null ? 365 : age) / 365) / Math.log(m.maturity_years);
    return Math.min(1, m.maturity_floor + (1 - m.maturity_floor) * Math.max(0, years));
  }
  function impliedOf(row, m) {
    var growthMult = growthFactorOf(row, m);
    var maturity = maturityFactorOf(row, m);
    var multiple = Math.min(m.multiple_cap, Math.max(m.multiple_floor, row.multiple));
    return { value: Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity)), growthMult: growthMult, maturity: maturity };
  }
  function modelWithSandbox() {
    return {
      growth_weight: sandbox.weight, growth_floor: DATA.model.growth_floor, growth_cap: DATA.model.growth_cap,
      maturity_floor: sandbox.floor, maturity_years: DATA.model.maturity_years,
      multiple_cap: sandbox.cap, multiple_floor: DATA.model.multiple_floor
    };
  }

  /** Append one child (or a list of them) to a node: strings become text nodes. */
  function appendChild(node, child) {
    if (child === null || child === undefined) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) { if (c) node.appendChild(c); });
      return;
    }
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }

  /** Build an element: class and text are properties, on* are listeners, the rest are
   * attributes, then the children in order. */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var value = attrs[k];
        switch (k) {
          case 'class': node.className = value; break;
          case 'text': node.textContent = value; break;
          case 'html': node.innerHTML = value; break;
          default:
            if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), value);
            else if (value !== null && value !== undefined) node.setAttribute(k, value);
        }
      });
    }
    for (var i = 2; i < arguments.length; i++) appendChild(node, arguments[i]);
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL,
  // age and the seven-day trend decide the action, the capital, the hold and every cost and time.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }

  /** Capital tiers by TVL: the bigger the protocol, the bigger the position a farm needs. */
  var CAPITAL_TIERS = [[5e9, 250], [1e9, 150], [1e8, 100]];
  function capitalFor(p) {
    for (var i = 0; i < CAPITAL_TIERS.length; i++) {
      if (p.tvl_usd >= CAPITAL_TIERS[i][0]) return CAPITAL_TIERS[i][1];
    }
    return 50;
  }

  /** Hold tiers by age: the younger the protocol, the longer the qualifying window. */
  var HOLD_TIERS = [[180, 60], [365, 45]];
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    for (var i = 0; i < HOLD_TIERS.length; i++) {
      if (age < HOLD_TIERS[i][0]) return HOLD_TIERS[i][1];
    }
    return 30;
  }

  /** One category rule: the words that pick it, and the action it renders. The table is read in
   * order, first match wins, so a category that names two things takes the earlier action. */
  var CATEGORY_ACTIONS = [
    { keys: ['lend', 'cdp', 'collateral'], text: function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; } },
    { keys: ['dex', 'yield', 'leveraged farm'], text: function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; } },
    { keys: ['bridge'], text: function (name, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.'; } },
    { keys: ['staking', 'restak'], text: function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; } },
    { keys: ['perpetual', 'derivative'], text: function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; } },
    { keys: ['prediction'], text: function (name, capital, chain) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; } },
    { keys: ['curator', 'allocator', 'capital'], text: function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; } },
    { keys: ['stable'], text: function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; } },
    { keys: ['rwa'], text: function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; } },
    { keys: ['insurance'], text: function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; } },
    { keys: ['ai', 'decentralized ai'], text: function (name, capital, chain) { return 'Use $' + capital + ' of compute or stake on ' + name + ' on ' + chain + ' and keep the receipts.'; } },
    { keys: ['launchpad'], text: function (name, capital, chain) { return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' to qualify for its launches.'; } }
  ];
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    for (var i = 0; i < CATEGORY_ACTIONS.length; i++) {
      var rule = CATEGORY_ACTIONS[i];
      for (var j = 0; j < rule.keys.length; j++) {
        if (c.indexOf(rule.keys[j]) >= 0) return rule.text(name, capital, chain);
      }
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }

  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  /** The fifth step reads the protocol's own seven-day trend, so no two plans are the same text. */
  function trendText(p, capital) {
    var growth = p.change_7d;
    if (growth === null || growth === undefined) return 'Its seven-day TVL change is unreported, so start with the $' + capital + ' position and add only after a week of watching the protocol\'s own page.';
    if (growth >= 5) return 'Its TVL is up ' + growth.toFixed(1) + '% in seven days, so activity is rising: open the position now and add a second deposit if the trend holds next week.';
    if (growth <= -10) return 'Its TVL is down ' + Math.abs(growth).toFixed(1) + '% in seven days, so start with half the $' + capital + ' position and add the rest only if the trend turns.';
    return 'Its TVL moved ' + growth.toFixed(1) + '% in seven days, so the position is steady: open the full $' + capital + ' and keep the weekly action going.';
  }

  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: trendText(p, capital), cost: 'no extra cost beyond the position', time: '10 minutes a week to watch' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The visible board: the submitted ranking, or the sandbox's re-ranking when its sliders moved.
  function sandboxRows() {
    var m = modelWithSandbox();
    return DATA.rows.map(function (r) {
      var v = impliedOf(r, m);
      var copy = Object.assign({}, r);
      copy.implied_value_usd = v.value;
      return copy;
    }).sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1); })
      .map(function (r, i) { r.display_rank = i + 1; return r; });
  }
  function visibleRows() {
    return sandboxOn ? sandboxRows() : DATA.rows;
  }
  function matchesFilter(r) {
    if (state.category !== 'all' && r.category !== state.category) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function rows() {
    return visibleRows().filter(matchesFilter);
  }

  /** The value one row sorts by, for each sort key; anything else sorts by implied value. */
  var SORT_VALUES = {
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null ? Infinity : r.age_days; },
    multiple: function (r) { return r.multiple; },
    implied: function (r) { return r.implied_value_usd; }
  };
  function sortedRows(list) {
    var valueOf = SORT_VALUES[state.sort] || SORT_VALUES.implied;
    return list.slice().sort(function (a, b) {
      var av = valueOf(a);
      var bv = valueOf(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'scope', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols below that floor. Implied value is a comparable multiple of TVL, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Market median multiple' }), el('b', { text: String(DATA.global_multiple) + 'x TVL' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function leaderCard(r) {
    return el('button', { class: 'leader', type: 'button', onclick: function () { openDetail(r.slug); } },
      el('span', { class: 'rank', text: 'Rank ' + r.rank }),
      el('b', { text: r.name }),
      el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
      el('span', { class: 'sub', text: fmtUsd(r.tvl_usd) + ' TVL, ' + fmtPct(r.change_7d) + ' in 7d' })
    );
  }
  function leaders() {
    var top = DATA.rows.slice(0, 5);
    return el('section', { class: 'leaders', 'aria-label': 'Top five by implied value' },
      top.map(leaderCard)
    );
  }

  function categoryOptions(categories) {
    var options = [el('option', { value: 'all', text: 'All categories' })];
    categories.forEach(function (c) {
      options.push(el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }));
    });
    return options;
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' }, categoryOptions(categories));
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' + (sandboxOn ? ' (sandbox ranking)' : '') : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardRowElement(r, max) {
    var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var rank = sandboxOn && r.display_rank ? r.display_rank : r.rank;
    return el('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      el('td', { class: 'num', text: String(rank) }),
      el('td', null, el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      )),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: growth }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', { class: 'num', text: r.multiple.toFixed(2) + 'x' }),
      el('td', null, el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
      )),
      el('td', null, el('span', { class: 'status', text: 'no token' }))
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) { tbody.appendChild(boardRowElement(r, max)); });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveRowElement(r) {
    return el('tr', null,
      el('td', { class: 'num', text: 'live' }),
      el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
      el('td', null, el('span', { class: 'status live', text: 'already trades' }))
    );
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) { tbody.appendChild(liveRowElement(r)); });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function sandboxPanel() {
    var m = DATA.model;
    function slider(id, label, min, max, step, value, oninput) {
      var out = el('b', { text: String(value) });
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () { out.textContent = input.value; oninput(parseFloat(input.value)); });
      return el('div', { class: 'slider' }, el('label', { for: id }, el('span', { text: label }), out), input);
    }
    var note = el('p', { class: 'sandbox-note', hidden: !sandboxOn ? 'hidden' : null, text: 'Sandbox values differ from the submitted board: the table above is re-ranked live, board.json is unchanged.' });
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the submitted model', onclick: function () { sandbox.weight = m.growth_weight; sandbox.floor = m.maturity_floor; sandbox.cap = m.multiple_cap; sandboxOn = false; render(); } });
    var apply = function () { sandboxOn = true; render(); };
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Move a slider and the board re-ranks with the same function. Nothing here changes the submitted board; it shows the model is arithmetic, not a list.' }),
      el('div', { class: 'sliders' },
        slider('sb-weight', 'Growth weight', 0, 1, 0.05, sandbox.weight, function (v) { sandbox.weight = v; apply(); }),
        slider('sb-floor', 'Maturity floor', 0.5, 0.8, 0.05, sandbox.floor, function (v) { sandbox.floor = v; apply(); }),
        slider('sb-cap', 'Multiple cap', 0.5, 1.5, 0.05, sandbox.cap, function (v) { sandbox.cap = v; apply(); })
      ),
      note,
      el('div', null, reset)
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x maturity )'
      ),
      el('p', { class: 'sub', text: 'The multiple is the median market-cap-per-TVL of the live tokens in the protocol\'s own category, shrunk toward the market median of ' + DATA.global_multiple + 'x when the category has few comparables, and clamped to ' + m.multiple_floor + 'x..' + m.multiple_cap + 'x. Maturity is log growth in the days the protocol has run with no token, from a floor of ' + m.maturity_floor + ' to 1.0; an unlisted age uses the snapshot\'s median pre-token age of ' + (DATA.median_age_days === null ? 'unknown' : DATA.median_age_days + ' days') + '.' })
    );
  }

  function categoryRowElement(c) {
    return el('tr', null,
      el('td', null, el('b', { text: c.category })),
      el('td', { class: 'num', text: String(c.protocols) }),
      el('td', { class: 'num', text: String(c.comparables) }),
      el('td', { class: 'num', text: c.median_ratio.toFixed(2) + 'x' }),
      el('td', { class: 'num', text: c.multiple.toFixed(2) + 'x' })
    );
  }
  function categoryPanel() {
    var tbody = el('tbody');
    DATA.categories.forEach(function (c) { tbody.appendChild(categoryRowElement(c)); });
    return el('section', { class: 'panel cat-table' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Every category on the board: how many protocols it holds, how many live tokens set its multiple, and the multiple itself.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Protocols' }), el('th', { scope: 'col', text: 'Live comparables' }), el('th', { scope: 'col', text: 'Category median' }), el('th', { scope: 'col', text: 'Multiple used' }))),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    return el('section', { class: 'method' },
      el('p', null, el('b', { text: 'What this is. ' }), 'A ranking of protocols that record no token, by what a token would be worth if the protocol\'s record stayed as it is. It does not predict whether or when a token is issued.'),
      el('p', null, el('b', { text: 'What it is not. ' }), 'A price, a forecast or advice. TVL can fall, a protocol can stay tokenless forever, and a farm plan costs real gas.'),
      el('p', null, el('b', { text: 'Where the numbers come from. ' }), 'The sealed DefiLlama snapshot of ' + DATA.as_of + ': TVL, seven-day growth, listing age and the live tokens\' market caps. The watchlist is the floor; the early radar is every other rankable pre-token protocol.')
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function detailHead(row) {
    return el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
  }

  function equationLine(label, value) {
    return el('div', null, el('span', { text: label }), el('b', { class: 'num', text: value }));
  }
  function detailEquation(row, check) {
    return el('div', { class: 'equation' },
      equationLine('TVL', fmtUsd(row.tvl_usd)),
      equationLine('Category multiple', row.multiple.toFixed(2) + 'x (' + row.multiple_comparables + ' live)'),
      equationLine('Seven-day growth', fmtPct(row.change_7d)),
      equationLine('Age with no token', fmtAge(row.age_days)),
      equationLine('Growth multiplier', String(row.growth_multiplier)),
      equationLine('Maturity multiplier', String(row.maturity_multiplier)),
      equationLine('Implied value', fmtUsd(row.implied_value_usd))
    );
  }

  function detailSteps(steps) {
    return el('ol', { class: 'steps' }, steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
    }));
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var check = impliedOf(row, DATA.model);
    dialog.appendChild(detailHead(row));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      detailEquation(row, check),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(check.value) + (check.value === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      detailSteps(steps)
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(leaders());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(sandboxPanel());
      shell.appendChild(modelPanel());
      shell.appendChild(categoryPanel());
      shell.appendChild(methodPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
