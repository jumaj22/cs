// Filtres anti-arnaque : combine GoPlus + Honeypot.is (EVM) / RugCheck (Solana)
// en prenant toujours la valeur la plus prudente.
import { evmSecurity, solanaSecurity, EVM_CHAIN_IDS } from './goplus.js';
import { honeypotIs } from './honeypotis.js';
import { rugcheck } from './rugcheck.js';
import { logger } from '../utils/logger.js';
import { fmtPct } from '../utils/format.js';

const log = logger.child('anti-arnaque');

/** Fusion conservatrice de plusieurs rapports normalisés. */
export function mergeReports(reports) {
  const list = reports.filter(Boolean);
  const anyTrue = (k) => (list.some((r) => r[k] === true) ? true : list.some((r) => r[k] === false) ? false : null);
  const vals = (k) => list.map((r) => r[k]).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const max = (k) => (vals(k).length ? Math.max(...vals(k)) : null);
  const min = (k) => (vals(k).length ? Math.min(...vals(k)) : null);
  return {
    sources: list.map((r) => r.source),
    isHoneypot: anyTrue('isHoneypot'),
    buyTaxPct: max('buyTaxPct'),
    sellTaxPct: max('sellTaxPct'),
    mintable: anyTrue('mintable'),
    blacklist: anyTrue('blacklist'),
    // "vérifié" : au moins une source confirme le code source / métadonnées figées
    verified: list.some((r) => r.verified === true) ? true : list.some((r) => r.verified === false) ? false : null,
    // LP verrouillée : on prend la meilleure mesure disponible parmi les sources qui la mesurent,
    // mais le top 10 prend la pire (le plus concentré)
    lpLockedPct: max('lpLockedPct'),
    top10HolderPct: max('top10HolderPct'),
    notes: list.flatMap((r) => r.notes || []),
  };
}

/** Règles pures (testables). */
export function assess(token, sec, cfg, now = Date.now()) {
  const reasons = [];
  const ageMin = token.pairCreatedAt ? (now - token.pairCreatedAt) / 60000 : null;
  if (ageMin === null) reasons.push('âge inconnu');
  else if (ageMin < cfg.minAgeMinutes) reasons.push(`trop récent (${ageMin.toFixed(0)} min < ${cfg.minAgeMinutes} min)`);

  if (!sec || !sec.sources?.length) {
    if (cfg.rejectOnSecurityApiFailure) reasons.push('API de sécurité indisponibles (rejet par prudence)');
    return { pass: reasons.length === 0, verified: false, reasons, sec: sec || null };
  }

  if (cfg.rejectHoneypot && sec.isHoneypot === true) reasons.push('HONEYPOT (vente impossible/bloquable)');
  if (sec.sellTaxPct !== null && sec.sellTaxPct > cfg.maxSellTaxPct) reasons.push(`taxe de vente ${fmtPct(sec.sellTaxPct)} > ${cfg.maxSellTaxPct} %`);
  if (sec.buyTaxPct !== null && sec.buyTaxPct > cfg.maxBuyTaxPct) reasons.push(`taxe d'achat ${fmtPct(sec.buyTaxPct)} > ${cfg.maxBuyTaxPct} %`);
  if (cfg.rejectMintable && sec.mintable === true) reasons.push('mint activable par le créateur');
  if (cfg.rejectBlacklist && sec.blacklist === true) reasons.push('blacklist/gel activable par le créateur');

  if (cfg.requireLiquidityLocked) {
    const programLocked = (cfg.programLockedDexIds || []).includes(token.dexId);
    const lp = programLocked ? 100 : sec.lpLockedPct;
    if (lp === null) {
      if (cfg.unknownLpLock === 'reject') reasons.push('verrouillage de liquidité inconnu');
    } else if (lp < cfg.minLpLockedPct) reasons.push(`liquidité verrouillée ${lp.toFixed(0)} % < ${cfg.minLpLockedPct} %`);
  }

  if (sec.top10HolderPct === null) {
    if (cfg.unknownTop10 === 'reject') reasons.push('répartition des holders inconnue');
  } else if (sec.top10HolderPct > cfg.maxTop10HolderPct) reasons.push(`top 10 holders ${sec.top10HolderPct.toFixed(1)} % > ${cfg.maxTop10HolderPct} %`);

  return { pass: reasons.length === 0, verified: sec.verified === true, reasons, sec };
}

export class AntiScam {
  constructor(cfg) {
    this.cfg = cfg;
    this.cache = new Map();
  }

  async fetchSecurity(token) {
    const k = `${token.chain}:${token.tokenAddress}`;
    const hit = this.cache.get(k);
    if (hit && Date.now() - hit.at < this.cfg.securityCacheMinutes * 60e3) return hit.sec;
    const jobs = [];
    if (token.chain === 'solana') {
      jobs.push(['GoPlus', () => solanaSecurity(token.tokenAddress, token.pairAddress)]);
      if (this.cfg.useRugCheckForSolana) jobs.push(['RugCheck', () => rugcheck(token.tokenAddress)]);
    } else {
      jobs.push(['GoPlus', () => evmSecurity(token.chain, token.tokenAddress, token.pairAddress)]);
      if (this.cfg.useHoneypotIsForEvm) jobs.push(['Honeypot.is', () => honeypotIs(EVM_CHAIN_IDS[token.chain], token.tokenAddress)]);
    }
    const reports = [];
    for (const [name, fn] of jobs) {
      try {
        reports.push(await fn());
      } catch (e) {
        log.warn(`${name} KO pour ${token.symbol} : ${e.message}`);
      }
    }
    const sec = mergeReports(reports);
    if (sec.sources.length) this.cache.set(k, { at: Date.now(), sec });
    return sec;
  }

  async check(token) {
    // Contrôle d'âge gratuit d'abord : évite des appels API inutiles
    const quick = assess(token, { sources: ['-'], top10HolderPct: 0, lpLockedPct: 100 }, { ...this.cfg, requireLiquidityLocked: false });
    if (!quick.pass) return { pass: false, verified: false, reasons: quick.reasons, sec: null };
    const sec = await this.fetchSecurity(token);
    return assess(token, sec, this.cfg);
  }
}
