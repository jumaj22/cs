// GoPlus Security API — https://docs.gopluslabs.io/
// EVM : /api/v1/token_security/{chainId}   Solana : /api/v1/solana/token_security
import { fetchJson } from '../utils/http.js';
import { env } from '../config.js';
import { num } from '../utils/format.js';

const BASE = 'https://api.gopluslabs.io/api/v1';
export const EVM_CHAIN_IDS = { base: 8453 };
const DEAD = /^0x0{40}$|^0x0{24}dead$|dead$|^0x000000000000000000000000000000000000dead$/i;
const BURN_TAG = /burn|dead|lock|unicrypt|team\.finance|pinklock|uncx|raydium|pump|meteora|orca|amm|pool|pair/i;

function headers() {
  return env.goplusToken ? { Authorization: env.goplusToken } : {};
}

const flag = (v) => (v === undefined || v === null || v === '' ? null : String(v) === '1');

/** Les pourcentages GoPlus sont tantôt des fractions (0.12), tantôt des % (12). */
function toPctList(values) {
  const nums = values.map(num).filter((v) => v !== null);
  const total = nums.reduce((a, b) => a + b, 0);
  const factor = total <= 1.5 ? 100 : 1;
  return values.map((v) => (num(v) ?? 0) * factor);
}

function top10(holders, excluded) {
  if (!Array.isArray(holders) || !holders.length) return null;
  const pcts = toPctList(holders.map((h) => h.percent));
  const rows = holders
    .map((h, i) => ({ ...h, pct: pcts[i] }))
    .filter((h) => {
      const addr = String(h.address || h.account || '').toLowerCase();
      if (excluded.has(addr)) return false;
      if (String(h.is_locked) === '1') return false;
      if (DEAD.test(addr)) return false;
      if (h.tag && BURN_TAG.test(h.tag)) return false;
      return true;
    })
    .sort((a, b) => b.pct - a.pct);
  return rows.slice(0, 10).reduce((a, h) => a + h.pct, 0);
}

function lpLocked(lpHolders) {
  if (!Array.isArray(lpHolders) || !lpHolders.length) return null;
  const pcts = toPctList(lpHolders.map((h) => h.percent));
  let locked = 0;
  lpHolders.forEach((h, i) => {
    const addr = String(h.address || h.account || '');
    if (String(h.is_locked) === '1' || DEAD.test(addr) || (h.tag && /burn|dead|lock/i.test(h.tag))) locked += pcts[i];
  });
  return Math.min(100, locked);
}

export async function evmSecurity(chain, address, pairAddress) {
  const id = EVM_CHAIN_IDS[chain];
  const r = await fetchJson(`${BASE}/token_security/${id}?contract_addresses=${address}`, { headers: headers(), label: 'GoPlus EVM' });
  if (r?.code !== 1 && r?.code !== undefined) throw new Error(`GoPlus : ${r?.message || 'réponse invalide'}`);
  const d = r?.result?.[address.toLowerCase()] || r?.result?.[address];
  if (!d) return null;
  const ownerAddr = String(d.owner_address || '').toLowerCase();
  const renounced = (!ownerAddr || DEAD.test(ownerAddr)) && !flag(d.hidden_owner) && !flag(d.can_take_back_ownership);
  const excluded = new Set([String(pairAddress || '').toLowerCase(), ...(d.lp_holders || []).map((h) => String(h.address).toLowerCase())]);
  // Pools V3/CL sans token LP → on cherche les paires listées par GoPlus
  for (const dx of d.dex || []) if (dx.pair) excluded.add(String(dx.pair).toLowerCase());
  return {
    source: 'GoPlus',
    isHoneypot: flag(d.is_honeypot) || flag(d.cannot_sell_all) ? true : flag(d.is_honeypot),
    buyTaxPct: num(d.buy_tax) !== null ? num(d.buy_tax) * 100 : null,
    sellTaxPct: num(d.sell_tax) !== null ? num(d.sell_tax) * 100 : null,
    mintable: flag(d.is_mintable) === null ? null : (flag(d.is_mintable) && !renounced) || flag(d.owner_change_balance) === true,
    blacklist:
      flag(d.is_blacklisted) === null && flag(d.transfer_pausable) === null
        ? null
        : ((flag(d.is_blacklisted) || flag(d.transfer_pausable)) && !renounced) || false,
    verified: flag(d.is_open_source),
    lpLockedPct: lpLocked(d.lp_holders),
    top10HolderPct: top10(d.holders, excluded),
    notes: [renounced ? 'ownership renoncée' : 'owner actif', flag(d.is_proxy) ? 'contrat proxy' : null].filter(Boolean),
  };
}

export async function solanaSecurity(mint, pairAddress) {
  const r = await fetchJson(`${BASE}/solana/token_security?contract_addresses=${mint}`, { headers: headers(), label: 'GoPlus Solana' });
  if (r?.code !== 1 && r?.code !== undefined) throw new Error(`GoPlus : ${r?.message || 'réponse invalide'}`);
  const d = r?.result?.[mint] || r?.result?.[mint.toLowerCase()];
  if (!d) return null;
  const st = (o) => (o && o.status !== undefined ? String(o.status) === '1' : null);
  const hooks = Array.isArray(d.transfer_hook) ? d.transfer_hook.length > 0 : !!(d.transfer_hook && Object.keys(d.transfer_hook).length);
  const nonTransferable = String(d.non_transferable) === '1';
  // Frais de transfert Token-2022 (= taxe à la vente)
  let feePct = 0;
  const tf = d.transfer_fee || {};
  const rate = num(tf.fee_rate ?? tf.current_fee_rate ?? tf.transfer_fee_basis_points);
  if (rate !== null) feePct = rate > 100 || 'transfer_fee_basis_points' in tf ? rate / 100 : rate <= 1 ? rate * 100 : rate;
  // LP : lp_holders si présent, sinon burn_percent des DEX
  let lp = lpLocked(d.lp_holders);
  if (lp === null && Array.isArray(d.dex) && d.dex.length) {
    const burns = d.dex.map((x) => num(x.burn_percent)).filter((v) => v !== null);
    if (burns.length) lp = Math.max(...burns.map((b) => (b <= 1 ? b * 100 : b)));
  }
  return {
    source: 'GoPlus',
    isHoneypot: nonTransferable || hooks ? true : false,
    buyTaxPct: feePct,
    sellTaxPct: feePct,
    mintable: st(d.mintable) === true || st(d.balance_mutable_authority) === true ? true : st(d.mintable),
    blacklist: st(d.freezable),
    verified: d.metadata_mutable ? !st(d.metadata_mutable) : null,
    lpLockedPct: lp,
    top10HolderPct: top10(d.holders, new Set([String(pairAddress || '').toLowerCase()])),
    notes: [hooks ? 'transfer hook présent' : null, nonTransferable ? 'non transférable' : null].filter(Boolean),
  };
}
