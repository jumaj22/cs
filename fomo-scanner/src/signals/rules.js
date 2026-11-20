// Règles de signaux ENTRÉE / SORTIE (pures, paramétrées par config.signals).

/** Niveaux suggérés à partir du prix d'entrée. */
export function exitLevels(entryPrice, exitCfg) {
  return {
    stopLoss: entryPrice * (1 - exitCfg.stopLossPct / 100),
    takeProfit: entryPrice * (1 + exitCfg.takeProfitPct / 100),
    trailingActivation: exitCfg.trailingStop?.enabled ? entryPrice * (1 + exitCfg.trailingStop.activationPct / 100) : null,
  };
}

/**
 * Décide si une position doit être fermée au prix courant.
 * Met à jour position.peakPrice (plus haut atteint) pour le trailing stop.
 * @returns {null | {reason, label}}
 */
export function checkExit(position, price, exitCfg, now = Date.now()) {
  if (!Number.isFinite(price) || price <= 0) return null;
  position.peakPrice = Math.max(position.peakPrice || position.entryPrice, price);
  const pnlPct = (price / position.entryPrice - 1) * 100;

  if (price <= position.stopLoss) return { reason: 'STOP_LOSS', label: `stop-loss touché (${pnlPct.toFixed(1)} %)` };
  if (price >= position.takeProfit) return { reason: 'TAKE_PROFIT', label: `take-profit atteint (+${pnlPct.toFixed(1)} %)` };

  const ts = exitCfg.trailingStop;
  if (ts?.enabled) {
    const activated = position.peakPrice >= position.entryPrice * (1 + ts.activationPct / 100);
    const trail = position.peakPrice * (1 - ts.distancePct / 100);
    if (activated && price <= trail) {
      const peakPct = (position.peakPrice / position.entryPrice - 1) * 100;
      return { reason: 'TRAILING_STOP', label: `trailing stop : -${ts.distancePct} % depuis le plus haut (+${peakPct.toFixed(1)} %), sortie à ${pnlPct.toFixed(1)} %` };
    }
  }
  if (exitCfg.maxHoldMinutes && now - position.openedAt >= exitCfg.maxHoldMinutes * 60e3) {
    return { reason: 'TIMEOUT', label: `durée max atteinte (${exitCfg.maxHoldMinutes} min), P&L ${pnlPct.toFixed(1)} %` };
  }
  return null;
}
