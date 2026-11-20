// Birdeye (optionnel, clé requise) : tokens tendance et "top traders" par token.
// Doc : https://docs.birdeye.so/
import { fetchJson } from '../utils/http.js';
import { env } from '../config.js';

const BASE = 'https://public-api.birdeye.so';
const h = (chain) => ({ 'X-API-KEY': env.birdeyeKey, 'x-chain': chain });

export const birdeyeAvailable = () => !!env.birdeyeKey;

export async function trendingTokens(chain, limit = 10) {
  const r = await fetchJson(`${BASE}/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=${limit}`, { headers: h(chain), label: 'Birdeye trending' });
  return (r?.data?.tokens || r?.data?.items || []).map((t) => t.address).filter(Boolean);
}

export async function topTraders(chain, tokenAddress, limit = 10) {
  const qs = new URLSearchParams({ address: tokenAddress, time_frame: '24h', sort_type: 'desc', sort_by: 'volume', offset: '0', limit: String(limit) });
  const r = await fetchJson(`${BASE}/defi/v2/tokens/top_traders?${qs}`, { headers: h(chain), label: 'Birdeye top traders' });
  return (r?.data?.items || []).map((i) => i.owner).filter(Boolean);
}
