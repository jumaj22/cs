// Statistiques de performance sur les trades papier clôturés (fonctions pures).
export function computeStats(trades, startingCapital = 1000) {
  const closed = trades
    .filter((t) => t.status === 'CLOSED' && t.pnl_pct !== '' && Number.isFinite(Number(t.pnl_pct)))
    .sort((a, b) => Date.parse(a.close_time) - Date.parse(b.close_time));
  const pnls = closed.map((t) => Number(t.pnl_pct));
  const usd = closed.map((t) => Number(t.pnl_usd) || 0);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  // Drawdown max sur la courbe de capital (capital initial + P&L cumulés)
  let equity = startingCapital;
  let peak = startingCapital;
  let maxDdPct = 0;
  let maxDdUsd = 0;
  for (const u of usd) {
    equity += u;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxDdUsd) maxDdUsd = dd;
    if (peak > 0) maxDdPct = Math.max(maxDdPct, (dd / peak) * 100);
  }
  const grossWin = usd.filter((u) => u > 0).reduce((a, b) => a + b, 0);
  const grossLoss = -usd.filter((u) => u <= 0).reduce((a, b) => a + b, 0);
  return {
    trades: closed.length,
    open: trades.filter((t) => t.status === 'OPEN').length,
    winRatePct: closed.length ? (wins.length / closed.length) * 100 : 0,
    avgWinPct: avg(wins),
    avgLossPct: avg(losses),
    expectancyPct: avg(pnls),
    totalPnlUsd: usd.reduce((a, b) => a + b, 0),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDdPct,
    maxDrawdownUsd: maxDdUsd,
    bestPct: pnls.length ? Math.max(...pnls) : 0,
    worstPct: pnls.length ? Math.min(...pnls) : 0,
  };
}

export function groupBy(trades, keyFn) {
  const m = new Map();
  for (const t of trades) {
    for (const k of [].concat(keyFn(t))) {
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
  }
  return m;
}
