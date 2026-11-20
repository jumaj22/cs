// API publique GeckoTerminal (sans clé, ~30 req/min). Doc : https://www.geckoterminal.com/dex-api
import { fetchJson } from '../utils/http.js';
import { fromGeckoPool } from './normalize.js';

const BASE = 'https://api.geckoterminal.com/api/v2';
const NET = { solana: 'solana', base: 'base' };
const headers = { accept: 'application/json;version=20230302' };

export async function newPools(chain, page = 1) {
  const r = await fetchJson(`${BASE}/networks/${NET[chain]}/new_pools?page=${page}`, { headers, label: `Gecko new_pools ${chain}` });
  return (r?.data || []).map((p) => fromGeckoPool(p, chain));
}

export async function trendingPools(chain) {
  const r = await fetchJson(`${BASE}/networks/${NET[chain]}/trending_pools?page=1&duration=1h`, { headers, label: `Gecko trending ${chain}` });
  return (r?.data || []).map((p) => fromGeckoPool(p, chain));
}

/** Secours : données de pools connus (lots de 30). */
export async function getPools(chain, poolAddresses) {
  const out = [];
  for (let i = 0; i < poolAddresses.length; i += 30) {
    const batch = poolAddresses.slice(i, i + 30);
    const r = await fetchJson(`${BASE}/networks/${NET[chain]}/pools/multi/${batch.join(',')}`, { headers, label: `Gecko pools ${chain}` });
    out.push(...(r?.data || []).map((p) => fromGeckoPool(p, chain)));
  }
  return out;
}

export async function tokenPriceUsd(chain, address) {
  const r = await fetchJson(`${BASE}/simple/networks/${NET[chain]}/token_price/${address}`, { headers, label: 'Gecko prix' });
  const prices = r?.data?.attributes?.token_prices || {};
  const v = prices[address] ?? prices[address.toLowerCase()];
  return v ? Number(v) : null;
}
