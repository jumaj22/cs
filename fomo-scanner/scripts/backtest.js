#!/usr/bin/env node
// Analyse du CSV papier : npm run backtest [-- --file data/trades.csv --since 2026-01-01]
import path from 'node:path';
import { loadConfig, ROOT } from '../src/config.js';
import { readCsvFile } from '../src/utils/csv.js';
import { computeStats, groupBy } from '../src/backtest/stats.js';

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const cfg = loadConfig();
const file = arg('file') ? path.resolve(ROOT, arg('file')) : cfg.paper.csvFile;
let trades = readCsvFile(file);
if (arg('since')) trades = trades.filter((t) => Date.parse(t.open_time) >= Date.parse(arg('since')));

if (!trades.length) {
  console.log(`Aucun trade dans ${file}. Lance d'abord "npm start" et laisse tourner le scanner.`);
  process.exit(0);
}

const cap = cfg.paper.startingCapitalUsd;
const f = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '∞');
function row(name, s) {
  return {
    Groupe: name,
    Trades: s.trades,
    'Ouverts': s.open,
    'Réussite %': f(s.winRatePct),
    'Gain moy. %': f(s.avgWinPct),
    'Perte moy. %': f(s.avgLossPct),
    'Espérance %': f(s.expectancyPct, 2),
    'P&L $': f(s.totalPnlUsd, 2),
    'Profit factor': f(s.profitFactor, 2),
    'Drawdown max %': f(s.maxDrawdownPct),
  };
}

const global = computeStats(trades, cap);
console.log(`\n═══ BACKTEST — ${file} ═══`);
console.log(`Capital initial simulé : ${cap} $ · taille par trade : ${cfg.paper.positionSizeUsd} $\n`);
console.log('Résultat global');
console.table([row('TOUS', global)]);
console.log(`Drawdown max : ${f(global.maxDrawdownPct)} % (${f(global.maxDrawdownUsd, 2)} $) · meilleur ${f(global.bestPct)} % · pire ${f(global.worstPct)} %\n`);

const label = { FOMO: 'FOMO seul', SMART_MONEY: 'Smart money seul', 'FOMO+SMART_MONEY': 'FOMO + smart money' };
console.log('Par type de signal');
const byType = groupBy(trades, (t) => [label[t.signal_type] || t.signal_type, t.signal_type.includes('SMART') ? 'Smart money (tous)' : null]);
console.table([...byType].map(([k, v]) => row(k, computeStats(v, cap))));

console.log('Vérifié / non vérifié');
const byVerif = groupBy(trades, (t) => (t.verified === 'oui' ? 'Vérifié' : 'Non vérifié'));
console.table([...byVerif].map(([k, v]) => row(k, computeStats(v, cap))));

console.log('Type × vérification');
const cross = groupBy(trades, (t) => `${label[t.signal_type] || t.signal_type} · ${t.verified === 'oui' ? 'vérifié' : 'non vérifié'}`);
console.table([...cross].map(([k, v]) => row(k, computeStats(v, cap))));

console.log('Par motif de sortie');
const byExit = groupBy(trades.filter((t) => t.status === 'CLOSED'), (t) => t.exit_reason || '?');
console.table([...byExit].map(([k, v]) => ({ Sortie: k, Trades: v.length, 'P&L moy. %': f(computeStats(v, cap).expectancyPct, 2) })));

if (global.trades < 30) console.log(`⚠️  Seulement ${global.trades} trades clôturés : échantillon trop petit pour conclure (vise ≥ 30 par groupe).`);
