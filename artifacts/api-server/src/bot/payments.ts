import { logger } from "../lib/logger";
import { WALLETS, type CoinSymbol } from "./config";

const COINGECKO_IDS: Record<CoinSymbol, string> = {
  BTC:  "bitcoin",
  ETH:  "ethereum",
  USDT: "tether",
  LTC:  "litecoin",
  SOL:  "solana",
  BNB:  "binancecoin",
};

const PRECISION: Record<CoinSymbol, number> = {
  BTC:  6,
  ETH:  5,
  USDT: 2,
  LTC:  4,
  SOL:  3,
  BNB:  4,
};

const TRON_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

// ── Price fetching ────────────────────────────────────────────

export async function getCryptoAmount(usdAmount: number, coin: CoinSymbol): Promise<string> {
  const id = COINGECKO_IDS[coin];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const data = (await res.json()) as Record<string, { usd: number }>;
  const price = data[id]?.usd;
  if (!price) throw new Error(`No price returned for ${coin}`);
  return (usdAmount / price).toFixed(PRECISION[coin]);
}

// ── QR code link ──────────────────────────────────────────────

export function getPaymentQrUrl(coin: CoinSymbol, cryptoAmount: string): string {
  const { address } = WALLETS[coin];
  let uri: string;
  switch (coin) {
    case "BTC":  uri = `bitcoin:${address}?amount=${cryptoAmount}`;   break;
    case "LTC":  uri = `litecoin:${address}?amount=${cryptoAmount}`;  break;
    case "SOL":  uri = `solana:${address}?amount=${cryptoAmount}`;    break;
    default:     uri = address;
  }
  return `https://qr.crypt.bot/?url=${encodeURIComponent(uri)}`;
}

// ── Helpers ───────────────────────────────────────────────────

/** Accepts ±3% under (network fees) and up to +15% over (overpay). */
function inRange(received: number, expected: number): boolean {
  return received >= expected * 0.97 && received <= expected * 1.15;
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(url, init);
    return res;
  } catch (err) {
    logger.warn({ err, url }, "fetch failed");
    return null;
  }
}

// ── BTC ───────────────────────────────────────────────────────
// Primary:  blockstream.info
// Fallback: BlockCypher BTC

async function checkBtc(address: string, expectedAmount: string, after: Date): Promise<boolean> {
  const expectedSats = Math.round(parseFloat(expectedAmount) * 1e8);

  // Primary: blockstream.info
  const res = await safeFetch(`https://blockstream.info/api/address/${address}/txs`);
  if (res?.ok) {
    const txs = (await res.json()) as Array<{
      status: { block_time?: number };
      vout: Array<{ scriptpubkey_address?: string; value: number }>;
    }>;
    for (const tx of txs) {
      const t = tx.status.block_time;
      if (t && new Date(t * 1000) < after) continue;
      for (const out of tx.vout) {
        if (out.scriptpubkey_address === address && inRange(out.value, expectedSats)) return true;
      }
    }
    return false;
  }

  // Fallback: BlockCypher BTC
  logger.info({ address }, "BTC blockstream unavailable — falling back to BlockCypher");
  const fb = await safeFetch(`https://api.blockcypher.com/v1/btc/main/addrs/${address}/full?limit=20`);
  if (!fb?.ok) return false;
  const data = (await fb.json()) as {
    txs?: Array<{ received: string; outputs: Array<{ addresses?: string[]; value: number }> }>;
  };
  for (const tx of (data.txs ?? [])) {
    if (new Date(tx.received) < after) continue;
    for (const out of tx.outputs) {
      if (out.addresses?.includes(address) && inRange(out.value, expectedSats)) return true;
    }
  }
  return false;
}

// ── ETH / BNB (EVM) ──────────────────────────────────────────
// ETH:  Etherscan → BlockCypher ETH
// BNB:  BSCScan   → Blockchair BSC

async function checkEthViaEtherscan(address: string, expectedEth: number, after: Date, apiUrl: string, chain: string): Promise<boolean | null> {
  const res = await safeFetch(apiUrl);
  if (!res?.ok) return null;
  const data = (await res.json()) as { status: string; result: Array<{ to: string; value: string; timeStamp: string }> };
  if (data.status !== "1" || !Array.isArray(data.result)) return null;
  const addrLow = address.toLowerCase();
  for (const tx of data.result) {
    if (new Date(parseInt(tx.timeStamp) * 1000) < after) break;
    if (tx.to?.toLowerCase() !== addrLow) continue;
    const received = parseInt(tx.value) / 1e18;
    if (inRange(received, expectedEth)) return true;
  }
  return false;
}

async function checkEthViaBlockcypher(address: string, expectedWei: number, after: Date): Promise<boolean> {
  // BlockCypher ETH API expects address WITHOUT 0x prefix; responses also omit it
  const addrLow = address.toLowerCase();
  const addrNoPrefix = addrLow.startsWith("0x") ? addrLow.slice(2) : addrLow;
  const res = await safeFetch(`https://api.blockcypher.com/v1/eth/main/addrs/${addrNoPrefix}/full?limit=20`);
  if (!res?.ok) return false;
  const data = (await res.json()) as {
    txs?: Array<{ received: string; outputs: Array<{ addresses?: string[]; value: number }> }>;
  };
  for (const tx of (data.txs ?? [])) {
    if (new Date(tx.received) < after) continue;
    for (const out of tx.outputs) {
      const addrs = out.addresses ?? [];
      if (addrs.some((a) => a === addrNoPrefix || a === addrLow) && inRange(out.value, expectedWei)) return true;
    }
  }
  return false;
}

async function checkBnbViaBlockchair(address: string, expectedEth: number, after: Date): Promise<boolean> {
  const addrLow = address.toLowerCase();
  // Blockchair BSC endpoint — filter by recipient and time range
  const afterDate = after.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const url = `https://api.blockchair.com/binance-smart-chain/transactions?q=recipient(${addrLow}),time(>${afterDate})&limit=10&s=time(desc)`;
  const res = await safeFetch(url, { headers: { Accept: "application/json" } });
  if (!res?.ok) return false;
  const data = (await res.json()) as {
    data?: Array<{ time: string; value: string; recipient: string }>;
  };
  const expectedWei = expectedEth * 1e18;
  for (const tx of (data.data ?? [])) {
    if (tx.recipient?.toLowerCase() !== addrLow) continue;
    if (inRange(parseFloat(tx.value), expectedWei)) return true;
  }
  return false;
}

async function checkEth(address: string, expectedAmount: string, after: Date, chain: "eth" | "bsc"): Promise<boolean> {
  const expectedEth = parseFloat(expectedAmount);
  const expectedWei = Math.round(expectedEth * 1e18);

  if (chain === "eth") {
    const scanUrl = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=20`;
    const scanResult = await checkEthViaEtherscan(address, expectedEth, after, scanUrl, "ETH");
    if (scanResult !== null) return scanResult;
    logger.info({ address }, "Etherscan rate-limited — falling back to BlockCypher for ETH");
    return checkEthViaBlockcypher(address, expectedWei, after);
  }

  // BNB — BSCScan primary, Blockchair BSC fallback
  const scanUrl = `https://api.bscscan.com/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=20`;
  const scanResult = await checkEthViaEtherscan(address, expectedEth, after, scanUrl, "BNB");
  if (scanResult !== null) return scanResult;
  logger.info({ address }, "BSCScan rate-limited — falling back to Blockchair for BNB");
  return checkBnbViaBlockchair(address, expectedEth, after);
}

// ── USDT TRC20 ────────────────────────────────────────────────
// Primary:  TronGrid
// Fallback: Tronscan

async function checkUsdt(address: string, expectedAmount: string, after: Date): Promise<boolean> {
  const expectedUnits = Math.round(parseFloat(expectedAmount) * 1e6);
  const minTs = after.getTime();

  // Primary: TronGrid
  const res = await safeFetch(
    `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&order_by=block_timestamp,desc&min_timestamp=${minTs}`,
    { headers: { Accept: "application/json" } },
  );
  if (res?.ok) {
    const data = (await res.json()) as {
      data: Array<{ to: string; value: string; token_info: { address: string } }>;
    };
    for (const tx of (data.data ?? [])) {
      if (tx.to !== address) continue;
      if (tx.token_info?.address?.toUpperCase() !== TRON_USDT_CONTRACT.toUpperCase()) continue;
      if (inRange(parseInt(tx.value), expectedUnits)) return true;
    }
    return false;
  }

  // Fallback: Tronscan public API
  logger.info({ address }, "TronGrid unavailable — falling back to Tronscan for USDT");
  const fb = await safeFetch(
    `https://apilist.tronscanapi.com/api/token_trc20/transfers?relatedAddress=${address}&limit=20&sort=-timestamp&start=0`,
    { headers: { Accept: "application/json" } },
  );
  if (!fb?.ok) return false;
  const fbData = (await fb.json()) as {
    token_transfers?: Array<{
      toAddress: string;
      amount: string;
      contractAddress: string;
      block_ts: number;
    }>;
  };
  for (const tx of (fbData.token_transfers ?? [])) {
    if (new Date(tx.block_ts) < after) continue;
    if (tx.toAddress !== address) continue;
    if (tx.contractAddress?.toUpperCase() !== TRON_USDT_CONTRACT.toUpperCase()) continue;
    if (inRange(parseInt(tx.amount), expectedUnits)) return true;
  }
  return false;
}

// ── LTC ───────────────────────────────────────────────────────
// Primary:  BlockCypher LTC (limit 20)
// Fallback: Blockchair LTC

async function checkLtc(address: string, expectedAmount: string, after: Date): Promise<boolean> {
  const expectedSats = Math.round(parseFloat(expectedAmount) * 1e8);

  // Primary: BlockCypher LTC
  const res = await safeFetch(`https://api.blockcypher.com/v1/ltc/main/addrs/${address}/full?limit=20`);
  if (res?.ok) {
    const data = (await res.json()) as {
      txs?: Array<{ received: string; outputs: Array<{ addresses: string[]; value: number }> }>;
    };
    for (const tx of (data.txs ?? [])) {
      if (new Date(tx.received) < after) continue;
      for (const out of tx.outputs) {
        if (out.addresses.includes(address) && inRange(out.value, expectedSats)) return true;
      }
    }
    return false;
  }

  // Fallback: Blockchair LTC
  logger.info({ address }, "BlockCypher LTC unavailable — falling back to Blockchair");
  const afterDate = after.toISOString().slice(0, 10);
  const fb = await safeFetch(
    `https://api.blockchair.com/litecoin/transactions?q=recipient(${address}),time(>${afterDate})&limit=20&s=time(desc)`,
    { headers: { Accept: "application/json" } },
  );
  if (!fb?.ok) return false;
  const fbData = (await fb.json()) as {
    data?: Array<{ time: string; output_total: number; recipient: string }>;
  };
  for (const tx of (fbData.data ?? [])) {
    if (tx.recipient !== address) continue;
    if (inRange(tx.output_total, expectedSats)) return true;
  }
  return false;
}

// ── SOL ───────────────────────────────────────────────────────
// Primary:  Solana mainnet public RPC
// Fallback: Ankr free public Solana RPC

async function checkSolViaRpc(rpcUrl: string, address: string, expectedLamports: number, after: Date): Promise<boolean | null> {
  try {
    const sigsRes = await safeFetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [address, { limit: 20 }] }),
    });
    if (!sigsRes?.ok) return null;
    const sigsData = (await sigsRes.json()) as { result?: Array<{ signature: string; blockTime: number }>; error?: unknown };
    if (sigsData.error || !Array.isArray(sigsData.result)) return null;

    for (const sig of sigsData.result) {
      if (sig.blockTime && new Date(sig.blockTime * 1000) < after) continue;
      const txRes = await safeFetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "getTransaction",
          params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
        }),
      });
      if (!txRes?.ok) continue;
      const txData = (await txRes.json()) as {
        result?: {
          meta: { postBalances: number[]; preBalances: number[] };
          transaction: { message: { accountKeys: Array<{ pubkey: string }> } };
        };
      };
      const r = txData.result;
      if (!r) continue;
      const keys = r.transaction.message.accountKeys;
      const idx = keys.findIndex((k) => k.pubkey === address);
      if (idx === -1) continue;
      const delta = r.meta.postBalances[idx]! - r.meta.preBalances[idx]!;
      if (delta > 0 && inRange(delta, expectedLamports)) return true;
    }
    return false;
  } catch (err) {
    logger.warn({ err, rpcUrl }, "SOL RPC check failed");
    return null;
  }
}

async function checkSol(address: string, expectedAmount: string, after: Date): Promise<boolean> {
  const expectedLamports = Math.round(parseFloat(expectedAmount) * 1e9);

  const primary = await checkSolViaRpc("https://api.mainnet-beta.solana.com", address, expectedLamports, after);
  if (primary !== null) return primary;

  logger.info({ address }, "Solana mainnet RPC unavailable — falling back to Ankr");
  const fallback = await checkSolViaRpc("https://rpc.ankr.com/solana", address, expectedLamports, after);
  return fallback ?? false;
}

// ── Router ────────────────────────────────────────────────────

export async function checkPaymentReceived(
  coin: CoinSymbol,
  expectedAmount: string,
  after: Date,
): Promise<boolean> {
  const { address } = WALLETS[coin];
  switch (coin) {
    case "BTC":  return checkBtc(address, expectedAmount, after);
    case "ETH":  return checkEth(address, expectedAmount, after, "eth");
    case "USDT": return checkUsdt(address, expectedAmount, after);
    case "LTC":  return checkLtc(address, expectedAmount, after);
    case "SOL":  return checkSol(address, expectedAmount, after);
    case "BNB":  return checkEth(address, expectedAmount, after, "bsc");
    default:     return false;
  }
}
