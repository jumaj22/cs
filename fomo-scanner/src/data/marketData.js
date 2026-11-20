// Agrégation des sources de marché : DexScreener en principal, GeckoTerminal en secours.
// Maintient une "watchlist" de paires récentes pour les réévaluer à chaque scan
// (un token découvert à 3 min d'âge ne passe pas le filtre d'âge, mais peut devenir FOMO plus tard).
import * as dex from './dexscreener.js';
import * as gecko from './geckoterminal.js';
import { logger } from '../utils/logger.js';

const log = logger.child('données');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

export class MarketData {
  constructor(cfg) {
    this.cfg = cfg;
    this.watch = new Map(); // key chain:addr -> { chain, tokenAddress, pairAddress, firstSeen, lastSnapshot }
    this.solPrice = { value: null, at: 0 };
  }

  key(chain, addr) {
    return `${chain}:${addr}`;
  }

  addToWatch(chain, tokenAddress, pairAddress = null) {
    if (!tokenAddress || !this.cfg.chains.includes(chain)) return;
    const k = this.key(chain, tokenAddress);
    const cur = this.watch.get(k);
    if (cur) {
      if (pairAddress && !cur.pairAddress) cur.pairAddress = pairAddress;
      return;
    }
    this.watch.set(k, { chain, tokenAddress, pairAddress, firstSeen: Date.now(), lastSnapshot: null });
  }

  /** Découverte de nouvelles paires (toutes les sources, erreurs tolérées individuellement). */
  async discover() {
    const d = this.cfg.data;
    const tasks = [];
    if (d.useDexScreenerProfiles) tasks.push(['DexScreener profils', () => dex.latestTokenProfiles()]);
    if (d.useDexScreenerBoosts) tasks.push(['DexScreener boosts', () => dex.latestBoosts()]);
    for (const chain of this.cfg.chains) {
      if (d.useGeckoNewPools) tasks.push([`Gecko new_pools ${chain}`, () => gecko.newPools(chain)]);
      if (d.useGeckoTrendingPools) tasks.push([`Gecko trending ${chain}`, () => gecko.trendingPools(chain)]);
    }
    const geckoSnapshots = [];
    let found = 0;
    let failures = 0;
    for (const [name, fn] of tasks) {
      try {
        const items = await fn();
        for (const it of items) {
          if (!this.cfg.chains.includes(it.chain)) continue;
          this.addToWatch(it.chain, it.tokenAddress, it.pairAddress);
          if (it.source === 'geckoterminal') geckoSnapshots.push(it);
          found++;
        }
      } catch (e) {
        failures++;
        log.warn(`${name} indisponible : ${e.message}`);
      }
    }
    if (failures === tasks.length && tasks.length) log.error('Toutes les sources de découverte ont échoué ce cycle.');
    log.debug(`Découverte : ${found} éléments, watchlist = ${this.watch.size}`);
    return geckoSnapshots;
  }

  prune() {
    const now = Date.now();
    const ttl = this.cfg.data.watchlistHours * 3600e3;
    const maxAge = this.cfg.data.maxPairAgeHours * 3600e3;
    for (const [k, w] of this.watch) {
      const created = w.lastSnapshot?.pairCreatedAt;
      if (now - w.firstSeen > ttl || (created && now - created > maxAge)) this.watch.delete(k);
    }
    // Taille max : on garde les plus récents
    if (this.watch.size > this.cfg.data.maxWatchlistSize) {
      const sorted = [...this.watch.entries()].sort((a, b) => b[1].firstSeen - a[1].firstSeen);
      this.watch = new Map(sorted.slice(0, this.cfg.data.maxWatchlistSize));
    }
  }

  /**
   * Récupère les snapshots à jour de toute la watchlist.
   * DexScreener d'abord ; si une chaîne échoue, GeckoTerminal en secours.
   */
  async scanSnapshots() {
    const geckoFresh = await this.discover();
    this.prune();
    const byChain = new Map();
    for (const w of this.watch.values()) {
      if (!byChain.has(w.chain)) byChain.set(w.chain, []);
      byChain.get(w.chain).push(w);
    }
    const results = [];
    for (const [chain, items] of byChain) {
      let snaps;
      try {
        const m = await dex.getTokens(chain, items.map((w) => w.tokenAddress));
        snaps = [...m.values()];
      } catch (e) {
        log.warn(`DexScreener KO pour ${chain} (${e.message}) → secours GeckoTerminal`);
        snaps = await this.geckoFallback(chain, items, geckoFresh);
      }
      for (const s of snaps) {
        const w = this.watch.get(this.key(chain, s.tokenAddress));
        if (w) {
          w.lastSnapshot = s;
          w.pairAddress = w.pairAddress || s.pairAddress;
        }
        results.push(s);
      }
    }
    const maxAge = this.cfg.data.maxPairAgeHours * 3600e3;
    return results.filter((s) => !s.pairCreatedAt || Date.now() - s.pairCreatedAt <= maxAge);
  }

  async geckoFallback(chain, items, geckoFresh) {
    const fresh = new Map(geckoFresh.filter((s) => s.chain === chain).map((s) => [s.pairAddress, s]));
    const missing = items.filter((w) => w.pairAddress && !fresh.has(w.pairAddress)).map((w) => w.pairAddress);
    try {
      for (const s of await gecko.getPools(chain, missing.slice(0, 90))) fresh.set(s.pairAddress, s);
    } catch (e) {
      log.error(`GeckoTerminal aussi indisponible pour ${chain} : ${e.message}`);
    }
    return [...fresh.values()];
  }

  /** Prix actuels de positions ouvertes : [{chain, tokenAddress}] → Map(addr -> snapshot) */
  async currentSnapshots(list) {
    const out = new Map();
    const byChain = new Map();
    for (const p of list) {
      if (!byChain.has(p.chain)) byChain.set(p.chain, []);
      byChain.get(p.chain).push(p);
    }
    for (const [chain, items] of byChain) {
      try {
        const m = await dex.getTokens(chain, [...new Set(items.map((i) => i.tokenAddress))]);
        for (const [a, s] of m) out.set(a, s);
      } catch (e) {
        log.warn(`Prix DexScreener KO (${e.message}) → secours GeckoTerminal`);
        const pools = items.map((i) => i.pairAddress).filter(Boolean);
        try {
          for (const s of await gecko.getPools(chain, pools)) out.set(s.tokenAddress, s);
        } catch (e2) {
          log.error(`Prix indisponibles pour ${chain} : ${e2.message}`);
        }
      }
    }
    return out;
  }

  async getSnapshot(chain, tokenAddress) {
    try {
      return await dex.getToken(chain, tokenAddress);
    } catch (e) {
      log.warn(`DexScreener KO pour ${tokenAddress} : ${e.message}`);
      return null;
    }
  }

  /** Prix du SOL en USD (cache 5 min) — sert à valoriser les swaps des wallets. */
  async getSolPriceUsd(fallback = 150) {
    if (this.solPrice.value && Date.now() - this.solPrice.at < 5 * 60e3) return this.solPrice.value;
    let v = null;
    try {
      v = (await dex.getToken('solana', SOL_MINT))?.priceUsd ?? null;
    } catch { /* secours ci-dessous */ }
    if (!v) {
      try {
        v = await gecko.tokenPriceUsd('solana', SOL_MINT);
      } catch { /* ignore */ }
    }
    if (v) this.solPrice = { value: v, at: Date.now() };
    else if (!this.solPrice.value) log.warn(`Prix SOL indisponible, valeur de secours ${fallback} $`);
    return this.solPrice.value || fallback;
  }
}
