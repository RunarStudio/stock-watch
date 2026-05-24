/* ── localStorage helpers ── */
const LS_KEY = 'stockwatch_tracked';
function getTracked() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function saveTracked(t) { localStorage.setItem(LS_KEY, JSON.stringify(t)); }

/* ── Stock data store (keyed by ticker) ── */
const stockMap = {};

function registerStocks(stocks) {
  stocks.forEach(s => {
    if (stockMap[s.ticker]) return;
    stockMap[s.ticker] = {
      name:            s.name,
      price:           s.price,
      currency:        s.ticker.includes('.') ? '€' : '$',
      upside_12m_pct:  s.upside_12m_pct  ?? null,
      target_low_pct:  s.target_low_pct  ?? null,
      target_high_pct: s.target_high_pct ?? null,
      consensus:       s.consensus       ?? null,
    };
  });
}

/* ── Yahoo Finance live quote ── */
async function fetchQuote(ticker) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No data');
  const meta  = result.meta;
  const price = meta.regularMarketPrice ?? meta.previousClose;
  const prev  = meta.chartPreviousClose ?? meta.previousClose;
  return {
    ticker:     ticker.toUpperCase(),
    name:       meta.longName || meta.shortName || ticker.toUpperCase(),
    price,
    change_pct: prev ? ((price - prev) / prev) * 100 : 0,
  };
}

/* ── Badge ── */
function badge(pct) {
  const cls  = pct >= 0 ? 'up' : 'down';
  const sign = pct >= 0 ? '+' : '';
  return `<span class="change ${cls}">${sign}${pct.toFixed(2)}%</span>`;
}

/* ── Agent card (with optional inline calculator) ── */
function agentCard(s, { showSector = false, showReasoning = false } = {}) {
  const cur     = s.ticker.includes('.') ? '€' : '$';
  const hasCalc = s.upside_12m_pct != null;

  return `
    <div class="card${hasCalc ? ' has-calc' : ''}" data-ticker="${s.ticker}">
      <div class="card-main">
        <div class="card-header">
          <span class="ticker">${s.ticker}</span>
          ${badge(s.change_pct)}
        </div>
        <div class="name">${s.name}</div>
        <div class="price">${cur}${s.price.toFixed(2)}</div>
        ${showSector && s.sector   ? `<div class="sector-tag">${s.sector}</div>` : ''}
        ${showReasoning && s.reasoning ? `<div class="reasoning">${s.reasoning}</div>` : ''}
        ${hasCalc ? `<div class="expand-hint">Simulate investment ↓</div>` : ''}
      </div>
      ${hasCalc ? `
      <div class="card-calc-panel">
        <div class="ccp-inner">
          <div class="ccp-inputs">
            <div class="ccp-field">
              <label>Amount (${cur})</label>
              <input class="ccp-amount" type="number" min="1" placeholder="e.g. 500" />
            </div>
            <div class="ccp-field">
              <label>Hold (months)</label>
              <input class="ccp-months" type="number" min="1" max="60" value="3" />
            </div>
          </div>
          <div class="ccp-result"></div>
        </div>
      </div>` : ''}
    </div>`;
}

/* ── Card click → expand/collapse ── */
document.addEventListener('click', e => {
  const main = e.target.closest('.card-main');
  if (!main) return;
  const card = main.closest('.card.has-calc');
  if (!card) return;

  const isExpanded = card.classList.contains('expanded');

  // Collapse all
  document.querySelectorAll('.card.expanded').forEach(c => {
    c.classList.remove('expanded');
    const h = c.querySelector('.expand-hint');
    if (h) h.textContent = 'Simulate investment ↓';
  });

  if (!isExpanded) {
    card.classList.add('expanded');
    const h = card.querySelector('.expand-hint');
    if (h) h.textContent = 'Close ↑';
    // focus amount after animation
    setTimeout(() => card.querySelector('.ccp-amount')?.focus(), 380);
  }
});

/* ── Calculation on input ── */
document.addEventListener('input', e => {
  const input = e.target;
  if (!input.classList.contains('ccp-amount') && !input.classList.contains('ccp-months')) return;

  const panel  = input.closest('.card-calc-panel');
  const card   = panel?.closest('.card');
  const ticker = card?.dataset.ticker;
  const stock  = ticker ? stockMap[ticker] : null;
  if (!stock) return;

  const amount = parseFloat(panel.querySelector('.ccp-amount').value);
  const months = parseFloat(panel.querySelector('.ccp-months').value);
  const result = panel.querySelector('.ccp-result');

  if (!amount || amount <= 0 || !months || months <= 0) { result.innerHTML = ''; return; }

  result.innerHTML = buildCalcHTML(stock, amount, months);
});

/* ── Probability helpers ── */
function calcProbabilities(stock, months) {
  const base = { 'Strong Buy': 0.78, 'Buy': 0.65, 'Hold': 0.50, 'Sell': 0.30 }[stock.consensus] ?? 0.58;
  const up   = stock.upside_12m_pct ?? 0;

  let profitProb = base;
  if (up > 30)  profitProb += 0.05;
  if (up < 0)   profitProb -= 0.15;
  if (up < -10) profitProb -= 0.08;
  profitProb += Math.min(months * 0.008, 0.06);
  profitProb = Math.min(Math.max(profitProb, 0.12), 0.93);

  let doubleProb = 0;
  if (up > 0) {
    const mExp = Math.pow(1 + up / 100, 1 / 12) - 1;
    const mReq = Math.pow(2, 1 / months) - 1;
    if (mReq > 0) {
      const r = mExp / mReq;
      doubleProb = r >= 1.5 ? 0.46 : r >= 1.0 ? 0.28 : r >= 0.6 ? 0.13 : r >= 0.3 ? 0.05 : 0.02;
    }
  }
  return { profitProb, doubleProb };
}

function probFillClass(p) { return p >= 0.65 ? 'fill-up' : p >= 0.45 ? 'fill-mid' : 'fill-down'; }

function prorateCompound(annualPct, months) {
  const monthly = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  return (Math.pow(1 + monthly, months) - 1) * 100;
}

/* ── Build calculator HTML ── */
function buildCalcHTML(stock, amount, months) {
  const { currency, upside_12m_pct: up12 } = stock;
  const fmt  = n => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtP = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

  // Expected outcome (compound proration)
  const expPct    = prorateCompound(up12, months);
  const expGain   = amount * expPct / 100;
  const expFinal  = amount + expGain;
  const gainClass = expGain >= 0 ? 'up' : 'down';
  const gainSign  = expGain >= 0 ? '+' : '-';

  // Scenarios
  const lowAnnual  = stock.target_low_pct  ?? Math.max(up12 - 35, -30);
  const highAnnual = stock.target_high_pct ?? Math.min(up12 * 2.5, 150);
  const bearPct    = prorateCompound(lowAnnual,  months);
  const bullPct    = prorateCompound(highAnnual, months);

  const bearGain = amount * bearPct / 100;
  const bullGain = amount * bullPct / 100;
  const bearPrice = stock.price * (1 + bearPct / 100);
  const expPrice  = stock.price * (1 + expPct  / 100);
  const bullPrice = stock.price * (1 + bullPct / 100);

  const bearGainClass = bearGain >= 0 ? 'up' : 'down';
  const bearSign      = bearGain >= 0 ? '+' : '-';

  // Probabilities
  const { profitProb, doubleProb } = calcProbabilities(stock, months);
  const pp  = Math.round(profitProb * 100);
  const dp  = Math.round(doubleProb * 100);

  return `
    <div class="ccp-section">
      <div class="ccp-section-label">Projected outcome · ${months}mo</div>
      <div class="ccp-projected">
        <span class="ccp-final">${currency}${fmt(expFinal)}</span>
        <span class="ccp-gain ${gainClass}">${gainSign}${currency}${fmt(expGain)} &nbsp;(${fmtP(expPct)})</span>
      </div>
      <div class="ccp-source">Analyst 12-mo consensus ${up12 >= 0 ? '+' : ''}${up12}% · prorated ${months}mo</div>
    </div>

    <div class="ccp-section">
      <div class="ccp-section-label">Likelihood</div>
      <div class="ccp-prob-row">
        <span class="ccp-prob-label">Profit probability</span>
        <div class="ccp-prob-bar">
          <div class="ccp-prob-fill ${probFillClass(profitProb)}" style="width:${pp}%"></div>
        </div>
        <span class="ccp-prob-val">${pp}%</span>
      </div>
      <div class="ccp-prob-row">
        <span class="ccp-prob-label">2× in ${months}mo</span>
        <div class="ccp-prob-bar">
          <div class="ccp-prob-fill ${probFillClass(doubleProb)}" style="width:${dp}%"></div>
        </div>
        <span class="ccp-prob-val">${dp}%</span>
      </div>
    </div>

    <div class="ccp-section">
      <div class="ccp-section-label">Price scenarios in ${months}mo</div>
      <div class="ccp-scenarios">
        <div class="ccp-scenario bear">
          <span class="ccp-sc-label">Bear</span>
          <span class="ccp-sc-price">${currency}${bearPrice.toFixed(2)}</span>
          <span class="ccp-sc-pct ${bearGainClass}">${fmtP(bearPct)}</span>
          <span class="ccp-sc-gain ${bearGainClass}">${bearSign}${currency}${fmt(bearGain)}</span>
        </div>
        <div class="ccp-scenario mid">
          <span class="ccp-sc-label">Expected</span>
          <span class="ccp-sc-price">${currency}${expPrice.toFixed(2)}</span>
          <span class="ccp-sc-pct ${gainClass}">${fmtP(expPct)}</span>
          <span class="ccp-sc-gain ${gainClass}">${gainSign}${currency}${fmt(expGain)}</span>
        </div>
        <div class="ccp-scenario bull">
          <span class="ccp-sc-label">Bull</span>
          <span class="ccp-sc-price">${currency}${bullPrice.toFixed(2)}</span>
          <span class="ccp-sc-pct up">${fmtP(bullPct)}</span>
          <span class="ccp-sc-gain up">+${currency}${fmt(bullGain)}</span>
        </div>
      </div>
    </div>`;
}

/* ── Tracked section ── */
async function refreshTracked() {
  const tickers = getTracked();
  const section = document.getElementById('tracked-section');
  const grid    = document.getElementById('tracked-grid');
  const countEl = document.getElementById('tracked-count');

  if (!tickers.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  countEl.textContent   = tickers.length;

  grid.innerHTML = tickers.map(t => `
    <div class="card loading" id="card-${t}">
      <div class="card-main">
        <div class="card-header"><span class="ticker">${t}</span></div>
        <div class="name">Loading…</div>
        <div class="price">—</div>
      </div>
    </div>`).join('');

  await Promise.all(tickers.map(async ticker => {
    const el = document.getElementById(`card-${ticker}`);
    try {
      const s = await fetchQuote(ticker);
      el.classList.remove('loading');
      el.innerHTML = `
        <div class="card-main">
          <button class="remove-btn" title="Remove" data-ticker="${ticker}">✕</button>
          <div class="card-header">
            <span class="ticker">${s.ticker}</span>
            ${badge(s.change_pct)}
          </div>
          <div class="name">${s.name}</div>
          <div class="price">$${s.price.toFixed(2)}</div>
        </div>`;
    } catch {
      el.classList.remove('loading');
      el.innerHTML = `
        <div class="card-main">
          <button class="remove-btn" title="Remove" data-ticker="${ticker}">✕</button>
          <div class="card-header"><span class="ticker">${ticker}</span></div>
          <div class="name fetch-error">Could not load.</div>
        </div>`;
    }
  }));

  grid.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      saveTracked(getTracked().filter(t => t !== btn.dataset.ticker));
      refreshTracked();
    });
  });
}

/* ── Add-stock bar ── */
const tickerInput = document.getElementById('ticker-input');
const addBtn      = document.getElementById('add-btn');

async function addStock() {
  const raw = tickerInput.value.trim().toUpperCase();
  if (!raw || getTracked().includes(raw)) { tickerInput.value = ''; return; }

  addBtn.disabled    = true;
  addBtn.textContent = 'Adding…';
  try {
    await fetchQuote(raw);
    saveTracked([...getTracked(), raw]);
    tickerInput.value = '';
    await refreshTracked();
  } catch {
    tickerInput.style.borderColor = 'var(--down)';
    setTimeout(() => (tickerInput.style.borderColor = ''), 1500);
  } finally {
    addBtn.disabled    = false;
    addBtn.textContent = 'Add stock';
  }
}

addBtn.addEventListener('click', addStock);
tickerInput.addEventListener('keydown', e => { if (e.key === 'Enter') addStock(); });

/* ── Agent data ── */
function render(id, items, opts) {
  const el = document.getElementById(id);
  if (!items.length) {
    el.innerHTML = '<p class="empty-state">No data yet — run the scheduled agent.</p>';
    return;
  }
  el.innerHTML = items.map(s => agentCard(s, opts)).join('');
}

async function loadAgentData() {
  try {
    const res  = await fetch('./data/stocks.json?v=' + Date.now());
    if (!res.ok) throw new Error();
    const data = await res.json();

    document.getElementById('updated-at').textContent = data.updated_at
      ? 'Updated ' + new Date(data.updated_at).toLocaleString()
      : 'Agent data not yet available';

    render('watchlist-grid', data.watchlist    || [], {});
    render('sector-grid',   data.sector_picks  || [], { showSector: true });
    render('picks-grid',    data.claude_picks  || [], { showReasoning: true });

    // Register all stocks in the map for calculator lookups
    registerStocks([
      ...(data.claude_picks  || []),
      ...(data.watchlist     || []),
      ...(data.sector_picks  || []),
    ]);
  } catch {
    document.getElementById('error').style.display = 'block';
    ['watchlist-grid', 'sector-grid', 'picks-grid'].forEach(id => {
      document.getElementById(id).innerHTML = '<p class="empty-state">No agent data.</p>';
    });
  }
}

/* ── Init ── */
refreshTracked();
loadAgentData();
