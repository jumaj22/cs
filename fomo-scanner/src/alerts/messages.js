// Mise en forme HTML des alertes Telegram.
import { escapeHtml as h, fmtPrice, fmtUsd, fmtPct, shortAddr, fmtAge } from '../utils/format.js';

const CHAIN = { solana: 'Solana', base: 'Base' };
const TYPE = { FOMO: 'FOMO', SMART_MONEY: 'SMART MONEY', 'FOMO+SMART_MONEY': 'FOMO + SMART MONEY' };

function walletLines(wallets) {
  if (!wallets?.length) return '• aucun wallet smart money détecté sur ce token';
  return wallets
    .map((w) => `• <code>${h(shortAddr(w.address))}</code> — WR ${w.winRatePct?.toFixed(0) ?? '?'} % (${w.trades ?? '?'} trades) — ${fmtUsd(w.amountUsd)}`)
    .join('\n');
}

export function entryMessage({ trade, token, signalType, reason, security, wallets, fomo, exitCfg }) {
  const verified = trade.verified === 'oui';
  const totalBought = (wallets || []).reduce((a, w) => a + (w.amountUsd || 0), 0);
  const ts = exitCfg.trailingStop;
  const sec = security?.sec;
  return [
    `🟢 <b>ENTRÉE — ${TYPE[signalType] || signalType}</b>${verified ? ' ✅ vérifié' : ' ⚠️ <b>NON VÉRIFIÉ</b>'}`,
    `<b>$${h(token.symbol)}</b> ${token.name && token.name !== token.symbol ? `(${h(token.name)}) ` : ''}· ${CHAIN[token.chain] || token.chain}`,
    `<code>${h(token.tokenAddress)}</code>`,
    '',
    `<b>Raison :</b> ${h(reason)}`,
    '',
    `<b>Wallets acheteurs :</b>\n${walletLines(wallets)}`,
    wallets?.length
      ? `<b>Montant acheté (smart money) :</b> ${fmtUsd(totalBought)}`
      : `<b>Volume 5 min :</b> ${fmtUsd(token.volume.m5)} (${token.txns.m5.buys} achats)`,
    '',
    `<b>Prix d'entrée :</b> ${fmtPrice(trade.entry_price)}`,
    `<b>Stop-loss :</b> ${fmtPrice(trade.stop_loss)} (-${exitCfg.stopLossPct} %)`,
    `<b>Take-profit :</b> ${fmtPrice(trade.take_profit)} (+${exitCfg.takeProfitPct} %)`,
    ts?.enabled ? `<b>Trailing stop :</b> activé à +${ts.activationPct} %, distance ${ts.distancePct} %` : null,
    '',
    `Liq. ${fmtUsd(token.liquidityUsd)} · Âge ${fmtAge(token.pairCreatedAt)} · 1 h ${fmtPct(token.priceChange.h1)}` +
      (sec ? ` · Top10 ${sec.top10HolderPct?.toFixed(0) ?? '?'} % · LP verr. ${sec.lpLockedPct?.toFixed(0) ?? (token.dexId === 'pumpfun' ? 'courbe' : '?')} % · Taxe vente ${sec.sellTaxPct?.toFixed(0) ?? '?'} %` : ''),
    `<a href="${h(token.url)}">📈 Voir sur DexScreener</a>`,
    `<i>Mode papier — aucun ordre réel.</i>`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export function exitMessage({ trade, label, price }) {
  const pnl = Number(trade.pnl_pct);
  return [
    `${pnl >= 0 ? '🔵' : '🔴'} <b>SORTIE — $${h(trade.symbol)}</b> (${h(trade.signal_type)})`,
    `<b>Raison :</b> ${h(label)}`,
    `Entrée ${fmtPrice(trade.entry_price)} → Sortie ${fmtPrice(Number(trade.exit_price) || price)}`,
    `<b>P&amp;L simulé :</b> ${fmtPct(pnl)} (${fmtUsd(Number(trade.pnl_usd))})`,
    `<a href="${h(trade.dexscreener_url)}">📈 DexScreener</a>`,
  ].join('\n');
}

export function smartSellMessage({ symbol, mint, chain, wallet, amountUsd, sellersCount, buyersCount, url }) {
  return [
    `🟠 <b>SMART MONEY VEND — $${h(symbol || shortAddr(mint))}</b> (${CHAIN[chain] || chain})`,
    `Wallet <code>${h(shortAddr(wallet.address))}</code> (WR ${wallet.winRatePct?.toFixed(0) ?? '?'} %) a vendu ~${fmtUsd(amountUsd)}`,
    buyersCount ? `${sellersCount}/${buyersCount} des wallets acheteurs ont vendu.` : null,
    `<b>Signal de sortie</b> — envisage de réduire/fermer la position.`,
    url ? `<a href="${h(url)}">📈 DexScreener</a>` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function startupMessage(cfg, info) {
  return [
    '🚀 <b>FOMO Scanner démarré</b>',
    `Chaînes : ${cfg.chains.map((c) => CHAIN[c]).join(', ')} · scan toutes les ${cfg.scanIntervalSec} s`,
    `Smart money : ${info.smartMoney}`,
    `Sorties : TP +${cfg.signals.exit.takeProfitPct} % · SL -${cfg.signals.exit.stopLossPct} %` +
      (cfg.signals.exit.trailingStop.enabled ? ` · trailing ${cfg.signals.exit.trailingStop.distancePct} %` : ''),
    `Positions papier ouvertes : ${info.openTrades}`,
    '<i>Mode papier uniquement — aucun ordre réel.</i>',
  ].join('\n');
}
