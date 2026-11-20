// Surveillance temps réel des wallets smart money.
// - mode "polling" : getSignaturesForAddress toutes les N s (RPC public par défaut = gratuit),
//   puis parsing des nouvelles signatures via Helius (1 appel groupé par cycle).
// - mode "webhook" : Helius pousse les swaps vers notre serveur HTTP (le plus économe en crédits).
import http from 'node:http';
import * as helius from './helius.js';
import { parseSwap } from './swapParser.js';
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';

const log = logger.child('surveillance');
const MAX_EVENT_AGE_MS = 10 * 60e3;

export class WalletMonitor {
  constructor(cfg, walletList, market, onSwap) {
    this.cfg = cfg.smartMoney;
    this.walletList = walletList;
    this.market = market;
    this.onSwap = onSwap;
    this.lastSig = new Map();
    this.seen = new Set();
    this.stopped = false;
  }

  async start() {
    const m = this.cfg.monitor;
    if (m.mode === 'webhook') {
      if (!env.publicWebhookUrl) {
        log.warn('Mode webhook demandé mais PUBLIC_WEBHOOK_URL absent de .env → bascule en polling.');
      } else {
        await this.startWebhook();
        return;
      }
    }
    this.pollLoop();
  }

  stop() {
    this.stopped = true;
    this.server?.close();
  }

  rpcUrl() {
    return this.cfg.monitor.signatureRpc === 'helius' ? helius.heliusRpcUrl() : this.cfg.monitor.publicRpcUrl;
  }

  async pollLoop() {
    log.info(`Polling des wallets toutes les ${this.cfg.monitor.pollIntervalSec} s (RPC ${this.cfg.monitor.signatureRpc})`);
    while (!this.stopped) {
      const t0 = Date.now();
      try {
        await this.pollOnce();
      } catch (e) {
        log.error(`Cycle de polling en échec : ${e.message}`);
      }
      await sleep(this.cfg.monitor.pollIntervalSec * 1000 - (Date.now() - t0));
    }
  }

  async pollOnce() {
    const wallets = this.walletList.addresses();
    if (!wallets.length) return;
    const pending = new Map(); // signature -> Set(wallet)
    for (const w of wallets) {
      try {
        const last = this.lastSig.get(w);
        const sigs = await helius.rpc(this.rpcUrl(), 'getSignaturesForAddress', [w, { limit: 20, ...(last ? { until: last } : {}) }]);
        if (!sigs?.length) continue;
        this.lastSig.set(w, sigs[0].signature);
        if (!last) continue; // premier passage : on mémorise seulement le point de départ
        for (const s of sigs) {
          if (s.err || (s.blockTime && Date.now() - s.blockTime * 1000 > MAX_EVENT_AGE_MS)) continue;
          if (!pending.has(s.signature)) pending.set(s.signature, new Set());
          pending.get(s.signature).add(w);
        }
      } catch (e) {
        log.debug(`Signatures KO pour ${w.slice(0, 6)} : ${e.message}`);
      }
    }
    if (!pending.size) return;
    const txs = await helius.parseTransactions([...pending.keys()]);
    await this.handleTxs(txs, (tx) => [...(pending.get(tx.signature) || [])]);
  }

  async handleTxs(txs, walletsOf) {
    const solPrice = await this.market.getSolPriceUsd(this.cfg.fallbackSolPriceUsd);
    for (const tx of txs) {
      for (const w of walletsOf(tx)) {
        const key = `${tx.signature}:${w}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        const swap = parseSwap(tx, w, solPrice);
        if (swap) {
          try {
            await this.onSwap(swap);
          } catch (e) {
            log.error(`Traitement du swap ${tx.signature?.slice(0, 8)} : ${e.message}`);
          }
        }
      }
    }
    if (this.seen.size > 20000) this.seen = new Set([...this.seen].slice(-5000));
  }

  async syncWebhook() {
    const addresses = this.walletList.addresses();
    if (!addresses.length) return;
    try {
      await helius.upsertWebhook({ url: env.publicWebhookUrl, addresses, authHeader: env.heliusWebhookAuth || undefined });
      log.success(`Webhook Helius synchronisé (${addresses.length} wallets)`);
    } catch (e) {
      log.error(`Synchronisation du webhook Helius impossible : ${e.message}`);
    }
  }

  async startWebhook() {
    const { webhookPort, webhookPath } = this.cfg.monitor;
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url.startsWith(webhookPath)) {
        res.writeHead(404).end();
        return;
      }
      if (env.heliusWebhookAuth && req.headers.authorization !== env.heliusWebhookAuth) {
        res.writeHead(401).end();
        return;
      }
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 5e6) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        res.writeHead(200).end('ok');
        let txs;
        try {
          txs = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return;
        }
        const tracked = new Set(this.walletList.addresses());
        const walletsOf = (tx) => {
          const s = new Set();
          if (tracked.has(tx.feePayer)) s.add(tx.feePayer);
          for (const a of tx.accountData || []) if (tracked.has(a.account)) s.add(a.account);
          return [...s];
        };
        this.handleTxs(Array.isArray(txs) ? txs : [txs], walletsOf).catch((e) => log.error(e.message));
      });
    });
    this.server.listen(webhookPort, () => log.info(`Serveur webhook en écoute sur :${webhookPort}${webhookPath}`));
    this.walletList.onChange(() => this.syncWebhook());
    await this.syncWebhook();
  }
}
