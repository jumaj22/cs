// Honeypot.is — simulation achat/vente réelle sur EVM (Base, ETH, BSC). Sans clé.
import { fetchJson } from '../utils/http.js';
import { num } from '../utils/format.js';

export async function honeypotIs(chainId, address) {
  const r = await fetchJson(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`, { label: 'Honeypot.is' });
  if (!r) return null;
  const simOk = r.simulationSuccess !== false;
  return {
    source: 'Honeypot.is',
    isHoneypot: simOk ? !!r.honeypotResult?.isHoneypot : r.honeypotResult?.isHoneypot === true ? true : null,
    buyTaxPct: simOk ? num(r.simulationResult?.buyTax) : null,
    sellTaxPct: simOk ? num(r.simulationResult?.sellTax) : null,
    mintable: null,
    blacklist: null,
    verified: r.contractCode ? !!r.contractCode.openSource : null,
    lpLockedPct: null,
    top10HolderPct: null,
    notes: [simOk ? null : 'simulation impossible', r.honeypotResult?.honeypotReason || null].filter(Boolean),
  };
}
