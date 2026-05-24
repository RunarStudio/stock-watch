/* ── localStorage helpers ── */
const LS_KEY = 'stockwatch_tracked';
function getTracked() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}
function saveTracked(tickers) {
  localStorage.setItem(LS_KEY, JSON.stringify(tickers));
}

/* ── Yahoo Finance live quote ── */
async function fetchQuote(ticker) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No data');
  const meta = result.meta;
  const price = meta.regularMarketPrice ?? meta.previousClose;
  const prev  = meta.chartPreviousClose ?? meta.previousClose;
  return {
    ticker:     ticker.toUpperCase(),
    name:       meta.longName || meta.shortName || ticker.toUpperCase(),
    price:      price,
    change_pct: prev ? ((price - prev) / prev) * 100 : 0,
  };
}

/* ── Badge ── */
function badge(pct) {
  const cls  = pct >= 0 ? 'up' : 'down';
  const sign = pct >= 0 ? '+' : '';
  return `<span class="change ${cls}">${sign}${pct.toFixed(2)}%</span>`;
}

/* ── Agent-data card (no remove btn) ── */
function agentCard(s, { showSector = false, showReasoning = false } = {}) {
  return `
    <div class="card">
      <div class="card-header">
        <span class="ticker">${s.ticker}</span>
        ${badge(s.change_pct)}
      </div>
      <div class="name">${s.name}</div>
      <div class="price">$${s.price.toFixed(2)}</div>
      ${showSector && s.sector ? `<div class="sector-tag">${s.sector}</div>` : ''}
      ${showReasoning && s.reasoning ? `<div class="reasoning">${s.reasoning}</div>` : ''}
    </div>`;
}

/* ── Tracked section ── */
async function refreshTracked() {
  const tickers = getTracked();
  const section  = document.getElementById('tracked-section');
  const grid     = document.getElementById('tracked-grid');
  const countEl  = document.getElementById('tracked-count');

  if (!tickers.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  countEl.textContent = tickers.length;

  // Skeleton placeholders
  grid.innerHTML = tickers.map(t => `
    <div class="card loading" id="card-${t}">
      <div class="card-header">
        <span class="ticker">${t}</span>
      </div>
      <div class="name">Loading…</div>
      <div class="price">—</div>
    </div>`).join('');

  // Fetch each ticker concurrently
  await Promise.all(tickers.map(async ticker => {
    const el = document.getElementById(`card-${ticker}`);
    try {
      const s = await fetchQuote(ticker);
      el.classList.remove('loading');
      el.innerHTML = `
        <button class="remove-btn" title="Remove" data-ticker="${ticker}">✕</button>
        <div class="card-header">
          <span class="ticker">${s.ticker}</span>
          ${badge(s.change_pct)}
        </div>
        <div class="name">${s.name}</div>
        <div class="price">$${s.price.toFixed(2)}</div>`;
    } catch {
      el.classList.remove('loading');
      el.innerHTML = `
        <button class="remove-btn" title="Remove" data-ticker="${ticker}">✕</button>
        <div class="card-header"><span class="ticker">${ticker}</span></div>
        <div class="name fetch-error">Could not load — market may be closed.</div>`;
    }
  }));

  // Remove buttons
  grid.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeTracked(btn.dataset.ticker));
  });
}

function removeTracked(ticker) {
  saveTracked(getTracked().filter(t => t !== ticker));
  refreshTracked();
  document.getElementById('tracked-count').textContent = getTracked().length;
}

/* ── Add-stock bar ── */
const input  = document.getElementById('ticker-input');
const addBtn = document.getElementById('add-btn');

async function addStock() {
  const raw    = input.value.trim().toUpperCase();
  if (!raw) return;
  const exists = getTracked().includes(raw);
  if (exists) { input.value = ''; return; }

  addBtn.disabled = true;
  addBtn.textContent = 'Adding…';

  try {
    await fetchQuote(raw); // validate ticker exists
    saveTracked([...getTracked(), raw]);
    input.value = '';
    await refreshTracked();
  } catch {
    input.style.borderColor = 'var(--down)';
    setTimeout(() => (input.style.borderColor = ''), 1500);
  } finally {
    addBtn.disabled = false;
    addBtn.textContent = 'Add stock';
  }
}

addBtn.addEventListener('click', addStock);
input.addEventListener('keydown', e => { if (e.key === 'Enter') addStock(); });

/* ── Agent-data sections ── */
async function loadAgentData() {
  try {
    const res = await fetch('./data/stocks.json?v=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.updated_at) {
      document.getElementById('updated-at').textContent =
        'Updated ' + new Date(data.updated_at).toLocaleString();
    } else {
      document.getElementById('updated-at').textContent = 'Agent data not yet available';
    }

    render('watchlist-grid', data.watchlist || [], {});
    render('sector-grid',   data.sector_picks || [], { showSector: true });
    render('picks-grid',    data.claude_picks  || [], { showReasoning: true });

    // Populate calculator dropdown: picks first, then watchlist, then sector
    const combined = [
      ...(data.claude_picks  || []),
      ...(data.watchlist     || []),
      ...(data.sector_picks  || []),
    ];
    populateCalcDropdown(combined);
  } catch {
    document.getElementById('error').style.display = 'block';
    ['watchlist-grid', 'sector-grid', 'picks-grid'].forEach(id => {
      document.getElementById(id).innerHTML = '<p class="empty-state">No agent data.</p>';
    });
  }
}

function render(id, items, opts) {
  const el = document.getElementById(id);
  if (!items.length) {
    el.innerHTML = '<p class="empty-state">No data yet — run the scheduled agent.</p>';
    return;
  }
  el.innerHTML = items.map(s => agentCard(s, opts)).join('');
}

/* ── Calculator ── */
const stockMap = {}; // ticker → { name, price, upside_12m_pct, currency }

const globalMonths = document.getElementById('global-months');
const calcMonths   = document.getElementById('calc-months-local');
const calcStock    = document.getElementById('calc-stock');
const calcAmount   = document.getElementById('calc-amount');
const calcResult   = document.getElementById('calc-result');
const calcNoTarget = document.getElementById('calc-no-target');
const calcCurrency = document.getElementById('calc-currency');

globalMonths.addEventListener('input', () => { calcMonths.value = globalMonths.value; runCalc(); });
calcMonths.addEventListener('input',   () => { globalMonths.value = calcMonths.value;  runCalc(); });

function syncMonthsInit() { calcMonths.value = globalMonths.value; }

function populateCalcDropdown(stocks) {
  stocks.forEach(s => {
    if (stockMap[s.ticker]) return; // deduplicate
    stockMap[s.ticker] = {
      name:          s.name,
      price:         s.price,
      upside_12m_pct: (s.upside_12m_pct != null) ? s.upside_12m_pct : null,
      currency:      s.ticker.includes('.') ? '€' : '$',
    };
    const opt = document.createElement('option');
    opt.value = s.ticker;
    opt.textContent = `${s.ticker} — ${s.name}`;
    calcStock.appendChild(opt);
  });
}

function runCalc() {
  const ticker = calcStock.value;
  const amount = parseFloat(calcAmount.value);
  const months = parseFloat(calcMonths.value);

  calcResult.style.display   = 'none';
  calcNoTarget.style.display = 'none';

  if (!ticker || !amount || amount <= 0 || !months || months <= 0) return;

  const stock = stockMap[ticker];
  if (!stock) return;

  const { upside_12m_pct: upside12m, currency } = stock;
  calcCurrency.textContent = currency;

  if (upside12m === null) {
    calcNoTarget.style.display = 'block';
    return;
  }

  const monthlyRate   = Math.pow(1 + upside12m / 100, 1 / 12) - 1;
  const projectedGain = amount * Math.pow(1 + monthlyRate, months) - amount;
  const finalValue    = amount + projectedGain;
  const totalPct      = (projectedGain / amount) * 100;
  const isGain        = projectedGain >= 0;

  const fmt = n => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  document.getElementById('calc-label').textContent =
    `If you invest ${currency}${fmt(amount)} in ${ticker} over ${months} month${months !== 1 ? 's' : ''}:`;
  document.getElementById('calc-final').textContent = `${currency}${fmt(finalValue)}`;

  const profitEl = document.getElementById('calc-profit');
  profitEl.textContent = `${isGain ? '+' : ''}${currency}${fmt(projectedGain)}`;
  profitEl.className   = `calc-chip ${isGain ? 'gain' : 'loss'}`;

  document.getElementById('calc-pct').textContent  = `${isGain ? '+' : ''}${totalPct.toFixed(2)}%`;
  document.getElementById('calc-note').textContent =
    `Based on ${upside12m >= 0 ? '+' : ''}${upside12m}% analyst 12-month consensus, prorated over ${months} month${months !== 1 ? 's' : ''}.`;

  calcResult.style.display = 'flex';
}

calcStock.addEventListener('change', runCalc);
calcAmount.addEventListener('input',  runCalc);

/* ── Init ── */
syncMonthsInit();
refreshTracked();
loadAgentData();
