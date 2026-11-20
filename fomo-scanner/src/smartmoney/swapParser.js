// Transforme une transaction Helius enrichie en swap {BUY|SELL} pour un wallet donné.
// Méthode : variations nettes de soldes du wallet (SOL natif + wSOL + stablecoins = "quote").
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const STABLE_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

function amount(raw) {
  if (!raw) return 0;
  return Number(raw.tokenAmount) / 10 ** (raw.decimals || 0);
}

function deltasFromAccountData(tx, wallet) {
  if (!Array.isArray(tx.accountData) || !tx.accountData.length) return null;
  const tokens = new Map();
  let sol = 0;
  let seen = false;
  for (const a of tx.accountData) {
    if (a.account === wallet) {
      sol += (a.nativeBalanceChange || 0) / 1e9;
      seen = true;
    }
    for (const c of a.tokenBalanceChanges || []) {
      if (c.userAccount !== wallet) continue;
      tokens.set(c.mint, (tokens.get(c.mint) || 0) + amount(c.rawTokenAmount));
      seen = true;
    }
  }
  return seen ? { sol, tokens } : null;
}

function deltasFromTransfers(tx, wallet) {
  const tokens = new Map();
  let sol = 0;
  for (const n of tx.nativeTransfers || []) {
    if (n.toUserAccount === wallet) sol += n.amount / 1e9;
    if (n.fromUserAccount === wallet) sol -= n.amount / 1e9;
  }
  for (const t of tx.tokenTransfers || []) {
    const v = Number(t.tokenAmount) || 0;
    if (t.toUserAccount === wallet) tokens.set(t.mint, (tokens.get(t.mint) || 0) + v);
    if (t.fromUserAccount === wallet) tokens.set(t.mint, (tokens.get(t.mint) || 0) - v);
  }
  return { sol, tokens };
}

/**
 * @returns {null | {signature, timestamp, wallet, side:'BUY'|'SELL', mint, tokenAmount, amountUsd}}
 */
export function parseSwap(tx, wallet, solPriceUsd) {
  if (!tx || tx.transactionError) return null;
  const d = deltasFromAccountData(tx, wallet) || deltasFromTransfers(tx, wallet);
  let quoteUsd = d.sol * solPriceUsd;
  const others = [];
  for (const [mint, delta] of d.tokens) {
    if (Math.abs(delta) < 1e-12) continue;
    if (mint === SOL_MINT) quoteUsd += delta * solPriceUsd;
    else if (STABLE_MINTS.has(mint)) quoteUsd += delta;
    else others.push([mint, delta]);
  }
  // Un seul token "non-quote" impliqué → swap lisible. Les swaps token→token sont ignorés.
  if (others.length !== 1) return null;
  const [mint, delta] = others[0];
  let side = null;
  if (delta > 0 && quoteUsd < 0) side = 'BUY';
  else if (delta < 0 && quoteUsd > 0) side = 'SELL';
  if (!side) return null;
  return {
    signature: tx.signature,
    timestamp: (tx.timestamp || Date.now() / 1000) * 1000,
    wallet,
    side,
    mint,
    tokenAmount: Math.abs(delta),
    amountUsd: Math.abs(quoteUsd),
  };
}
