// Chargement de config.json + variables d'environnement (.env).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

export function loadConfig(file = process.env.FOMO_CONFIG || path.join(ROOT, 'config.json')) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`Fichier de configuration introuvable : ${file}`);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config.json invalide (JSON) : ${e.message}`);
  }
  validate(cfg);
  cfg.paper.csvFile = path.resolve(ROOT, cfg.paper.csvFile);
  return cfg;
}

function validate(cfg) {
  const req = ['chains', 'scanIntervalSec', 'data', 'fomo', 'antiScam', 'signals', 'smartMoney', 'paper', 'telegram', 'http'];
  const missing = req.filter((k) => cfg[k] === undefined);
  if (missing.length) throw new Error(`config.json : sections manquantes : ${missing.join(', ')}`);
  const supported = ['solana', 'base'];
  const bad = cfg.chains.filter((c) => !supported.includes(c));
  if (bad.length) throw new Error(`config.json : chaînes non supportées : ${bad.join(', ')} (supportées : ${supported.join(', ')})`);
  const { stopLossPct, takeProfitPct } = cfg.signals.exit;
  if (!(stopLossPct > 0 && stopLossPct < 100)) throw new Error('signals.exit.stopLossPct doit être entre 0 et 100');
  if (!(takeProfitPct > 0)) throw new Error('signals.exit.takeProfitPct doit être > 0');
  if (cfg.scanIntervalSec < 15) throw new Error('scanIntervalSec doit être ≥ 15 (limites des API)');
}

export const env = {
  get telegramToken() { return process.env.TELEGRAM_BOT_TOKEN?.trim() || ''; },
  get telegramChatId() { return process.env.TELEGRAM_CHAT_ID?.trim() || ''; },
  get heliusKey() { return process.env.HELIUS_API_KEY?.trim() || ''; },
  get birdeyeKey() { return process.env.BIRDEYE_API_KEY?.trim() || ''; },
  get goplusToken() { return process.env.GOPLUS_ACCESS_TOKEN?.trim() || ''; },
  get publicWebhookUrl() { return process.env.PUBLIC_WEBHOOK_URL?.trim() || ''; },
  get heliusWebhookAuth() { return process.env.HELIUS_WEBHOOK_AUTH?.trim() || ''; },
};
