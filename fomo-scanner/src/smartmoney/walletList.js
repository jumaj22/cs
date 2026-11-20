// Liste de wallets "smart money" : construction, mise à jour quotidienne, persistance.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import * as helius from './helius.js';
import * as birdeye from './birdeye.js';
import { parseSwap } from './swapParser.js';
import { computeWalletStats, qualifies } from './walletStats.js';
import { writeFileAtomic } from '../utils/csv.js';
import { logger } from '../utils/logger.js';
import { shortAddr } from '../utils/format.js';

const log = logger.child('smart-money');
const FILE = path.join(ROOT, 'data', 'smart_wallets.json');

export class WalletList {
  constructor(cfg, market) {
    this.cfg = cfg;
    this.sm = cfg.smartMoney;
    this.market = market;
    this.wallets = new Map(); // address -> info
    this.updatedAt = 0;
    this.listeners = [];
    this.refreshing = false;
    this.winnerTokens = new Map(); // mint -> pairAddress (tokens qui ont fortement monté, vus par le scanner)
    this.load();
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  load() {
    try {
      if (!fs.existsSync(FILE)) return;
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      this.updatedAt = j.updatedAt || 0;
      for (const w of j.wallets || []) this.wallets.set(w.address, w);
      log.info(`${this.wallets.size} wallets smart money chargés (MAJ ${new Date(this.updatedAt).toLocaleString('fr-FR')})`);
    } catch (e) {
      log.warn(`smart_wallets.json illisible : ${e.message}`);
    }
  }

  save() {
    writeFileAtomic(FILE, JSON.stringify({ updatedAt: this.updatedAt, wallets: [...this.wallets.values()] }, null, 2));
  }

  get(address) {
    return this.wallets.get(address);
  }

  addresses() {
    return [...this.wallets.keys()];
  }

  isStale() {
    return !this.wallets.size || Date.now() - this.updatedAt > this.sm.refreshHours * 3600e3;
  }

  /** Le scanner signale les tokens Solana qui ont fortement monté : leurs traders sont des candidats. */
  noteWinner(token) {
    if (token.chain !== 'solana' || !token.pairAddress) return;
    this.winnerTokens.set(token.tokenAddress, token.pairAddress);
    if (this.winnerTokens.size > 50) this.winnerTokens.delete(this.winnerTokens.keys().next().value);
  }

  async gatherCandidates() {
    const src = this.sm.candidateSources;
    const set = new Set([...this.wallets.keys(), ...(src.seedWallets || [])]);
    const n = src.winnerTokensPerRefresh;

    if (src.birdeyeTopTraders && birdeye.birdeyeAvailable()) {
      try {
        const tokens = [...new Set([...(await birdeye.trendingTokens('solana', n)), ...[...this.winnerTokens.keys()].slice(-n)])].slice(0, n * 2);
        for (const t of tokens) {
          try {
            (await birdeye.topTraders('solana', t)).forEach((a) => set.add(a));
          } catch (e) {
            log.debug(`Birdeye top traders KO pour ${shortAddr(t)} : ${e.message}`);
          }
        }
      } catch (e) {
        log.warn(`Birdeye indisponible : ${e.message}`);
      }
    } else if (src.birdeyeTopTraders) {
      log.debug('BIRDEYE_API_KEY absente → source Birdeye ignorée');
    }

    if (src.heliusRecentTradersOfWinners) {
      for (const pair of [...this.winnerTokens.values()].slice(-n)) {
        try {
          const { txs } = await helius.addressSwaps(pair);
          txs.forEach((t) => t.feePayer && set.add(t.feePayer));
        } catch (e) {
          log.debug(`Helius traders KO : ${e.message}`);
        }
      }
    }
    // Les wallets déjà listés sont réévalués en priorité
    return [...set].slice(0, Math.max(this.sm.maxCandidatesPerRefresh, this.wallets.size));
  }

  async evaluate(address, solPrice) {
    const c = this.sm.criteria;
    const since = Date.now() - c.lookbackDays * 86400e3;
    const txs = await helius.swapHistory(address, { sinceMs: since, maxPages: this.sm.maxHistoryPagesPerWallet });
    const swaps = txs.map((t) => parseSwap(t, address, solPrice)).filter(Boolean);
    const stats = computeWalletStats(swaps);
    return { stats, verdict: qualifies(stats, c) };
  }

  /** Mise à jour complète (quotidienne). Retire les wallets qui ne passent plus les critères. */
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    const t0 = Date.now();
    try {
      log.info('Mise à jour de la liste smart money…');
      const solPrice = await this.market.getSolPriceUsd(this.sm.fallbackSolPriceUsd);
      const candidates = await this.gatherCandidates();
      if (!candidates.length) {
        log.warn('Aucun wallet candidat. Ajoute des adresses dans smartMoney.candidateSources.seedWallets, ou une clé Birdeye, ou laisse tourner le scanner (il collecte les tokens gagnants).');
      }
      const kept = [];
      let i = 0;
      for (const addr of candidates) {
        i++;
        try {
          const { stats, verdict } = await this.evaluate(addr, solPrice);
          if (verdict.ok) kept.push({ address: addr, chain: 'solana', ...stats, lastEvaluatedAt: Date.now() });
          else if (this.wallets.has(addr)) log.info(`Retrait de ${shortAddr(addr)} : ${verdict.why.join(', ')}`);
          log.debug(`[${i}/${candidates.length}] ${shortAddr(addr)} WR ${stats.winRatePct.toFixed(0)} % · ${stats.trades} trades · ${verdict.ok ? 'retenu' : 'rejeté'}`);
        } catch (e) {
          log.warn(`Évaluation de ${shortAddr(addr)} impossible : ${e.message}`);
          const old = this.wallets.get(addr);
          if (old) kept.push(old); // on ne retire pas un wallet à cause d'une erreur d'API
        }
      }
      kept.sort((a, b) => b.winRatePct - a.winRatePct || b.realizedPnlUsd - a.realizedPnlUsd);
      const before = new Set(this.wallets.keys());
      this.wallets = new Map(kept.slice(0, this.sm.maxWallets).map((w) => [w.address, w]));
      this.updatedAt = Date.now();
      this.save();
      const added = [...this.wallets.keys()].filter((a) => !before.has(a)).length;
      const removed = [...before].filter((a) => !this.wallets.has(a)).length;
      log.success(`Liste smart money : ${this.wallets.size} wallets (+${added} / -${removed}) en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      this.listeners.forEach((fn) => fn(this.addresses()));
    } catch (e) {
      log.error(`Mise à jour smart money échouée : ${e.message}`);
    } finally {
      this.refreshing = false;
    }
  }
}
