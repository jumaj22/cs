// Client Helius (Solana) : historique de swaps parsés, parsing de signatures, RPC, webhooks.
// Doc : https://docs.helius.dev/
import { fetchJson, HttpError } from '../utils/http.js';
import { env } from '../config.js';

const API = 'https://api.helius.xyz/v0';

function key() {
  if (!env.heliusKey) throw new Error('HELIUS_API_KEY manquante dans .env');
  return env.heliusKey;
}

/** Une page (≤100) de transactions SWAP parsées d'une adresse, de la plus récente à la plus ancienne. */
export async function addressSwaps(address, { before } = {}) {
  const qs = new URLSearchParams({ 'api-key': key(), type: 'SWAP', limit: '100' });
  if (before) qs.set('before', before);
  try {
    const r = await fetchJson(`${API}/addresses/${address}/transactions?${qs}`, { label: 'Helius historique' });
    return { txs: Array.isArray(r) ? r : [], next: null };
  } catch (e) {
    // Helius renvoie une erreur "continuez avec before=<sig>" quand la page filtrée est vide
    const m = e instanceof HttpError && /before[^A-Za-z0-9]+(?:parameter set to\s+)?([1-9A-HJ-NP-Za-km-z]{60,100})/.exec(e.body || '');
    if (m) return { txs: [], next: m[1] };
    throw e;
  }
}

/** Historique de swaps sur `sinceMs`, limité à maxPages pages. */
export async function swapHistory(address, { sinceMs, maxPages = 3 }) {
  const all = [];
  let before;
  for (let page = 0; page < maxPages; page++) {
    const { txs, next } = await addressSwaps(address, { before });
    if (next) {
      before = next;
      continue;
    }
    if (!txs.length) break;
    all.push(...txs);
    const oldest = txs[txs.length - 1];
    if (oldest.timestamp * 1000 < sinceMs || txs.length < 100) break;
    before = oldest.signature;
  }
  return all.filter((t) => t.timestamp * 1000 >= sinceMs);
}

/** Parse jusqu'à 100 signatures en transactions enrichies. */
export async function parseTransactions(signatures) {
  const out = [];
  for (let i = 0; i < signatures.length; i += 100) {
    const r = await fetchJson(`${API}/transactions?api-key=${key()}`, {
      method: 'POST',
      body: { transactions: signatures.slice(i, i + 100) },
      label: 'Helius parse',
    });
    if (Array.isArray(r)) out.push(...r);
  }
  return out;
}

/** Appel JSON-RPC Solana (Helius ou RPC public selon config). */
export async function rpc(url, method, params) {
  const r = await fetchJson(url, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method, params }, label: `RPC ${method}` });
  if (r?.error) throw new Error(`RPC ${method} : ${r.error.message}`);
  return r?.result;
}

export function heliusRpcUrl() {
  return `https://mainnet.helius-rpc.com/?api-key=${key()}`;
}

// ─── Webhooks ───
export async function listWebhooks() {
  return (await fetchJson(`${API}/webhooks?api-key=${key()}`, { label: 'Helius webhooks' })) || [];
}

export async function upsertWebhook({ url, addresses, authHeader }) {
  const body = { webhookURL: url, transactionTypes: ['SWAP'], accountAddresses: addresses, webhookType: 'enhanced', ...(authHeader ? { authHeader } : {}) };
  const existing = (await listWebhooks()).find((w) => w.webhookURL === url);
  if (existing) {
    return fetchJson(`${API}/webhooks/${existing.webhookID}?api-key=${key()}`, { method: 'PUT', body, label: 'Helius webhook update' });
  }
  return fetchJson(`${API}/webhooks?api-key=${key()}`, { method: 'POST', body, label: 'Helius webhook create' });
}
