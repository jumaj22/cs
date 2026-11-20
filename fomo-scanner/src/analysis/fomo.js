// Détection FOMO : fonctions pures (testables) sur un snapshot normalisé.
import { fmtUsd, fmtPct } from '../utils/format.js';

/**
 * Nombre de tranches de 5 min couvertes par les données "1 h".
 * Un token de 20 min n'a que 4 tranches : diviser par 12 sous-estimerait la moyenne
 * et gonflerait artificiellement les ratios.
 */
export function bucketsIn1h(pairCreatedAt, now = Date.now()) {
  if (!pairCreatedAt) return 12;
  const ageMin = (now - pairCreatedAt) / 60000;
  return Math.min(12, Math.max(1, ageMin / 5));
}

export function computeFomoMetrics(t, now = Date.now()) {
  const buckets = bucketsIn1h(t.pairCreatedAt, now);
  const avgVol5m = t.volume.h1 / buckets;
  const avgBuys5m = t.txns.h1.buys / buckets;
  const buys5m = t.txns.m5.buys;
  const sells5m = t.txns.m5.sells;
  return {
    volume5m: t.volume.m5,
    volume1h: t.volume.h1,
    volumeRatio: avgVol5m > 0 ? t.volume.m5 / avgVol5m : t.volume.m5 > 0 ? 99 : 0,
    priceChange5m: t.priceChange.m5,
    priceChange1h: t.priceChange.h1,
    buys5m,
    sells5m,
    buyGrowthRatio: avgBuys5m > 0 ? buys5m / avgBuys5m : buys5m > 0 ? 99 : 0,
    buySellRatio5m: sells5m > 0 ? buys5m / sells5m : buys5m,
    liquidityUsd: t.liquidityUsd ?? 0,
    ageMinutes: t.pairCreatedAt ? (now - t.pairCreatedAt) / 60000 : null,
  };
}

/**
 * Évalue les règles FOMO. Toutes les conditions doivent être vraies.
 * @returns {{pass, tooLate, metrics, checks, failed, summary}}
 */
export function evaluateFomo(t, cfg, now = Date.now()) {
  const m = computeFomoMetrics(t, now);
  const checks = [
    { id: 'liquidity', ok: m.liquidityUsd >= cfg.minLiquidityUsd, label: `liquidité ${fmtUsd(m.liquidityUsd)} ≥ ${fmtUsd(cfg.minLiquidityUsd)}` },
    { id: 'volume5m', ok: m.volume5m >= cfg.minVolume5mUsd, label: `volume 5 min ${fmtUsd(m.volume5m)} ≥ ${fmtUsd(cfg.minVolume5mUsd)}` },
    { id: 'volumeSpike', ok: m.volumeRatio >= cfg.volumeSpikeRatio, label: `volume 5 min = ×${m.volumeRatio.toFixed(1)} la moyenne 1 h (seuil ×${cfg.volumeSpikeRatio})` },
    { id: 'price5m', ok: m.priceChange5m >= cfg.minPriceChange5mPct, label: `prix 5 min ${fmtPct(m.priceChange5m)} (seuil ${fmtPct(cfg.minPriceChange5mPct)})` },
    { id: 'price1h', ok: m.priceChange1h >= cfg.minPriceChange1hPct, label: `prix 1 h ${fmtPct(m.priceChange1h)} (seuil ${fmtPct(cfg.minPriceChange1hPct)})` },
    { id: 'tooLate', ok: m.priceChange1h <= cfg.maxPriceChange1hPct, label: `pas trop tard : 1 h ${fmtPct(m.priceChange1h)} ≤ ${fmtPct(cfg.maxPriceChange1hPct)}` },
    { id: 'buys5m', ok: m.buys5m >= cfg.minBuys5m, label: `${m.buys5m} achats en 5 min (min ${cfg.minBuys5m})` },
    { id: 'buyGrowth', ok: m.buyGrowthRatio >= cfg.minBuyTxGrowthRatio, label: `achats 5 min = ×${m.buyGrowthRatio.toFixed(1)} la moyenne 1 h (seuil ×${cfg.minBuyTxGrowthRatio})` },
    { id: 'buySell', ok: m.buySellRatio5m >= cfg.minBuySellRatio5m, label: `ratio achats/ventes 5 min ${m.buySellRatio5m.toFixed(2)} (min ${cfg.minBuySellRatio5m})` },
  ];
  const failed = checks.filter((c) => !c.ok);
  const tooLate = !checks.find((c) => c.id === 'tooLate').ok;
  const summary =
    `volume ×${m.volumeRatio.toFixed(1)} vs moy. 1 h, prix ${fmtPct(m.priceChange5m)} (5 min) / ${fmtPct(m.priceChange1h)} (1 h), ` +
    `achats ×${m.buyGrowthRatio.toFixed(1)} (${m.buys5m} achats / ${m.sells5m} ventes en 5 min), liquidité ${fmtUsd(m.liquidityUsd)}`;
  return { pass: failed.length === 0, tooLate, metrics: m, checks, failed, summary };
}
