// RugCheck (Solana) — complément public sans clé : verrouillage LP, top holders, autorités.
import { fetchJson } from '../utils/http.js';
import { num } from '../utils/format.js';

function collectStrings(obj, set, depth = 0) {
  if (!obj || depth > 2) return;
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.length >= 32) set.add(v);
    else if (v && typeof v === 'object') collectStrings(v, set, depth + 1);
  }
}

export async function rugcheck(mint) {
  const r = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { label: 'RugCheck' });
  if (!r) return null;
  const markets = Array.isArray(r.markets) ? r.markets : [];
  const poolAccounts = new Set();
  markets.forEach((m) => collectStrings(m, poolAccounts));
  const holders = (r.topHolders || []).filter((h) => !poolAccounts.has(h.address) && !poolAccounts.has(h.owner));
  const top10 = holders.length ? holders.slice(0, 10).reduce((a, h) => a + (num(h.pct) ?? 0), 0) : null;
  const locks = markets.map((m) => num(m.lp?.lpLockedPct)).filter((v) => v !== null);
  return {
    source: 'RugCheck',
    isHoneypot: r.rugged === true ? true : null,
    buyTaxPct: num(r.transferFee?.pct),
    sellTaxPct: num(r.transferFee?.pct),
    mintable: r.token ? !!r.token.mintAuthority : null,
    blacklist: r.token ? !!r.token.freezeAuthority : null,
    verified: r.tokenMeta ? r.tokenMeta.mutable === false : null,
    lpLockedPct: locks.length ? Math.max(...locks) : null,
    top10HolderPct: top10,
    notes: [],
  };
}
