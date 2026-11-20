// Format commun d'un "snapshot" de token, quelle que soit la source (DexScreener / GeckoTerminal).
// {
//   chain, tokenAddress, pairAddress, symbol, name, dexId, priceUsd, liquidityUsd, fdv,
//   pairCreatedAt (ms), volume:{m5,h1,h6,h24}, txns:{m5:{buys,sells},h1:{buys,sells},h24:{...}},
//   priceChange:{m5,h1,h6,h24}, url, source
// }
import { num } from '../utils/format.js';

const tx = (o) => ({ buys: num(o?.buys) ?? 0, sells: num(o?.sells) ?? 0 });

export function fromDexScreenerPair(p) {
  return {
    chain: p.chainId,
    tokenAddress: p.baseToken?.address,
    pairAddress: p.pairAddress,
    symbol: p.baseToken?.symbol || '?',
    name: p.baseToken?.name || '',
    quoteSymbol: p.quoteToken?.symbol || '',
    dexId: p.dexId || '',
    priceUsd: num(p.priceUsd),
    liquidityUsd: num(p.liquidity?.usd),
    fdv: num(p.fdv ?? p.marketCap),
    pairCreatedAt: num(p.pairCreatedAt),
    volume: { m5: num(p.volume?.m5) ?? 0, h1: num(p.volume?.h1) ?? 0, h6: num(p.volume?.h6) ?? 0, h24: num(p.volume?.h24) ?? 0 },
    txns: { m5: tx(p.txns?.m5), h1: tx(p.txns?.h1), h24: tx(p.txns?.h24) },
    priceChange: { m5: num(p.priceChange?.m5) ?? 0, h1: num(p.priceChange?.h1) ?? 0, h6: num(p.priceChange?.h6) ?? 0, h24: num(p.priceChange?.h24) ?? 0 },
    url: p.url || `https://dexscreener.com/${p.chainId}/${p.pairAddress}`,
    source: 'dexscreener',
  };
}

export function fromGeckoPool(pool, chain) {
  const a = pool.attributes || {};
  const baseId = pool.relationships?.base_token?.data?.id || '';
  const tokenAddress = baseId.includes('_') ? baseId.slice(baseId.indexOf('_') + 1) : baseId;
  const [symbol = '?', quote = ''] = String(a.name || '').split(' / ');
  return {
    chain,
    tokenAddress,
    pairAddress: a.address,
    symbol: symbol.trim(),
    name: symbol.trim(),
    quoteSymbol: quote.trim(),
    dexId: pool.relationships?.dex?.data?.id || '',
    priceUsd: num(a.base_token_price_usd),
    liquidityUsd: num(a.reserve_in_usd),
    fdv: num(a.fdv_usd ?? a.market_cap_usd),
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    volume: { m5: num(a.volume_usd?.m5) ?? 0, h1: num(a.volume_usd?.h1) ?? 0, h6: num(a.volume_usd?.h6) ?? 0, h24: num(a.volume_usd?.h24) ?? 0 },
    txns: { m5: tx(a.transactions?.m5), h1: tx(a.transactions?.h1), h24: tx(a.transactions?.h24) },
    priceChange: {
      m5: num(a.price_change_percentage?.m5) ?? 0,
      h1: num(a.price_change_percentage?.h1) ?? 0,
      h6: num(a.price_change_percentage?.h6) ?? 0,
      h24: num(a.price_change_percentage?.h24) ?? 0,
    },
    url: `https://dexscreener.com/${chain}/${a.address}`,
    source: 'geckoterminal',
  };
}

/** Choisit la paire la plus liquide où le token est le "base token". */
export function pickBestPair(pairs, tokenAddress) {
  const lc = tokenAddress.toLowerCase();
  const candidates = pairs.filter((p) => (p.baseToken?.address || '').toLowerCase() === lc);
  const list = candidates.length ? candidates : pairs;
  return list.sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0))[0] || null;
}
