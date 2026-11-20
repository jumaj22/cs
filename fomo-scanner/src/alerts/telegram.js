// Envoi Telegram via l'API Bot (HTTP). File d'attente pour respecter ~1 msg/s par chat
// et gestion du 429 (retry_after). Si le bot n'est pas configuré, les alertes vont en console.
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { sleep } from '../utils/sleep.js';

const log = logger.child('telegram');

export class Telegram {
  constructor(cfg) {
    this.cfg = cfg;
    this.queue = [];
    this.running = false;
    this.enabled = cfg.enabled && !!env.telegramToken && !!env.telegramChatId;
    if (cfg.enabled && !this.enabled) {
      log.warn('TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant dans .env → alertes affichées en console seulement (voir README étape 3).');
    }
  }

  send(html) {
    if (!this.enabled) {
      log.info('(console) ' + html.replace(/<[^>]+>/g, ''));
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      this.queue.push({ html, resolve });
      this.pump();
    });
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const { html, resolve } = this.queue.shift();
      resolve(await this.deliver(html));
      await sleep(this.cfg.minIntervalMs);
    }
    this.running = false;
  }

  async deliver(html, attempt = 0) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: env.telegramChatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) return true;
      if (res.status === 429 && attempt < 5) {
        const wait = (body.parameters?.retry_after ?? 5) * 1000;
        log.warn(`Limite Telegram atteinte, pause ${wait / 1000} s`);
        await sleep(wait);
        return this.deliver(html, attempt + 1);
      }
      if (res.status >= 500 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return this.deliver(html, attempt + 1);
      }
      log.error(`Échec envoi Telegram (HTTP ${res.status}) : ${body.description || 'inconnu'}`);
      return false;
    } catch (e) {
      if (attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return this.deliver(html, attempt + 1);
      }
      log.error(`Telegram injoignable : ${e.message}`);
      return false;
    }
  }
}
