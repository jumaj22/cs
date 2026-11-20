# Explication des seuils (`config.json`)

Chaque valeur ci-dessous est modifiable dans `config.json` (redémarre `npm start` après
modification). Les valeurs par défaut sont un **point de départ prudent**, pas une vérité :
utilise `npm run backtest` après quelques jours pour les ajuster avec tes propres résultats.

Règle générale : **plus un seuil est strict, moins il y a de signaux, mais de meilleure qualité.**

---

## Général

| Clé | Défaut | Pourquoi |
|---|---|---|
| `chains` | `["solana","base"]` | Les deux chaînes demandées. Retire-en une pour réduire les appels API. |
| `scanIntervalSec` | `60` | Demandé (60 s). Les métriques DexScreener sont sur 5 min : scanner plus souvent apporte peu et consomme les quotas. Minimum autorisé : 15 s. |

## `data` — sources

| Clé | Défaut | Pourquoi |
|---|---|---|
| `useDexScreenerProfiles` / `useDexScreenerBoosts` | `true` | Tokens qui viennent de créer un profil / payer un boost : souvent des lancements récents. |
| `useGeckoNewPools` | `true` | Vraie liste des nouvelles pools, par chaîne. |
| `useGeckoTrendingPools` | `true` | Pools qui accélèrent sur 1 h : bon vivier de FOMO. |
| `maxPairAgeHours` | `24` | On ne s'intéresse qu'aux **nouvelles** paires (< 24 h). |
| `watchlistHours` | `6` | Un token découvert à 3 min ne passe pas le filtre d'âge (10 min) ; on le garde 6 h pour le réévaluer à chaque scan, car le FOMO arrive souvent 30 min à quelques heures après le lancement. |
| `maxWatchlistSize` | `400` | Plafond pour rester sous les limites DexScreener (30 tokens par appel → ~14 appels/scan). |

## `fomo` — détection (toutes les conditions doivent être vraies)

| Clé | Défaut | Pourquoi |
|---|---|---|
| `minLiquidityUsd` | `20000` | Demandé. Sous 20 k$, un achat de 500 $ fait bouger le prix de plusieurs %, et un retrait de liquidité vide la pool facilement. |
| `minVolume5mUsd` | `5000` | Évite qu'un ratio élevé vienne d'un volume ridicule (ex. 300 $ vs 50 $ de moyenne = ×6 mais insignifiant). |
| `volumeSpikeRatio` | `3` | Volume des 5 dernières minutes ≥ **3×** la moyenne par tranche de 5 min sur 1 h. ×2 arrive tout le temps (bruit) ; ×3 indique une vraie accélération ; ×5+ est plus rare et souvent déjà tardif. *La moyenne est calculée sur l'âge réel si le token a moins d'1 h.* |
| `minPriceChange5mPct` | `3` | Le prix doit être en train de monter **maintenant** (pas seulement avoir monté plus tôt). |
| `minPriceChange1hPct` | `10` | Confirme une tendance haussière sur l'heure, pas un simple pic isolé. |
| `maxPriceChange1hPct` | `300` | **Filtre « trop tard »** demandé : au-delà de +300 % en 1 h, l'essentiel du mouvement est fait et le risque de retournement (prise de profit des premiers acheteurs) est maximal. |
| `minBuys5m` | `15` | Au moins 15 transactions d'achat en 5 min : un FOMO, c'est **beaucoup d'acheteurs**, pas 2 gros achats (souvent le créateur). |
| `minBuyTxGrowthRatio` | `1.5` | Nombre d'achats sur 5 min ≥ 1,5× la moyenne 1 h : la croissance des acheteurs demandée. Plus bas que le ratio de volume car le nombre de transactions varie moins que les montants. |
| `minBuySellRatio5m` | `1.2` | 20 % d'achats de plus que de ventes : la pression est acheteuse. Un volume qui explose avec autant de ventes que d'achats = distribution, pas FOMO. |

## `antiScam` — filtres anti-arnaque

| Clé | Défaut | Pourquoi |
|---|---|---|
| `minAgeMinutes` | `10` | Demandé. Les 10 premières minutes concentrent les rugs, snipers et bots : les données y sont peu fiables. |
| `requireLiquidityLocked` | `true` | Demandé : si la liquidité n'est pas verrouillée/brûlée, le créateur peut la retirer (rug pull). |
| `minLpLockedPct` | `90` | 90 % au moins des tokens LP verrouillés ou brûlés. 100 % serait trop strict (petites positions LP de tiers). |
| `unknownLpLock` | `"reject"` | Quand aucune API ne sait mesurer le verrouillage (fréquent sur les pools V3/CL de Base) : on **rejette** par prudence. Mets `"accept"` pour plus de signaux Base (plus risqué). |
| `programLockedDexIds` | `["pumpfun","moonshot"]` | Sur ces courbes de lancement, la liquidité est tenue par le programme : le créateur ne peut pas la retirer → considérée verrouillée. |
| `maxTop10HolderPct` | `30` | Demandé. Si 10 wallets détiennent > 30 % (hors pool et adresses de burn/lock), ils peuvent écraser le prix en vendant. |
| `unknownTop10` | `"reject"` | Répartition inconnue → rejet par prudence. |
| `rejectHoneypot` | `true` | Demandé : vente impossible (ou bloquable : token non transférable, transfer hook Solana) → exclu. |
| `maxSellTaxPct` | `10` | Demandé : au-delà de 10 % de taxe, il faut +11 % juste pour revenir à zéro, et la taxe peut souvent être augmentée. |
| `maxBuyTaxPct` | `10` | Même logique à l'achat. |
| `rejectMintable` | `true` | Demandé : le créateur peut créer des tokens à volonté et les vendre (dilution). Ignoré si l'ownership est renoncée (Base). Inclut aussi « owner peut modifier les soldes ». |
| `rejectBlacklist` | `true` | Demandé : le créateur peut bloquer ton wallet (blacklist / pause des transferts sur Base, *freeze authority* sur Solana). |
| `rejectOnSecurityApiFailure` | `true` | Si GoPlus/Honeypot.is/RugCheck sont tous injoignables, on ne prend pas le risque. |
| `useHoneypotIsForEvm` | `true` | Honeypot.is **simule** un vrai achat/vente sur Base : plus fiable que l'analyse statique pour les honeypots et les taxes. |
| `useRugCheckForSolana` | `true` | Deuxième avis Solana (verrouillage LP, holders, autorités). |
| `securityCacheMinutes` | `30` | Les propriétés de sécurité changent peu : évite de réinterroger les API à chaque scan. |

## `signals` — règles d'entrée et de sortie

### `entry`
| Clé | Défaut | Pourquoi |
|---|---|---|
| `enableFomo` / `enableSmartMoney` | `true` | Active chaque type de signal séparément (utile pour comparer au backtest). |
| `cooldownMinutes` | `120` | Pas de nouvelle entrée sur le même token pendant 2 h après une entrée (évite de racheter le même pump en boucle). |
| `maxOpenPositions` | `10` | Avec 100 $ par trade et 1 000 $ de capital simulé, on ne dépasse jamais l'exposition totale. |

### `exit`
| Clé | Défaut | Pourquoi |
|---|---|---|
| `takeProfitPct` | `50` | Objectif +50 %. Ratio gain/risque de 2,5 avec le stop à -20 % : rentable même avec ~35 % de réussite. |
| `stopLossPct` | `20` | -20 % : assez large pour la volatilité normale d'un memecoin (des mèches de -10 % sont courantes), assez serré pour couper un rug. |
| `trailingStop.enabled` | `true` | Laisse courir les gagnants au lieu de rendre tout le gain. |
| `trailingStop.activationPct` | `25` | Le trailing ne s'active qu'à +25 % : avant, c'est le stop-loss fixe qui protège. |
| `trailingStop.distancePct` | `15` | Sortie si le prix recule de 15 % depuis son plus haut. Activé à +25 %, le pire cas est donc ≈ +6 % (gain verrouillé). |
| `maxHoldMinutes` | `720` | 12 h max : un FOMO s'essouffle vite ; une position qui ne bouge pas immobilise du capital. Mets `0` pour désactiver. |
| `smartMoneyExitMinSellers` | `2` | La position papier est fermée dès que 2 des wallets acheteurs revendent (1 seule vente peut être une prise de profit partielle). Chaque vente déclenche quand même une alerte. |

## `smartMoney`

### `criteria` — qui est « smart money »
| Clé | Défaut | Pourquoi |
|---|---|---|
| `lookbackDays` | `30` | Demandé : performance sur 30 jours, assez récente pour refléter le marché actuel. |
| `minWinRatePct` | `60` | Demandé (strictement > 60 %). |
| `minTrades` | `30` | Demandé : en dessous, un bon win rate peut être de la chance. |
| `maxTrades` | `3000` | Au-delà de ~100 swaps/jour, c'est presque toujours un bot (MEV, sniper, arbitrage) : ses achats ne sont pas des signaux exploitables. |
| `minClosedPositions` | `10` | Le win rate est calculé sur les tokens **revendus** ; il en faut au moins 10 pour qu'il ait un sens. |
| `minRealizedPnlUsd` | `0` | Demandé : P&L réalisé strictement positif (un win rate de 70 % avec de grosses pertes reste perdant). |

### Liste et candidats
| Clé | Défaut | Pourquoi |
|---|---|---|
| `refreshHours` | `24` | Demandé : mise à jour quotidienne ; les wallets qui ne passent plus les critères sont retirés. |
| `maxWallets` | `40` | Garde les 40 meilleurs (win rate puis P&L) : assez pour des clusters de 3, sans exploser les appels de polling. |
| `maxCandidatesPerRefresh` | `60` | Chaque évaluation coûte jusqu'à 3 appels Helius ; 60 candidats/jour reste dans l'offre gratuite. |
| `maxHistoryPagesPerWallet` | `3` | 300 swaps max analysés par wallet. |
| `candidateSources.birdeyeTopTraders` | `true` | Top traders des tokens tendance (nécessite `BIRDEYE_API_KEY`). |
| `candidateSources.heliusRecentTradersOfWinners` | `true` | Traders des tokens Solana qui ont fait > +100 % en 1 h, repérés par le scanner. |
| `candidateSources.winnerTokensPerRefresh` | `8` | Nombre de tokens gagnants dont on récupère les traders. |
| `candidateSources.seedWallets` | `[]` | Tes propres adresses (ex. copiées depuis gmgn.ai). Elles doivent quand même passer les critères. |

### `monitor` — surveillance temps réel
| Clé | Défaut | Pourquoi |
|---|---|---|
| `mode` | `"polling"` | Fonctionne partout sans configuration réseau. `"webhook"` = Helius pousse les swaps instantanément (nécessite une URL publique, ex. via `ngrok http 3000`, dans `PUBLIC_WEBHOOK_URL`). |
| `pollIntervalSec` | `15` | Demandé : 15 s. Plus bas risque les limites du RPC public. |
| `signatureRpc` | `"public"` | Le RPC public Solana est gratuit pour détecter les nouvelles transactions ; `"helius"` est plus fiable mais consomme des crédits (≈ 4 crédits/min/wallet). |
| `webhookPort` / `webhookPath` | `3000` / `/helius` | Serveur local du mode webhook. |

### `cluster` — signal fort
| Clé | Défaut | Pourquoi |
|---|---|---|
| `minWallets` | `3` | Demandé : 3 wallets **distincts** ; un seul wallet peut se tromper ou être un insider. |
| `windowMinutes` | `30` | Demandé : achats rapprochés = conviction commune. |
| `minBuyUsdPerWallet` | `50` | Ignore les achats « test » de quelques dollars. |
| `minLiquidityUsd` | `20000` | Même plancher de liquidité que le FOMO. |
| `fallbackSolPriceUsd` | `150` | Valeur utilisée seulement si le prix du SOL est introuvable. |

## `paper` — trading simulé

| Clé | Défaut | Pourquoi |
|---|---|---|
| `csvFile` | `data/trades.csv` | Emplacement du journal des trades. |
| `positionSizeUsd` | `100` | Taille fixe par trade : rend les résultats comparables entre signaux. |
| `startingCapitalUsd` | `1000` | Base du calcul de drawdown au backtest. |
| `simulatedSlippagePct` | `1` | Pénalité de 1 % à l'achat **et** à la vente pour ne pas surestimer les résultats. Les memecoins réels peuvent coûter bien plus. |
| `priceCheckIntervalSec` | `30` | Fréquence de vérification TP/SL/trailing. |

## `telegram`

| Clé | Défaut | Pourquoi |
|---|---|---|
| `sendStartupMessage` | `true` | Confirme dès le premier lancement que les alertes arrivent. |
| `sendExitAlerts` / `sendSmartMoneySellAlerts` | `true` | Alertes SORTIE et ventes smart money. |
| `minIntervalMs` | `1100` | Telegram limite à ~1 message/s par conversation. |

## `http` — fiabilité

| Clé | Défaut | Pourquoi |
|---|---|---|
| `timeoutMs` | `15000` | Une API qui ne répond pas en 15 s est considérée en erreur. |
| `maxRetries` | `4` | Jusqu'à 4 nouvelles tentatives sur erreur réseau, 429 ou 5xx. |
| `baseBackoffMs` / `maxBackoffMs` | `1000` / `30000` | Attente 1 s, 2 s, 4 s, 8 s… (+ aléa), plafonnée à 30 s. Si l'API envoie `Retry-After`, on le respecte. |
| `minIntervalMsByHost` | voir fichier | Espacement minimal entre deux appels à chaque API, calé sous leurs limites publiques (DexScreener 300/min, GeckoTerminal 30/min, GoPlus ~30/min, Birdeye ~1/s…). |
