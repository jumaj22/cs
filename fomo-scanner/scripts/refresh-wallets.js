#!/usr/bin/env node
// Force la reconstruction de la liste smart money : npm run wallets:refresh
import { loadConfig, env } from '../src/config.js';
import { configureHttp } from '../src/utils/http.js';
import { MarketData } from '../src/data/marketData.js';
import { WalletList } from '../src/smartmoney/walletList.js';

const cfg = loadConfig();
configureHttp(cfg.http);
if (!env.heliusKey) {
  console.error('❌ HELIUS_API_KEY manquante dans .env (voir README étape 4).');
  process.exit(1);
}
const list = new WalletList(cfg, new MarketData(cfg));
await list.refresh();
console.table(
  [...list.wallets.values()].map((w) => ({
    wallet: w.address,
    'WR %': w.winRatePct.toFixed(0),
    trades: w.trades,
    clôturées: w.closedPositions,
    'P&L $': w.realizedPnlUsd.toFixed(0),
  })),
);
