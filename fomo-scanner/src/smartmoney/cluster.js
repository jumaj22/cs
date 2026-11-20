// Détection de "clusters" : ≥ N wallets smart money distincts achètent le même token dans une fenêtre.
export class ClusterDetector {
  constructor({ minWallets, windowMinutes, minBuyUsdPerWallet }) {
    this.minWallets = minWallets;
    this.windowMs = windowMinutes * 60e3;
    this.minBuyUsd = minBuyUsdPerWallet;
    this.buys = new Map(); // mint -> [{wallet, timestamp, amountUsd}]
    this.sellers = new Map(); // mint -> Set(wallet)
  }

  prune(mint, now) {
    const list = (this.buys.get(mint) || []).filter((b) => now - b.timestamp <= this.windowMs);
    if (list.length) this.buys.set(mint, list);
    else this.buys.delete(mint);
    return list;
  }

  /** Enregistre un achat ; renvoie le cluster (agrégé par wallet) si le seuil est atteint. */
  addBuy(swap, now = Date.now()) {
    if (swap.amountUsd < this.minBuyUsd) return null;
    const list = this.prune(swap.mint, now);
    if (list.some((b) => b.signature === swap.signature)) return null;
    list.push({ wallet: swap.wallet, timestamp: swap.timestamp, amountUsd: swap.amountUsd, signature: swap.signature });
    this.buys.set(swap.mint, list);
    const byWallet = this.buyersOf(swap.mint, now);
    return byWallet.length >= this.minWallets ? byWallet : null;
  }

  buyersOf(mint, now = Date.now()) {
    const agg = new Map();
    for (const b of this.prune(mint, now)) agg.set(b.wallet, (agg.get(b.wallet) || 0) + b.amountUsd);
    return [...agg].map(([wallet, amountUsd]) => ({ wallet, amountUsd }));
  }

  recordSell(swap) {
    if (!this.sellers.has(swap.mint)) this.sellers.set(swap.mint, new Set());
    this.sellers.get(swap.mint).add(swap.wallet);
    return this.sellers.get(swap.mint);
  }

  resetSellers(mint) {
    this.sellers.delete(mint);
  }
}
