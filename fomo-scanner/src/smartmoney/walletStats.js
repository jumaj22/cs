// Statistiques de performance d'un wallet à partir de ses swaps (coût moyen pondéré).
// - trades : nombre de swaps (achats + ventes) sur la période
// - positions clôturées : tokens avec au moins une vente dont le coût d'achat est connu
// - win rate : % de ces tokens dont le P&L réalisé est > 0
// Approximation : valorisation au prix SOL actuel (pas historique).
export function computeWalletStats(swaps) {
  const sorted = [...swaps].sort((a, b) => a.timestamp - b.timestamp);
  const pos = new Map();
  for (const s of sorted) {
    let p = pos.get(s.mint);
    if (!p) pos.set(s.mint, (p = { qty: 0, cost: 0, realized: 0, sold: false }));
    if (s.side === 'BUY') {
      p.qty += s.tokenAmount;
      p.cost += s.amountUsd;
    } else {
      if (p.qty <= 0) continue; // vente sans achat connu dans la fenêtre → ignorée
      const q = Math.min(s.tokenAmount, p.qty);
      const costPart = p.cost * (q / p.qty);
      const proceeds = s.amountUsd * (q / s.tokenAmount);
      p.realized += proceeds - costPart;
      p.qty -= q;
      p.cost -= costPart;
      p.sold = true;
    }
  }
  const closed = [...pos.values()].filter((p) => p.sold);
  const wins = closed.filter((p) => p.realized > 0).length;
  return {
    trades: sorted.length,
    buys: sorted.filter((s) => s.side === 'BUY').length,
    sells: sorted.filter((s) => s.side === 'SELL').length,
    closedPositions: closed.length,
    wins,
    winRatePct: closed.length ? (wins / closed.length) * 100 : 0,
    realizedPnlUsd: closed.reduce((a, p) => a + p.realized, 0),
  };
}

export function qualifies(stats, c) {
  const why = [];
  if (stats.winRatePct <= c.minWinRatePct) why.push(`win rate ${stats.winRatePct.toFixed(0)} % ≤ ${c.minWinRatePct} %`);
  if (stats.trades < c.minTrades) why.push(`${stats.trades} trades < ${c.minTrades}`);
  if (stats.trades > c.maxTrades) why.push(`${stats.trades} trades > ${c.maxTrades} (bot probable)`);
  if (stats.closedPositions < c.minClosedPositions) why.push(`${stats.closedPositions} positions clôturées < ${c.minClosedPositions}`);
  if (stats.realizedPnlUsd <= c.minRealizedPnlUsd) why.push(`P&L ${stats.realizedPnlUsd.toFixed(0)} $ ≤ ${c.minRealizedPnlUsd} $`);
  return { ok: why.length === 0, why };
}
