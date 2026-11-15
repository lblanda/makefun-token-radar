// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail drawer with the model's own inputs and
// the protocol's farm plan, and a model sandbox that re-ranks the board live. No network: every byte
// it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
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

  // The model in one function, identical to lib/model.ts: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and the board's data are
  // visibly the same arithmetic. The sandbox passes its own constants in.
  function impliedOf(row, model) {
    var m = model || DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var momentum = 1 + m.momentum_weight * (Math.max(0, Math.min(growth, m.momentum_cap) - m.momentum_threshold) / (m.momentum_cap - m.momentum_threshold));
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var hump = age <= m.maturity_peak_days ? age / m.maturity_peak_days : Math.max(m.maturity_decay_floor, 1 - (age - m.maturity_peak_days) / m.maturity_decay_days);
    var maturity = m.maturity_floor + m.maturity_range * hump;
    var chainMult = 1 + m.chain_step * Math.min((row.chains || []).length, m.chain_max);
    var tvlTerm = Math.pow(Math.max(row.tvl_usd, 0) / 1e6, m.tvl_exponent);
    return Math.max(1, Math.round(m.base_usd * tvlTerm * growthMult * momentum * maturity * chainMult));
  }

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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
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
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares for the whole season.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it in your wallet.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + " into " + name + "'s basis vault on " + chain + ' and keep the position through two funding cycles.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow $20 against it and repay it the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ', in a narrow range around the current price, and rebalance once a month.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-yield vault on " + chain + ' and keep the receipt token.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' in three transfers over two weeks, and use the bridged funds in its app.';
    if (c.indexOf('liquid restak') >= 0 || c.indexOf('restak') >= 0) return 'Restake $' + capital + " of the chain's staking asset through " + name + ', then use the receipt token in one more protocol.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('staking pool') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetic') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position each week.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place positions on two or three different markets on ' + name + ', not just one.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ', then use it in one of its pools.';
    if (c.indexOf('launchpad') >= 0) return 'Commit $' + capital + ' to the next ' + name + ' launch on ' + chain + ' and hold the allocation.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' across at least four separate transactions.';
    if (c.indexOf('privacy') >= 0) return 'Run $' + capital + " through " + name + "'s private pool on " + chain + ' and keep the receipt.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy for the full term.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it.';
    if (c.indexOf('locker') >= 0 || c.indexOf('token locker') >= 0) return 'Lock $' + capital + ' of tokens in ' + name + ' on ' + chain + ' for the longest term you can accept.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of voting power in ' + name + ' on ' + chain + ' and vote on two proposals.';
    if (c.indexOf('ai agent') >= 0 || c.indexOf('decentralized ai') >= 0) return 'Pay $' + capital + ' for ' + name + ' agent calls on ' + chain + ' across at least three separate days.';
    if (c.indexOf('nft') >= 0) return 'List and trade $' + capital + ' of volume on ' + name + ' on ' + chain + ' across two collections.';
    if (c.indexOf('chain') >= 0 || c.indexOf('decentralized btc') >= 0 || c.indexOf('anchor btc') >= 0) return 'Use $' + capital + ' of ' + name + ' on ' + chain + ' for two different actions, such as a deposit and a swap.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let two weeks pass with no activity.', cost: 'about $2 of gas a week', time: '10 minutes a week' }
    ];
    if (second) steps.push({ text: 'Repeat the same position on ' + second + ' with half the capital, so the farm counts on two chains instead of one.', cost: '$' + Math.round(capital / 2) + ' of capital and about $4 of gas', time: '15 minutes to set up' });
    steps.push(
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    );
    return steps.map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
    if (params.get('tab') === 'live' || params.get('tab') === 'pre-token') state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The rows the board shows right now: the sandbox's model re-scores and re-ranks them when it runs.
  function viewRows() {
    var list = DATA.rows.map(function (r) {
      if (!state.sandbox) return r;
      var copy = Object.assign({}, r);
      copy.implied_value_usd = impliedOf(r, state.sandbox);
      return copy;
    });
    if (state.sandbox) {
      list.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0); });
      list.forEach(function (r, i) { r.rank = i + 1; });
    }
    return list;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return viewRows().filter(function (r) {
      // The watchlist is the floor: every board row at or above it is a watchlist row.
      if (state.watchlistOnly && r.tvl_usd < DATA.floor_usd) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
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
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'Token Radar', el('small', { text: 'pre-token protocol radar' }))),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, el('b', { text: DATA.model_version }), ' model')
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, DATA.watchlist_size + ' watchlist protocols, ranked by ', el('em', { text: 'implied value' })),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor — the whole pre-token universe in the snapshot. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every slug on the list' })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early rows below the floor' })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) }), el('small', { text: 'sum of the board' })),
        el('div', { class: 'fact' }, el('span', { text: 'Top of the board' }), el('b', { text: top ? top.name : 'n/a' }), el('small', { text: top ? fmtUsd(top.implied_value_usd) + ' implied' : '' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (all, r) { return all.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'watchlist-only', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'check', for: 'watchlist-only' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
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

  function tagsFor(r) {
    var tags = [];
    if (r.change_7d !== null && r.change_7d >= 25) tags.push(el('span', { class: 'tag hot', text: 'fast growth' }));
    if (r.age_days !== null && r.age_days >= 1000) tags.push(el('span', { class: 'tag', text: 'oldest no-token' }));
    if ((r.chains || []).length >= 5) tags.push(el('span', { class: 'tag', text: 'multi-chain' }));
    return tags;
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        class: r.rank <= 3 ? 'top3' : null,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('span', { class: 'rank-badge', text: String(r.rank) })),
        el('td', null, el('div', { class: 'name' },
          el('div', null, el('b', { text: r.name }), tagsFor(r)),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' + (state.sandbox ? ' Sandbox view: re-ranked by your constants, not the submitted board.' : '') }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
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
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
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

  function whyRank(row) {
    var parts = ['Rank ' + row.rank + ' of ' + DATA.board_size + ': ' + fmtUsd(row.tvl_usd) + ' of TVL'];
    parts.push(row.change_7d === null ? 'with no reported seven-day change' : 'growing ' + fmtPct(row.change_7d) + ' over seven days');
    parts.push(row.age_days === null ? 'with an unknown listing age' : 'running ' + fmtAge(row.age_days) + ' with no token');
    parts.push('on ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's'));
    return parts.join(', ') + ' — that is what the model turns into ' + fmtUsd(row.implied_value_usd) + ' of implied value.';
  }

  function modelPanel() {
    var m = DATA.model;
    var formula = 'implied = round( $' + m.base_usd.toLocaleString('en-US') + ' x (TVL in $M)^' + m.tvl_exponent +
      ' x (1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')' +
      ' x (1 + ' + m.momentum_weight + ' x max(0, min(7d, ' + m.momentum_cap + ') - ' + m.momentum_threshold + ') / ' + (m.momentum_cap - m.momentum_threshold) + ')' +
      ' x (' + m.maturity_floor + ' + ' + m.maturity_range + ' x hump(age))' +
      ' x (1 + ' + m.chain_step + ' x min(chains, ' + m.chain_max + ')) )';
    var expInput = el('input', { type: 'number', id: 'sb-exp', step: '0.05', min: '0.5', max: '1', value: String(m.tvl_exponent), 'aria-label': 'TVL exponent' });
    var growthInput = el('input', { type: 'number', id: 'sb-growth', step: '0.1', min: '0', max: '2', value: String(m.growth_weight), 'aria-label': 'Growth weight' });
    var baseInput = el('input', { type: 'number', id: 'sb-base', step: '100000', min: '100000', max: '10000000', value: String(m.base_usd), 'aria-label': 'Base dollars' });
    var note = el('span', { class: 'note', text: '' });
    function applySandbox() {
      var exp = parseFloat(expInput.value);
      var gw = parseFloat(growthInput.value);
      var base = parseFloat(baseInput.value);
      if (!isFinite(exp) || !isFinite(gw) || !isFinite(base) || exp <= 0 || base <= 0) { note.textContent = 'Those numbers do not make a model.'; return; }
      var sb = Object.assign({}, m, { tvl_exponent: exp, growth_weight: gw, base_usd: base });
      state.sandbox = sb;
      note.textContent = 'Sandbox on: the board above is re-ranked by TVL^' + exp + ', growth x' + gw + ', base $' + Math.round(base).toLocaleString('en-US') + '.';
      render();
    }
    function resetSandbox() {
      state.sandbox = null;
      expInput.value = String(m.tvl_exponent);
      growthInput.value = String(m.growth_weight);
      baseInput.value = String(m.base_usd);
      note.textContent = '';
      render();
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: formula }),
      el('ul', { class: 'reasons' },
        el('li', { text: 'TVL enters sub-linearly (power ' + m.tvl_exponent + '): token valuations compress as protocols grow, so ten times the TVL is not ten times the value.' }),
        el('li', { text: 'Growth is the clamped seven-day change; momentum adds credit above +' + m.momentum_threshold + '% a week, where a run is under way rather than noise.' }),
        el('li', { text: 'Maturity humps over age with no token: it rises to a peak near two years, when a token is most overdue, then decays slowly — a protocol that ran a decade with no token is less likely ever to issue one. Age unknown counts as ' + m.unknown_age_days + ' days.' }),
        el('li', { text: 'Chain breadth adds a small diversification factor. The early radar is every rankable pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.' })
      ),
      el('div', { class: 'sandbox' },
        el('h3', { text: 'Model sandbox — try your own constants' }),
        el('p', { text: 'Change the three constants and re-rank the board live. The submitted board.json keeps the model above; the sandbox only changes what this page shows.' }),
        el('div', { class: 'grid' },
          el('div', { class: 'field' }, el('label', { for: 'sb-exp', text: 'TVL exponent' }), expInput),
          el('div', { class: 'field' }, el('label', { for: 'sb-growth', text: 'Growth weight' }), growthInput),
          el('div', { class: 'field' }, el('label', { for: 'sb-base', text: 'Base dollars' }), baseInput)
        ),
        el('div', { class: 'actions' },
          el('button', { class: 'button primary', type: 'button', text: 'Re-rank the board', onclick: applySandbox }),
          el('button', { class: 'button', type: 'button', text: 'Reset', onclick: resetSandbox }),
          note
        )
      ),
      el('div', { class: 'method' },
        el('p', { text: 'Method: the snapshot is the sealed DefiLlama protocol index fetched once (' + DATA.source + '). A protocol is pre-token when its record carries no market cap, no CoinGecko id and no symbol — the record is not proof it has no token, only that none is recorded.' }),
        el('p', { text: 'Implied value is a model, not a price. It says what a token would be worth if the protocol’s record stayed as it is — it does not predict whether or when a token is issued.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Momentum multiplier' }), el('b', { class: 'num', text: String(row.momentum_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'why', text: whyRank(row) }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
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
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'foot', text: 'Token Radar · snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · implied value is a model, not a price.' }));
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
