// Formatage des nombres / adresses pour les logs et Telegram.
export function fmtUsd(n, digits) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/d';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} Md$`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)} M$`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)} k$`;
  return `${n.toFixed(digits ?? 2)} $`;
}

export function fmtPrice(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return 'n/d';
  if (p === 0) return '0 $';
  if (p >= 1) return `${p.toFixed(4)} $`;
  // Garde 4 chiffres significatifs pour les micro-prix
  return `${p.toPrecision(4)} $`;
}

export function fmtPct(n, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/d';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)} %`;
}

export function shortAddr(a) {
  if (!a) return '?';
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function minutesSince(ms, now = Date.now()) {
  return ms ? (now - ms) / 60000 : null;
}

export function fmtAge(ms, now = Date.now()) {
  const m = minutesSince(ms, now);
  if (m === null) return 'n/d';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 48 * 60) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} j`;
}

export const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
