// Point d'entrée : `npm start`. Lance le scanner FOMO, le suivi smart money,
// le gestionnaire de positions papier et les alertes Telegram.
// AUCUN ordre réel n'est passé, aucune clé privée n'est utilisée.
import { loadConfig, env } from './config.js';
import { configureHttp } from './utils/http.js';
import { logger, setLogLevel } from './utils/logger.js';
import { sleep } from './utils/sleep.js';
import { shortAddr, fmtPrice, fmtPct } from './utils/format.js';
import { MarketData } from './data/marketData.js';
import { evaluateFomo } from './analysis/fomo.js';
import { AntiScam } from './security/antiScam.js';
import { checkExit } from './signals/rules.js';
import { PaperTrader } from './paper/paperTrader.js';
import { Telegram } from './alerts/telegram.js';
import { entryMessage, exitMessage, smartSellMessage, startupMessage } from './alerts/messages.js';
import { WalletList } from './smartmoney/walletList.js';
import { WalletMonitor } from './smartmoney/monitor.js';
import { ClusterDetector } from './smartmoney/cluster.js';

const log = logger.child('main');

class App {
  constructor(cfg) {
    this.cfg = cfg;
    this.market = new MarketData(cfg);
    this.antiScam = new AntiScam(cfg.antiScam);
    this.paper = new PaperTrader(cfg);
    this.telegram = new Telegram(cfg.telegram);
    this.stopped = false;
    this.rejectLog = new Map(); // évite de répéter les mêmes rejets dans les logs
    this.smartEnabled = cfg.smartMoney.enabled && cfg.smartMoney.chains.includes('solana') && cfg.chains.includes('solana');
    if (cfg.smartMoney.enabled && !env.heliusKey) {
      log.warn('HELIUS_API_KEY absente → suivi smart money désactivé (voir README étape 4). Le scanner FOMO fonctionne quand même.');
      this.smartEnabled = false;
    }
    if (this.smartEnabled) {
      this.wallets = new WalletList(cfg, this.market);
      this.cluster = new ClusterDetector(cfg.smartMoney.cluster);
      this.monitor = new WalletMonitor(cfg, this.wallets, this.market, (s) => this.onSmartSwap(s));
    }
  }

  async start() {
    log.info('══════════ FOMO SCANNER — mode papier (aucun ordre réel) ══════════');
    log.info(`Chaînes : ${this.cfg.chains.join(', ')} · scan toutes les ${this.cfg.scanIntervalSec} s · smart money : ${this.smartEnabled ? 'actif' : 'inactif'}`);
    if (this.cfg.telegram.sendStartupMessage) {
      await this.telegram.send(
        startupMessage(this.cfg, {
          smartMoney: this.smartEnabled ? `actif (${this.wallets.addresses().length} wallets suivis)` : 'inactif',
          openTrades: this.paper.openTrades().length,
        }),
      );
    }
    if (this.smartEnabled) {
      if (this.wallets.isStale()) this.wallets.refresh(); // en tâche de fond, ne bloque pas le scanner
      setInterval(() => this.wallets.refresh(), this.cfg.smartMoney.refreshHours * 3600e3).unref();
      this.monitor.start();
    }
    this.positionsLoop();
    await this.scanLoop();
  }

  stop() {
    this.stopped = true;
    this.monitor?.stop();
    this.paper.save();
  }

  // ─────────────────────────── Scanner FOMO ───────────────────────────
  async scanLoop() {
    while (!this.stopped) {
      const t0 = Date.now();
      try {
        await this.scanOnce();
      } catch (e) {
        log.error(`Cycle de scan en échec : ${e.message}`);
      }
      await sleep(this.cfg.scanIntervalSec * 1000 - (Date.now() - t0));
    }
  }

  async scanOnce() {
    const snaps = await this.market.scanSnapshots();
    let fomoCount = 0;
    let tooLate = 0;
    for (const t of snaps) {
      if (!t.priceUsd) continue;
      const f = evaluateFomo(t, this.cfg.fomo);
      // Tokens qui ont beaucoup monté → leurs traders deviennent candidats smart money
      if (this.smartEnabled && t.priceChange.h1 >= 100 && (t.liquidityUsd ?? 0) >= this.cfg.fomo.minLiquidityUsd) this.wallets.noteWinner(t);
      if (f.tooLate) tooLate++;
      if (!f.pass) continue;
      fomoCount++;
      if (!this.cfg.signals.entry.enableFomo) continue;
      await this.tryEntry({ token: t, fomo: f, source: 'FOMO' });
    }
    log.info(`Scan : ${snaps.length} paires analysées · ${fomoCount} FOMO · ${tooLate} « trop tard » · ${this.paper.openTrades().length} positions ouvertes`);
  }

  // ─────────────────────────── Entrées ───────────────────────────
  canEnter(token) {
    const e = this.cfg.signals.entry;
    if (this.paper.findOpen(token.chain, token.tokenAddress)) return 'position déjà ouverte';
    const last = this.paper.lastEntryTime(token.chain, token.tokenAddress);
    if (last && Date.now() - last < e.cooldownMinutes * 60e3) return `cooldown ${e.cooldownMinutes} min`;
    if (this.paper.openTrades().length >= e.maxOpenPositions) return `max ${e.maxOpenPositions} positions ouvertes`;
    return null;
  }

  logRejectOnce(token, reasons) {
    const k = `${token.chain}:${token.tokenAddress}`;
    const msg = reasons.join(' ; ');
    if (this.rejectLog.get(k) === msg) return;
    this.rejectLog.set(k, msg);
    if (this.rejectLog.size > 2000) this.rejectLog.delete(this.rejectLog.keys().next().value);
    log.info(`✗ ${token.symbol} (${shortAddr(token.tokenAddress)}) rejeté : ${msg}`);
  }

  /**
   * @param source 'FOMO' | 'SMART_MONEY'
   * @param smartBuyers [{wallet, amountUsd}] pour un signal smart money
   */
  async tryEntry({ token, fomo, source, smartBuyers = [] }) {
    const block = this.canEnter(token);
    if (block) {
      log.debug(`${token.symbol} : entrée ignorée (${block})`);
      return;
    }
    const security = await this.antiScam.check(token);
    if (!security.pass) {
      this.logRejectOnce(token, security.reasons);
      return;
    }
    // Combinaison : un signal FOMO avec des achats smart money récents (ou l'inverse) devient FOMO+SMART_MONEY
    let buyers = smartBuyers;
    if (source === 'FOMO' && this.smartEnabled && token.chain === 'solana') buyers = this.cluster.buyersOf(token.tokenAddress);
    const fomoOk = fomo?.pass ?? evaluateFomo(token, this.cfg.fomo).pass;
    const smartOk = buyers.length >= this.cfg.smartMoney.cluster.minWallets;
    const signalType = fomoOk && smartOk ? 'FOMO+SMART_MONEY' : smartOk ? 'SMART_MONEY' : 'FOMO';

    const walletsInfo = buyers.map((b) => {
      const w = this.wallets?.get(b.wallet) || {};
      return { address: b.wallet, amountUsd: b.amountUsd, winRatePct: w.winRatePct, trades: w.trades };
    });
    const parts = [];
    if (smartOk) parts.push(`${buyers.length} wallets smart money ont acheté en < ${this.cfg.smartMoney.cluster.windowMinutes} min`);
    if (fomoOk) parts.push(`FOMO : ${(fomo || evaluateFomo(token, this.cfg.fomo)).summary}`);
    parts.push(`anti-arnaque OK${security.verified ? '' : ' (contrat non vérifié)'}`);
    const reason = parts.join(' · ');

    const trade = this.paper.open({ token, signalType, reason, verified: security.verified, smartWallets: buyers.map((b) => b.wallet) });
    log.signal(`ENTRÉE ${signalType} ${token.symbol} @ ${fmtPrice(trade.entry_price)} — ${reason}`);
    await this.telegram.send(entryMessage({ trade, token, signalType, reason, security, wallets: walletsInfo, fomo, exitCfg: this.cfg.signals.exit }));
  }

  // ─────────────────────────── Smart money ───────────────────────────
  async onSmartSwap(swap) {
    const w = this.wallets.get(swap.wallet);
    log.info(`👛 ${shortAddr(swap.wallet)} (WR ${w?.winRatePct?.toFixed(0) ?? '?'} %) ${swap.side === 'BUY' ? 'ACHÈTE' : 'VEND'} ${shortAddr(swap.mint)} ~${swap.amountUsd.toFixed(0)} $`);
    if (swap.side === 'BUY') {
      const cluster = this.cluster.addBuy(swap);
      if (!cluster || !this.cfg.signals.entry.enableSmartMoney) return;
      const token = await this.market.getSnapshot('solana', swap.mint);
      if (!token?.priceUsd) {
        log.warn(`Cluster smart money sur ${shortAddr(swap.mint)} mais aucune paire DexScreener trouvée`);
        return;
      }
      if ((token.liquidityUsd ?? 0) < this.cfg.smartMoney.minLiquidityUsd) {
        this.logRejectOnce(token, [`liquidité ${Math.round(token.liquidityUsd ?? 0)} $ < ${this.cfg.smartMoney.minLiquidityUsd} $`]);
        return;
      }
      this.cluster.resetSellers(swap.mint);
      await this.tryEntry({ token, source: 'SMART_MONEY', smartBuyers: cluster });
    } else {
      await this.onSmartSell(swap, w);
    }
  }

  async onSmartSell(swap, w) {
    const sellers = this.cluster.recordSell(swap);
    const open = this.paper.findOpen('solana', swap.mint);
    const recentBuyers = this.cluster.buyersOf(swap.mint).map((b) => b.wallet);
    const posBuyers = open?.smart_wallets ? open.smart_wallets.split(' ').filter(Boolean) : [];
    const buyers = posBuyers.length ? posBuyers : recentBuyers;
    const relevant = open || recentBuyers.includes(swap.wallet);
    if (!relevant) return;
    const sellersAmongBuyers = buyers.filter((b) => sellers.has(b)).length;

    if (this.cfg.telegram.sendSmartMoneySellAlerts) {
      await this.telegram.send(
        smartSellMessage({
          symbol: open?.symbol,
          mint: swap.mint,
          chain: 'solana',
          wallet: { address: swap.wallet, winRatePct: w?.winRatePct },
          amountUsd: swap.amountUsd,
          sellersCount: sellersAmongBuyers,
          buyersCount: buyers.length,
          url: open?.dexscreener_url || `https://dexscreener.com/solana/${swap.mint}`,
        }),
      );
    }
    // Clôture papier si assez de wallets acheteurs ont vendu
    const need = Math.min(this.cfg.signals.exit.smartMoneyExitMinSellers, Math.max(1, buyers.length));
    if (open && sellersAmongBuyers >= need) {
      const snap = await this.market.getSnapshot('solana', swap.mint);
      if (snap?.priceUsd) await this.closeTrade(open, snap.priceUsd, 'SMART_MONEY_SELL', `${sellersAmongBuyers} wallets smart money ont vendu`);
    }
  }

  // ─────────────────────────── Sorties ───────────────────────────
  async positionsLoop() {
    while (!this.stopped) {
      try {
        await this.checkPositions();
      } catch (e) {
        log.error(`Suivi des positions en échec : ${e.message}`);
      }
      await sleep(this.cfg.paper.priceCheckIntervalSec * 1000);
    }
  }

  async checkPositions() {
    const open = this.paper.openTrades();
    if (!open.length) return;
    const snaps = await this.market.currentSnapshots(open.map((t) => ({ chain: t.chain, tokenAddress: t.token_address, pairAddress: t.pair_address })));
    for (const t of open) {
      const s = snaps.get(t.token_address);
      if (!s?.priceUsd) continue;
      const pos = this.paper.asPosition(t);
      const exit = checkExit(pos, s.priceUsd, this.cfg.signals.exit);
      this.paper.updatePeak(t, pos.peakPrice);
      if (exit) await this.closeTrade(t, s.priceUsd, exit.reason, exit.label);
    }
  }

  async closeTrade(t, price, reason, label) {
    this.paper.close(t, price, reason);
    log.signal(`SORTIE ${t.symbol} — ${label} — P&L ${fmtPct(Number(t.pnl_pct))}`);
    if (this.cfg.telegram.sendExitAlerts) await this.telegram.send(exitMessage({ trade: t, label, price }));
  }
}

async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    log.error(e.message);
    process.exit(1);
  }
  if (process.env.LOG_LEVEL) setLogLevel(process.env.LOG_LEVEL);
  configureHttp(cfg.http);
  const app = new App(cfg);

  const shutdown = (sig) => {
    log.info(`${sig} reçu — arrêt propre (CSV sauvegardé).`);
    app.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => log.error(`Erreur non gérée : ${e?.message || e}`));
  process.on('uncaughtException', (e) => log.error(`Exception non gérée : ${e?.message || e}`));

  await app.start();
}

main();
