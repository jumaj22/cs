#!/usr/bin/env node
// Vérifie la configuration et la joignabilité des API : npm run check
import { loadConfig, env } from '../src/config.js';

const ok = (b) => (b ? '✅' : '❌');
let cfg;
try {
  cfg = loadConfig();
  console.log('✅ config.json valide');
} catch (e) {
  console.log(`❌ ${e.message}`);
  process.exit(1);
}
console.log(`${ok(env.telegramToken)} TELEGRAM_BOT_TOKEN`);
console.log(`${ok(env.telegramChatId)} TELEGRAM_CHAT_ID`);
console.log(`${ok(env.heliusKey)} HELIUS_API_KEY ${cfg.smartMoney.enabled ? '(requis pour le smart money)' : ''}`);
console.log(`${env.birdeyeKey ? '✅' : '➖'} BIRDEYE_API_KEY (optionnel)`);

const probes = [
  ['DexScreener', 'https://api.dexscreener.com/token-profiles/latest/v1'],
  ['GeckoTerminal', 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools'],
  ['GoPlus', 'https://api.gopluslabs.io/api/v1/supported_chains'],
  ['Honeypot.is', 'https://api.honeypot.is/v2/IsHoneypot?address=0x4200000000000000000000000000000000000006&chainID=8453'],
  ['RugCheck', 'https://api.rugcheck.xyz/v1/stats/new_tokens'],
];
if (env.heliusKey) probes.push(['Helius', `https://api.helius.xyz/v0/webhooks?api-key=${env.heliusKey}`]);
for (const [name, url] of probes) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    console.log(`${ok(r.ok)} ${name} (HTTP ${r.status})`);
  } catch (e) {
    console.log(`❌ ${name} injoignable (${e.cause?.code || e.message})`);
  }
}
