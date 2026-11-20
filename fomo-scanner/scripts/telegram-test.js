#!/usr/bin/env node
// Vérifie le bot Telegram. Sans TELEGRAM_CHAT_ID, affiche les chat_id trouvés via getUpdates.
import '../src/config.js';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN manquant dans .env (voir README étape 3).');
  process.exit(1);
}
const api = (m, body) =>
  fetch(`https://api.telegram.org/bot${token}/${m}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

const me = await api('getMe');
if (!me.ok) {
  console.error(`❌ Token invalide : ${me.description}`);
  process.exit(1);
}
console.log(`✅ Bot OK : @${me.result.username}`);

if (!chatId) {
  const up = await api('getUpdates');
  const chats = new Map();
  for (const u of up.result || []) {
    const c = (u.message || u.channel_post || u.my_chat_member)?.chat;
    if (c) chats.set(c.id, c.title || c.username || c.first_name);
  }
  if (!chats.size) console.log('ℹ️  Aucun message reçu. Envoie "/start" à ton bot sur Telegram, puis relance cette commande.');
  else {
    console.log('Chat IDs trouvés (copie le bon dans TELEGRAM_CHAT_ID) :');
    for (const [id, name] of chats) console.log(`  ${id}  →  ${name}`);
  }
  process.exit(0);
}
const r = await api('sendMessage', { chat_id: chatId, text: '✅ Test FOMO Scanner : les alertes arriveront ici.', parse_mode: 'HTML' });
console.log(r.ok ? '✅ Message de test envoyé.' : `❌ Échec : ${r.description}`);
