// API publique DexScreener (sans clé). Doc : https://docs.dexscreener.com/api/reference
// Limites : 60 req/min (profils/boosts), 300 req/min (paires/tokens).
import { fetchJson } from '../utils/http.js';
import { fromDexScreenerPair, pickBestPair } from './normalize.js';

const BASE = 'https://api.dexscreener.com';

/** Derniers tokens ayant un profil / un boost : bonne source de lancements récents. */
export async function latestTokenProfiles() {
  const r = await fetchJson(`${BASE}/token-profiles/latest/v1`, { label: 'DexScreener profils' });
  return (Array.isArray(r) ? r : []).map((x) => ({ chain: x.chainId, tokenAddress: x.tokenAddress }));
}

export async function latestBoosts() {
  const r = await fetchJson(`${BASE}/token-boosts/latest/v1`, { label: 'DexScreener boosts' });
  return (Array.isArray(r) ? r : []).map((x) => ({ chain: x.chainId, tokenAddress: x.tokenAddress }));
}

/** Snapshots de jusqu'à N tokens d'une chaîne (lots de 30 adresses par appel). */
export async function getTokens(chain, addresses) {
  const out = new Map();
  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30);
    const pairs = await fetchJson(`${BASE}/tokens/v1/${chain}/${batch.join(',')}`, { label: `DexScreener tokens ${chain}` });
    const list = Array.isArray(pairs) ? pairs : pairs?.pairs || [];
    for (const addr of batch) {
      const mine = list.filter((p) => (p.baseToken?.address || '').toLowerCase() === addr.toLowerCase());
      const best = pickBestPair(mine, addr);
      if (best) out.set(addr, fromDexScreenerPair(best));
    }
  }
  return out;
}

export async function getToken(chain, address) {
  return (await getTokens(chain, [address])).get(address) || null;
}
