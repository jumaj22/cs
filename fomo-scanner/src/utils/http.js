// Client HTTP JSON avec : timeout, retries à backoff exponentiel + jitter,
// respect de l'en-tête Retry-After (429), et espacement minimal par hôte
// pour rester sous les limites de chaque API.
// Les URLs (qui peuvent contenir des clés API) ne sont JAMAIS écrites dans les logs.
import { logger } from './logger.js';
import { sleep } from './sleep.js';

const log = logger.child('http');
let cfg = {
  timeoutMs: 15000,
  maxRetries: 4,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000,
  defaultMinIntervalMs: 200,
  minIntervalMsByHost: {},
};
const hosts = new Map();

export function configureHttp(httpConfig = {}) {
  cfg = { ...cfg, ...httpConfig, minIntervalMsByHost: { ...cfg.minIntervalMsByHost, ...(httpConfig.minIntervalMsByHost || {}) } };
}

export class HttpError extends Error {
  constructor(message, { status = 0, body = '', retryable = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** File d'attente par hôte : garantit un intervalle minimal entre deux requêtes. */
function throttle(host) {
  const minInterval = cfg.minIntervalMsByHost[host] ?? cfg.defaultMinIntervalMs ?? 0;
  let st = hosts.get(host);
  if (!st) {
    st = { tail: Promise.resolve(), last: 0, pausedUntil: 0 };
    hosts.set(host, st);
  }
  const p = st.tail.then(async () => {
    const wait = Math.max(st.last + minInterval, st.pausedUntil) - Date.now();
    if (wait > 0) await sleep(wait);
    st.last = Date.now();
  });
  st.tail = p.catch(() => {});
  return p;
}

/** Met un hôte en pause (ex : après un 429) pour toutes les requêtes suivantes. */
function pauseHost(host, ms) {
  const st = hosts.get(host);
  if (st) st.pausedUntil = Math.max(st.pausedUntil, Date.now() + ms);
}

function safeLabel(url) {
  const u = new URL(url);
  return `${u.host}${u.pathname.length > 60 ? u.pathname.slice(0, 60) + '…' : u.pathname}`;
}

function parseRetryAfter(res) {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null;
}

/**
 * Requête JSON robuste.
 * @param {string} url
 * @param {object} opts { method, headers, body, retries, timeoutMs, label, quiet }
 */
export async function fetchJson(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeoutMs, label, quiet = false } = opts;
  const maxRetries = opts.retries ?? cfg.maxRetries;
  const host = new URL(url).host;
  const name = label || safeLabel(url);

  for (let attempt = 0; ; attempt++) {
    await throttle(host);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? cfg.timeoutMs);
    let err;
    try {
      const res = await fetch(url, {
        method,
        headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.ok) {
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch {
          throw new HttpError(`${name} : réponse non-JSON`, { status: res.status, body: text.slice(0, 200) });
        }
      }
      const retryAfterMs = res.status === 429 ? parseRetryAfter(res) ?? null : null;
      err = new HttpError(`${name} : HTTP ${res.status}`, {
        status: res.status,
        body: text.slice(0, 500),
        retryable: res.status === 429 || res.status === 408 || res.status >= 500,
        retryAfterMs,
      });
    } catch (e) {
      if (e instanceof HttpError) err = e;
      else {
        const reason = e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message;
        err = new HttpError(`${name} : erreur réseau (${reason})`, { retryable: true });
      }
    } finally {
      clearTimeout(timer);
    }

    if (!err.retryable || attempt >= maxRetries) throw err;
    const backoff = err.retryAfterMs ?? Math.min(cfg.maxBackoffMs, cfg.baseBackoffMs * 2 ** attempt) + Math.random() * 500;
    if (err.status === 429) pauseHost(host, backoff);
    if (!quiet) log.warn(`${err.message} — nouvelle tentative ${attempt + 1}/${maxRetries} dans ${(backoff / 1000).toFixed(1)} s`);
    await sleep(backoff);
  }
}
