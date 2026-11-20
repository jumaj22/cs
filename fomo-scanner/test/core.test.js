import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateFomo } from '../src/analysis/fomo.js';
import { assess, mergeReports } from '../src/security/antiScam.js';
import { checkExit, exitLevels } from '../src/signals/rules.js';
import { parseSwap, SOL_MINT } from '../src/smartmoney/swapParser.js';
import { computeWalletStats, qualifies } from '../src/smartmoney/walletStats.js';
import { ClusterDetector } from '../src/smartmoney/cluster.js';
import { computeStats } from '../src/backtest/stats.js';
import { toCsv, parseCsv } from '../src/utils/csv.js';
import { fromDexScreenerPair, fromGeckoPool } from '../src/data/normalize.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const NOW = Date.UTC(2026, 10, 20, 12);

function token(over = {}) {
  return {
    chain: 'solana', tokenAddress: 'Mint111', pairAddress: 'Pair111', symbol: 'TEST', dexId: 'raydium',
    priceUsd: 0.001, liquidityUsd: 50000, pairCreatedAt: NOW - 3 * 3600e3,
    volume: { m5: 30000, h1: 60000, h6: 100000, h24: 150000 },
    txns: { m5: { buys: 60, sells: 20 }, h1: { buys: 240, sells: 150 }, h24: { buys: 900, sells: 700 } },
    priceChange: { m5: 8, h1: 45, h6: 60, h24: 80 },
    url: 'https://dexscreener.com/solana/Pair111',
    ...over,
  };
}

test('FOMO : token qui pompe → signal', () => {
  const r = evaluateFomo(token(), cfg.fomo, NOW);
  assert.equal(r.pass, true, r.failed.map((c) => c.label).join('; '));
  assert.equal(r.metrics.volumeRatio, 6); // 30000 / (60000/12)
});

test('FOMO : filtre "trop tard" (> 300 % en 1 h)', () => {
  const r = evaluateFomo(token({ priceChange: { m5: 10, h1: 350, h6: 0, h24: 0 } }), cfg.fomo, NOW);
  assert.equal(r.pass, false);
  assert.equal(r.tooLate, true);
});

test('FOMO : liquidité insuffisante', () => {
  assert.equal(evaluateFomo(token({ liquidityUsd: 15000 }), cfg.fomo, NOW).pass, false);
});

test('FOMO : moyenne 1 h ajustée pour un token de 20 min', () => {
  const t = token({ pairCreatedAt: NOW - 20 * 60e3, volume: { m5: 10000, h1: 20000, h6: 0, h24: 0 } });
  // 4 tranches de 5 min → moyenne 5000 → ratio 2 (et non 6 avec /12)
  assert.equal(evaluateFomo(t, cfg.fomo, NOW).metrics.volumeRatio, 2);
});

const goodSec = { sources: ['GoPlus'], isHoneypot: false, buyTaxPct: 0, sellTaxPct: 2, mintable: false, blacklist: false, verified: false, lpLockedPct: 100, top10HolderPct: 18 };

test('Anti-arnaque : token sain non vérifié → accepté, marqué non vérifié', () => {
  const r = assess(token(), goodSec, cfg.antiScam, NOW);
  assert.equal(r.pass, true);
  assert.equal(r.verified, false);
});

test('Anti-arnaque : honeypot, taxe, mint, blacklist, top10, LP, âge', () => {
  const cases = [
    [{ isHoneypot: true }, /HONEYPOT/],
    [{ sellTaxPct: 15 }, /taxe de vente/],
    [{ mintable: true }, /mint/],
    [{ blacklist: true }, /blacklist/],
    [{ top10HolderPct: 45 }, /top 10/],
    [{ lpLockedPct: 20 }, /verrouillée/],
    [{ lpLockedPct: null }, /inconnu/],
  ];
  for (const [over, re] of cases) {
    const r = assess(token(), { ...goodSec, ...over }, cfg.antiScam, NOW);
    assert.equal(r.pass, false, JSON.stringify(over));
    assert.match(r.reasons.join(' '), re);
  }
  const young = assess(token({ pairCreatedAt: NOW - 5 * 60e3 }), goodSec, cfg.antiScam, NOW);
  assert.match(young.reasons.join(' '), /trop récent/);
});

test('Anti-arnaque : pump.fun (courbe) considéré verrouillé', () => {
  const r = assess(token({ dexId: 'pumpfun' }), { ...goodSec, lpLockedPct: null }, cfg.antiScam, NOW);
  assert.equal(r.pass, true);
});

test('Anti-arnaque : fusion prudente des sources', () => {
  const m = mergeReports([
    { source: 'GoPlus', isHoneypot: false, sellTaxPct: 3, verified: false, top10HolderPct: 20, lpLockedPct: null },
    { source: 'Honeypot.is', isHoneypot: true, sellTaxPct: 12, verified: true, top10HolderPct: null, lpLockedPct: null },
  ]);
  assert.equal(m.isHoneypot, true);
  assert.equal(m.sellTaxPct, 12);
  assert.equal(m.verified, true);
});

test('Sorties : SL, TP, trailing stop, timeout', () => {
  const ex = cfg.signals.exit;
  const mk = () => ({ entryPrice: 1, ...exitLevels(1, ex), peakPrice: 1, openedAt: NOW });
  assert.equal(checkExit(mk(), 0.79, ex, NOW).reason, 'STOP_LOSS');
  assert.equal(checkExit(mk(), 1.5, ex, NOW).reason, 'TAKE_PROFIT');
  const p = mk();
  assert.equal(checkExit(p, 1.3, ex, NOW), null); // pic à +30 % → trailing activé
  assert.equal(checkExit(p, 1.2, ex, NOW), null); // -7.7 % depuis le pic
  assert.equal(checkExit(p, 1.1, ex, NOW).reason, 'TRAILING_STOP'); // -15.4 %
  assert.equal(checkExit(mk(), 1.05, ex, NOW + 13 * 3600e3).reason, 'TIMEOUT');
});

const W = 'Wallet1111111111111111111111111111111111111';
function heliusTx({ sig, ts, solChange, tokenChange, mint = 'Meme111' }) {
  return {
    signature: sig, timestamp: ts, feePayer: W, type: 'SWAP',
    accountData: [
      { account: W, nativeBalanceChange: solChange * 1e9, tokenBalanceChanges: [] },
      { account: 'ATA1', nativeBalanceChange: 0, tokenBalanceChanges: [{ userAccount: W, mint, rawTokenAmount: { tokenAmount: String(tokenChange * 1e6), decimals: 6 } }] },
    ],
  };
}

test('Swap parser : achat et vente', () => {
  const buy = parseSwap(heliusTx({ sig: 'a', ts: 1, solChange: -2, tokenChange: 1000 }), W, 150);
  assert.equal(buy.side, 'BUY');
  assert.equal(buy.amountUsd, 300);
  const sell = parseSwap(heliusTx({ sig: 'b', ts: 2, solChange: 3, tokenChange: -1000 }), W, 150);
  assert.equal(sell.side, 'SELL');
  assert.equal(parseSwap({ ...heliusTx({ sig: 'c', ts: 3, solChange: -1, tokenChange: 5 }), transactionError: 'x' }, W, 150), null);
});

test('Swap parser : wSOL compté comme SOL', () => {
  const tx = heliusTx({ sig: 'd', ts: 1, solChange: 0, tokenChange: 500 });
  tx.accountData[1].tokenBalanceChanges.push({ userAccount: W, mint: SOL_MINT, rawTokenAmount: { tokenAmount: String(-1e9), decimals: 9 } });
  assert.equal(parseSwap(tx, W, 100).side, 'BUY');
});

test('Stats wallet : win rate et P&L réalisé', () => {
  const swaps = [];
  for (let i = 0; i < 10; i++) {
    const win = i < 7;
    swaps.push({ timestamp: i * 10, side: 'BUY', mint: `m${i}`, tokenAmount: 100, amountUsd: 100 });
    swaps.push({ timestamp: i * 10 + 1, side: 'SELL', mint: `m${i}`, tokenAmount: 100, amountUsd: win ? 180 : 60 });
  }
  for (let i = 0; i < 12; i++) swaps.push({ timestamp: 200 + i, side: 'BUY', mint: 'hold', tokenAmount: 1, amountUsd: 10 });
  const s = computeWalletStats(swaps);
  assert.equal(s.closedPositions, 10);
  assert.equal(s.winRatePct, 70);
  assert.equal(s.trades, 32);
  assert.equal(Math.round(s.realizedPnlUsd), 7 * 80 - 3 * 40);
  assert.equal(qualifies(s, cfg.smartMoney.criteria).ok, true);
  assert.equal(qualifies({ ...s, winRatePct: 55 }, cfg.smartMoney.criteria).ok, false);
});

test('Cluster : 3 wallets en 30 min → signal, pas avant', () => {
  const c = new ClusterDetector(cfg.smartMoney.cluster);
  const t0 = NOW;
  assert.equal(c.addBuy({ wallet: 'A', mint: 'M', amountUsd: 200, timestamp: t0, signature: '1' }, t0), null);
  assert.equal(c.addBuy({ wallet: 'A', mint: 'M', amountUsd: 200, timestamp: t0 + 1, signature: '2' }, t0), null);
  assert.equal(c.addBuy({ wallet: 'B', mint: 'M', amountUsd: 200, timestamp: t0 + 60e3, signature: '3' }, t0 + 60e3), null);
  const r = c.addBuy({ wallet: 'C', mint: 'M', amountUsd: 200, timestamp: t0 + 20 * 60e3, signature: '4' }, t0 + 20 * 60e3);
  assert.equal(r.length, 3);
  // Hors fenêtre : A expire
  const c2 = new ClusterDetector(cfg.smartMoney.cluster);
  c2.addBuy({ wallet: 'A', mint: 'M', amountUsd: 200, timestamp: t0, signature: '1' }, t0);
  c2.addBuy({ wallet: 'B', mint: 'M', amountUsd: 200, timestamp: t0 + 10 * 60e3, signature: '2' }, t0 + 10 * 60e3);
  assert.equal(c2.addBuy({ wallet: 'C', mint: 'M', amountUsd: 200, timestamp: t0 + 35 * 60e3, signature: '3' }, t0 + 35 * 60e3), null);
});

test('Backtest : taux de réussite, moyennes, drawdown', () => {
  const mk = (pct, i) => ({ status: 'CLOSED', pnl_pct: String(pct), pnl_usd: String(pct), close_time: new Date(NOW + i * 1000).toISOString() });
  const s = computeStats([mk(50, 0), mk(-20, 1), mk(-20, 2), mk(30, 3)], 1000);
  assert.equal(s.winRatePct, 50);
  assert.equal(s.avgWinPct, 40);
  assert.equal(s.avgLossPct, -20);
  assert.equal(s.maxDrawdownUsd, 40);
  assert.ok(Math.abs(s.maxDrawdownPct - (40 / 1050) * 100) < 1e-9);
});

test('CSV : aller-retour avec virgules et guillemets', () => {
  const rows = [{ a: 'x, "y"', b: 'ligne\n2' }, { a: '1', b: '' }];
  assert.deepEqual(parseCsv(toCsv(['a', 'b'], rows)), rows);
});

test('Normalisation DexScreener et GeckoTerminal', () => {
  const d = fromDexScreenerPair({
    chainId: 'base', dexId: 'uniswap', pairAddress: '0xp', baseToken: { address: '0xt', symbol: 'T', name: 'Tok' },
    priceUsd: '0.5', liquidity: { usd: 25000 }, volume: { m5: 100, h1: 1200 }, txns: { m5: { buys: 3, sells: 1 } }, priceChange: { m5: 1.5 }, pairCreatedAt: 1,
  });
  assert.equal(d.priceUsd, 0.5);
  assert.equal(d.txns.h1.buys, 0);
  const g = fromGeckoPool({
    attributes: { name: 'ABC / SOL', address: 'Pool1', base_token_price_usd: '0.01', reserve_in_usd: '30000', pool_created_at: '2026-11-20T10:00:00Z',
      volume_usd: { m5: '500', h1: '3000' }, transactions: { m5: { buys: 10, sells: 2 }, h1: { buys: 50, sells: 20 } }, price_change_percentage: { m5: '4', h1: '20' } },
    relationships: { base_token: { data: { id: 'solana_MintABC' } }, dex: { data: { id: 'raydium' } } },
  }, 'solana');
  assert.equal(g.tokenAddress, 'MintABC');
  assert.equal(g.symbol, 'ABC');
  assert.equal(g.priceChange.h1, 20);
});
