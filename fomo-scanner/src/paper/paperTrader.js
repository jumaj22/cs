// Mode papier : chaque signal d'ENTRÉE devient un trade simulé, enregistré dans un CSV.
// Une ligne par trade, mise à jour à la clôture. Aucun ordre réel n'est jamais envoyé.
import { toCsv, readCsvFile, writeFileAtomic } from '../utils/csv.js';
import { exitLevels } from '../signals/rules.js';
import { logger } from '../utils/logger.js';

const log = logger.child('papier');

export const COLUMNS = [
  'id', 'status', 'open_time', 'close_time', 'chain', 'symbol', 'token_address', 'pair_address',
  'signal_type', 'reason', 'verified', 'entry_price', 'exit_price', 'stop_loss', 'take_profit',
  'peak_price', 'size_usd', 'pnl_pct', 'pnl_usd', 'exit_reason', 'smart_wallets', 'dexscreener_url',
];

export class PaperTrader {
  constructor(cfg) {
    this.cfg = cfg;
    this.file = cfg.paper.csvFile;
    this.trades = [];
    this.load();
  }

  load() {
    try {
      this.trades = readCsvFile(this.file).map((r) => ({
        ...r,
        entry_price: Number(r.entry_price),
        stop_loss: Number(r.stop_loss),
        take_profit: Number(r.take_profit),
        peak_price: Number(r.peak_price) || Number(r.entry_price),
        size_usd: Number(r.size_usd),
      }));
      const open = this.openTrades().length;
      if (this.trades.length) log.info(`${this.trades.length} trades chargés depuis le CSV (${open} ouverts)`);
    } catch (e) {
      log.error(`Lecture du CSV impossible (${e.message}) — démarrage avec un historique vide`);
      this.trades = [];
    }
  }

  save() {
    try {
      writeFileAtomic(this.file, toCsv(COLUMNS, this.trades));
    } catch (e) {
      log.error(`Écriture du CSV impossible : ${e.message}`);
    }
  }

  openTrades() {
    return this.trades.filter((t) => t.status === 'OPEN');
  }

  findOpen(chain, tokenAddress) {
    return this.openTrades().find((t) => t.chain === chain && t.token_address === tokenAddress);
  }

  lastEntryTime(chain, tokenAddress) {
    const ts = this.trades.filter((t) => t.chain === chain && t.token_address === tokenAddress).map((t) => Date.parse(t.open_time));
    return ts.length ? Math.max(...ts) : 0;
  }

  /** Ouvre un trade simulé. Le prix d'entrée inclut un slippage simulé défavorable. */
  open({ token, signalType, reason, verified, smartWallets = [] }) {
    const slip = this.cfg.paper.simulatedSlippagePct / 100;
    const entry = token.priceUsd * (1 + slip);
    const lv = exitLevels(entry, this.cfg.signals.exit);
    const trade = {
      id: `${Date.now().toString(36)}-${token.symbol}`.replace(/[^\w-]/g, ''),
      status: 'OPEN',
      open_time: new Date().toISOString(),
      close_time: '',
      chain: token.chain,
      symbol: token.symbol,
      token_address: token.tokenAddress,
      pair_address: token.pairAddress || '',
      signal_type: signalType,
      reason,
      verified: verified ? 'oui' : 'non',
      entry_price: entry,
      exit_price: '',
      stop_loss: lv.stopLoss,
      take_profit: lv.takeProfit,
      peak_price: entry,
      size_usd: this.cfg.paper.positionSizeUsd,
      pnl_pct: '',
      pnl_usd: '',
      exit_reason: '',
      smart_wallets: smartWallets.join(' '),
      dexscreener_url: token.url,
    };
    this.trades.push(trade);
    this.save();
    return trade;
  }

  /** Vue "position" utilisée par les règles de sortie. */
  asPosition(t) {
    return {
      entryPrice: t.entry_price,
      stopLoss: t.stop_loss,
      takeProfit: t.take_profit,
      peakPrice: t.peak_price,
      openedAt: Date.parse(t.open_time),
    };
  }

  updatePeak(t, peak) {
    if (peak > t.peak_price) {
      t.peak_price = peak;
      this.save();
    }
  }

  close(t, price, exitReason) {
    const slip = this.cfg.paper.simulatedSlippagePct / 100;
    const exit = price * (1 - slip);
    const pnlPct = (exit / t.entry_price - 1) * 100;
    Object.assign(t, {
      status: 'CLOSED',
      close_time: new Date().toISOString(),
      exit_price: exit,
      pnl_pct: pnlPct.toFixed(2),
      pnl_usd: ((t.size_usd * pnlPct) / 100).toFixed(2),
      exit_reason: exitReason,
    });
    this.save();
    return t;
  }
}
