# FOMO Scanner — Solana & Base

Scanner de nouvelles paires qui détecte les tokens en phase de FOMO, suit les wallets
« smart money », filtre les arnaques, envoie des alertes Telegram **ENTRÉE / SORTIE**
et enregistre chaque signal comme **trade papier** dans un CSV, avec un script de backtest.

> ⚠️ **Mode papier uniquement.** Le programme ne passe **aucun ordre réel**, ne contient
> **aucune clé privée de wallet** et n'en demande jamais. Les clés API sont lues depuis `.env`.
> Les memecoins sont extrêmement risqués : ces signaux ne sont pas des conseils financiers.

---

## Sommaire
1. [Installation](#1-installation)
2. [Lancement](#2-lancement)
3. [Clé Telegram (@BotFather)](#3-bot-telegram-botfather)
4. [Clé Helius](#4-clé-helius-smart-money-solana)
5. [Clé Birdeye (optionnelle)](#5-clé-birdeye-optionnelle)
6. [Commandes](#6-commandes)
7. [Fonctionnement](#7-fonctionnement)
8. [Fichiers produits](#8-fichiers-produits)
9. [Limites connues](#9-limites-connues)

Tous les seuils sont expliqués dans **[docs/SEUILS.md](docs/SEUILS.md)**.

---

## 1. Installation

Prérequis : **Node.js 18.17 ou plus récent** (`node -v` pour vérifier — https://nodejs.org).

```bash
cd fomo-scanner
npm install
cp .env.example .env        # Windows : copy .env.example .env
```

Ouvre `.env` dans un éditeur et remplis les clés (étapes 3 à 5 ci-dessous).
Seul Telegram est vraiment nécessaire pour démarrer ; sans Helius, le scanner FOMO
fonctionne mais le suivi smart money est désactivé.

Vérifie ensuite l'installation :

```bash
npm run check           # config.json, clés présentes, API joignables
npm run telegram:test   # envoie un message de test sur Telegram
npm test                # tests unitaires
```

## 2. Lancement

```bash
npm start
```

C'est la seule commande nécessaire : elle démarre le scan (toutes les 60 s), le suivi
des positions papier, la construction/mise à jour de la liste smart money et la
surveillance des wallets. Un message « Scanner démarré » arrive sur Telegram dès le
premier lancement, puis une alerte pour chaque signal.

Arrêt : `Ctrl + C` (le CSV est sauvegardé ; les positions ouvertes sont reprises au prochain lancement).

Pour le faire tourner 24 h/24 sur un serveur, tu peux utiliser `pm2` :
`npm i -g pm2 && pm2 start npm --name fomo -- start`.

---

## 3. Bot Telegram (@BotFather)

1. Dans Telegram, cherche **@BotFather** (badge bleu officiel) et ouvre la discussion.
2. Envoie `/newbot`.
3. Donne un **nom** (ex. `Mon FOMO Scanner`) puis un **identifiant** qui finit par `bot`
   (ex. `mon_fomo_scanner_bot`).
4. BotFather répond avec un **token** du type `123456789:AAH...`. Copie-le dans `.env` :
   `TELEGRAM_BOT_TOKEN=123456789:AAH...`
5. Ouvre la discussion avec **ton** bot (lien donné par BotFather) et envoie `/start`.
   *(Pour un groupe : ajoute le bot au groupe et envoie un message dans le groupe.)*
6. Lance `npm run telegram:test` : comme `TELEGRAM_CHAT_ID` est vide, le script affiche
   les chat IDs trouvés. Copie le tien dans `.env` :
   `TELEGRAM_CHAT_ID=987654321` (un ID de groupe commence par `-100…`).
7. Relance `npm run telegram:test` → tu dois recevoir « ✅ Test FOMO Scanner ».

> Ne partage jamais ce token : quiconque l'a peut contrôler ton bot. En cas de fuite :
> `/revoke` auprès de BotFather.

## 4. Clé Helius (smart money Solana)

Helius fournit l'historique des swaps parsés des wallets (pour calculer leur win rate)
et le décodage des transactions en temps réel.

1. Va sur **https://dashboard.helius.dev** et crée un compte (offre gratuite suffisante pour débuter).
2. Dans le tableau de bord, menu **API Keys** : une clé est créée par défaut. Copie-la.
3. Dans `.env` : `HELIUS_API_KEY=xxxxxxxx-xxxx-...`
4. `npm run check` doit afficher `✅ Helius`.
5. (Optionnel) Construis la liste tout de suite : `npm run wallets:refresh`.

**Crédits :** par défaut le polling des signatures (toutes les 15 s) passe par le **RPC
public Solana** (gratuit) ; Helius n'est sollicité que pour décoder les nouvelles
transactions et pour la mise à jour quotidienne de la liste. Ça tient dans l'offre gratuite
avec les réglages par défaut. Pour plus de réactivité et moins de requêtes, passe en
mode **webhook** (voir docs/SEUILS.md → `smartMoney.monitor`).

## 5. Clé Birdeye (optionnelle)

Birdeye fournit les « top traders » de chaque token tendance : la meilleure source pour
trouver de nouveaux wallets candidats. Sans clé, le programme utilise les traders récents
des tokens gagnants repérés par le scanner + tes `seedWallets`.

1. Va sur **https://bds.birdeye.so** (Birdeye Data Services) et crée un compte.
2. Dans **API Keys / Usage**, copie ta clé.
3. Dans `.env` : `BIRDEYE_API_KEY=...`

> Selon l'offre Birdeye, certains endpoints (dont top traders) peuvent être réservés aux
> plans payants. En cas d'erreur 401/403, le programme continue simplement sans Birdeye.

**GMGN** n'a pas d'API publique officielle (site protégé contre les robots) : il n'est pas
interrogé automatiquement. Tu peux copier des adresses de wallets repérées sur gmgn.ai dans
`config.json → smartMoney.candidateSources.seedWallets` : elles seront évaluées avec les
mêmes critères (win rate, nombre de trades, P&L) et ajoutées seulement si elles les passent.

**GoPlus** fonctionne sans clé. `GOPLUS_ACCESS_TOKEN` n'est utile que si tu as un compte
GoPlus payant (limites plus hautes). Honeypot.is et RugCheck n'ont pas besoin de clé.

---

## 6. Commandes

| Commande | Rôle |
|---|---|
| `npm start` | Lance tout (scanner, smart money, positions, alertes) |
| `npm run backtest` | Analyse le CSV : réussite, gain/perte moyens, drawdown, comparaisons |
| `npm run backtest -- --since 2026-12-01` | Backtest depuis une date |
| `npm run backtest -- --file autre.csv` | Backtest d'un autre fichier |
| `npm run wallets:refresh` | Reconstruit la liste smart money immédiatement |
| `npm run telegram:test` | Teste le bot / trouve ton chat ID |
| `npm run check` | Vérifie config, clés et API |
| `npm test` | Tests unitaires |

Logs plus détaillés : `LOG_LEVEL=debug` dans `.env`.

## 7. Fonctionnement

```
 Découverte (60 s)                    Smart money (temps réel)
 DexScreener profils/boosts           Liste de wallets (MAJ 24 h, Helius/Birdeye)
 GeckoTerminal new/trending pools     Polling 15 s ou webhook Helius
          │                                   │
          ▼                                   ▼
 Watchlist des paires < 24 h          Achat ≥ 3 wallets en 30 min ?  ── Vente → alerte SORTIE
 Snapshots DexScreener                        │
 (secours GeckoTerminal)                      │
          │                                   │
          ▼                                   ▼
 Détection FOMO ──────────────►  Filtres anti-arnaque (âge, LP, top 10,
                                 GoPlus + Honeypot.is / RugCheck)
                                          │
                                          ▼
                         ENTRÉE → trade papier (CSV) + Telegram
                                          │
                       Suivi prix (30 s) : TP / SL / trailing / durée max
                                          ▼
                                 SORTIE → CSV + Telegram
```

- **Données** (`src/data/`) : DexScreener est la source principale. Comme DexScreener
  n'a pas d'endpoint « nouvelles paires », la découverte combine ses profils/boosts récents
  et les `new_pools`/`trending_pools` de GeckoTerminal. Chaque paire découverte reste
  en **watchlist** quelques heures pour être réévaluée à chaque scan. Si DexScreener tombe,
  les données viennent de GeckoTerminal.
- **FOMO** (`src/analysis/fomo.js`) : toutes les conditions de `config.fomo` doivent être vraies.
- **Anti-arnaque** (`src/security/`) : GoPlus (+ Honeypot.is sur Base, RugCheck sur Solana),
  en gardant toujours la valeur la plus prudente. Les contrôles honeypot / taxe / mint /
  blacklist s'appliquent à **tous** les tokens ; les contrats non vérifiés sont acceptés
  s'ils les passent et marqués **« NON VÉRIFIÉ »** dans l'alerte et `verified=non` dans le CSV.
  « Vérifié » = code source publié (Base) ; métadonnées figées (Solana).
- **Signaux** (`src/signals/rules.js`) : types `FOMO`, `SMART_MONEY`, `FOMO+SMART_MONEY`.
  Sorties : `TAKE_PROFIT`, `STOP_LOSS`, `TRAILING_STOP`, `TIMEOUT`, `SMART_MONEY_SELL`.
- **Smart money** (`src/smartmoney/`) : wallets avec win rate > 60 %, ≥ 30 trades sur
  30 jours et P&L réalisé positif, recalculés chaque jour (ceux qui chutent sont retirés).
- **Fiabilité** (`src/utils/http.js`) : timeout, 4 retries avec backoff exponentiel,
  respect de `Retry-After` sur les 429, espacement minimal par API, aucune erreur d'API
  ne fait planter le programme. Les URLs contenant des clés ne sont jamais loguées.

## 8. Fichiers produits

- `data/trades.csv` — un trade papier par ligne : `open_time, close_time, symbol,
  token_address, signal_type, reason, verified, entry_price, exit_price, stop_loss,
  take_profit, pnl_pct, pnl_usd, exit_reason, smart_wallets, dexscreener_url…`
  (s'ouvre dans Excel / Google Sheets).
- `data/smart_wallets.json` — liste smart money actuelle avec statistiques.

Le dossier `data/` et `.env` sont exclus de git.

## 9. Limites connues

- **Smart money : Solana uniquement.** Helius ne couvre pas Base ; pour Base, seul le
  scanner FOMO + anti-arnaque est actif.
- Le win rate d'un wallet est calculé sur ses swaps des 30 derniers jours (max
  `maxHistoryPagesPerWallet` × 100 swaps), valorisés au prix SOL actuel : c'est une
  **approximation**. Les ventes de tokens achetés avant la fenêtre sont ignorées.
- Les données DexScreener ont quelques secondes de retard ; le prix papier inclut un
  slippage simulé (`paper.simulatedSlippagePct`) mais un vrai trade sur un memecoin peut
  subir bien pire.
- Le verrouillage de liquidité n'est pas mesurable sur toutes les pools (ex. pools
  concentrées V3 sur Base) : par défaut ces tokens sont **rejetés** (`unknownLpLock: "reject"`).
- Les formats des API tierces évoluent : en cas d'erreurs répétées sur une source,
  `npm run check` et `LOG_LEVEL=debug` aident à identifier laquelle.
