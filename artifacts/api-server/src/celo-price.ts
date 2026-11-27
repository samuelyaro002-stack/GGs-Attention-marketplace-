import { createHmac, timingSafeEqual } from "node:crypto";

export const CELO_PRICE_CACHE_MS = 30_000;
export const CELO_QUOTE_TTL_MS = 60_000;
export const MINIMUM_USD_POOL = "10.00";
export const MINIMUM_DIRECT_CELO_POOL = "0.1";
const MAXIMUM_USD_POOL_CENTS = 10_000_000;
const MAX_RATE_CHANGE = 0.2;

export type CeloPriceSource = "Coinbase" | "CoinGecko";
export type CeloPrice = {
  rateUsd: string;
  source: CeloPriceSource;
  rateUpdatedAt: number;
};
export type CampaignQuote = CeloPrice & {
  usdAmount: string;
  celoAmount: string;
  expiresAt: number;
  quoteToken: string;
};

type SignedQuote = CampaignQuote & { issuedAt: number };
type PriceCache = CeloPrice & { cachedAt: number };

let cachedPrice: PriceCache | null = null;
let lastGoodPrice: CeloPrice | null = null;
let inFlightPrice: Promise<PriceCache> | null = null;

export class CeloPriceUnavailableError extends Error {
  constructor(message = "We can't get the current CELO price. Try again in a moment, or enter the amount in CELO.") {
    super(message);
    this.name = "CeloPriceUnavailableError";
  }
}

function decimalParts(value: string, label: string): { units: bigint; scale: number } {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`${label} must be a positive decimal value.`);
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 12) throw new Error(`${label} has too many decimal places.`);
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function canonicalUsd(value: string): { amount: string; cents: bigint } {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Enter a USD amount between $10 and $100,000, with up to two decimals.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (cents < 1_000n || cents > BigInt(MAXIMUM_USD_POOL_CENTS)) {
    throw new Error("Enter a USD amount between $10 and $100,000.");
  }
  return {
    amount: `${whole}.${fraction.padEnd(2, "0")}`,
    cents,
  };
}

export function quoteCeloAmount(usdAmount: string, rateUsd: string): string {
  const { cents } = canonicalUsd(usdAmount);
  const rate = decimalParts(rateUsd, "CELO price");
  if (rate.units <= 0n) throw new Error("CELO price must be positive.");
  // CELO amounts are rounded up to four decimals, never down.
  const numerator = cents * 100n * (10n ** BigInt(rate.scale));
  const units = (numerator + rate.units - 1n) / rate.units;
  return `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, "0")}`;
}

export function validateDirectCeloAmount(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,4})?$/.test(trimmed)) {
    throw new Error("Enter a CELO amount with up to four decimal places.");
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const units = BigInt(`${whole}${fraction}`);
  if (units * 10n < 10n ** BigInt(fraction.length)) {
    throw new Error("The minimum direct CELO pool is 0.1 CELO.");
  }
  return trimmed;
}

function parsePrice(value: unknown): string | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 1_000_000 ? value : null;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Price source returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fromCoinbase(): Promise<string> {
  const result = await fetchJson("https://api.coinbase.com/v2/prices/CELO-USD/spot");
  if (!result || typeof result !== "object" || !("data" in result)) throw new Error("Invalid Coinbase response");
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") throw new Error("Invalid Coinbase price data");
  const value = data as { amount?: unknown; base?: unknown; currency?: unknown };
  if (value.base !== "CELO" || value.currency !== "USD") throw new Error("Unexpected Coinbase trading pair");
  const price = parsePrice(value.amount);
  if (!price) throw new Error("Invalid Coinbase price");
  return price;
}

async function fromCoinGecko(): Promise<string> {
  const result = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=celo&vs_currencies=usd");
  if (!result || typeof result !== "object" || !("celo" in result)) throw new Error("Invalid CoinGecko response");
  const celo = (result as { celo?: unknown }).celo;
  if (!celo || typeof celo !== "object") throw new Error("Invalid CoinGecko price data");
  const price = parsePrice(String((celo as { usd?: unknown }).usd));
  if (!price) throw new Error("Invalid CoinGecko price");
  return price;
}

function changedMoreThanAllowed(rate: string): boolean {
  if (!lastGoodPrice || Date.now() - lastGoodPrice.rateUpdatedAt > 60_000) return false;
  const previous = Number(lastGoodPrice.rateUsd);
  const next = Number(rate);
  return Math.abs(next - previous) / previous > MAX_RATE_CHANGE;
}

async function fetchFreshPrice(): Promise<PriceCache> {
  const now = Date.now();
  let price: string | null = null;
  let source: CeloPriceSource | null = null;
  try {
    const candidate = await fromCoinbase();
    if (!changedMoreThanAllowed(candidate)) {
      price = candidate;
      source = "Coinbase";
    }
  } catch {
    // The independent fallback below is still attempted.
  }
  if (!price) {
    try {
      const candidate = await fromCoinGecko();
      if (!changedMoreThanAllowed(candidate)) {
        price = candidate;
        source = "CoinGecko";
      }
    } catch {
      // Return an explicit unavailable state below. A stale price is not a safe quote.
    }
  }
  if (!price || !source) throw new CeloPriceUnavailableError();
  const result = { rateUsd: price, source, rateUpdatedAt: now, cachedAt: now };
  cachedPrice = result;
  lastGoodPrice = result;
  return result;
}

export async function getCeloPrice(): Promise<CeloPrice> {
  const now = Date.now();
  if (cachedPrice && now - cachedPrice.cachedAt < CELO_PRICE_CACHE_MS) {
    const { rateUsd, source, rateUpdatedAt } = cachedPrice;
    return { rateUsd, source, rateUpdatedAt };
  }
  if (!inFlightPrice) {
    inFlightPrice = fetchFreshPrice().finally(() => { inFlightPrice = null; });
  }
  const result = await inFlightPrice;
  const { rateUsd, source, rateUpdatedAt } = result;
  return { rateUsd, source, rateUpdatedAt };
}

function quoteSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new CeloPriceUnavailableError("Campaign quotes are temporarily unavailable.");
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", quoteSecret()).update(payload).digest("base64url");
}

export function createCampaignQuoteToken(usdAmount: string, price: CeloPrice, now = Date.now()): CampaignQuote {
  const { amount } = canonicalUsd(usdAmount);
  const expiresAt = now + CELO_QUOTE_TTL_MS;
  const quote: SignedQuote = {
    usdAmount: amount,
    celoAmount: quoteCeloAmount(amount, price.rateUsd),
    rateUsd: price.rateUsd,
    source: price.source,
    rateUpdatedAt: price.rateUpdatedAt,
    expiresAt,
    issuedAt: now,
    quoteToken: "",
  };
  const payload = Buffer.from(JSON.stringify({
    usdAmount: quote.usdAmount,
    celoAmount: quote.celoAmount,
    rateUsd: quote.rateUsd,
    source: quote.source,
    rateUpdatedAt: quote.rateUpdatedAt,
    expiresAt: quote.expiresAt,
    issuedAt: quote.issuedAt,
  })).toString("base64url");
  quote.quoteToken = `${payload}.${sign(payload)}`;
  return quote;
}

export function verifyCampaignQuoteToken(token: string, usdAmount: string, now = Date.now()): CampaignQuote {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) throw new Error("The CELO quote is invalid. Refresh the quote and try again.");
  const expected = sign(payload);
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new Error("The CELO quote is invalid. Refresh the quote and try again.");
  }
  let quote: SignedQuote;
  try {
    quote = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SignedQuote;
  } catch {
    throw new Error("The CELO quote is invalid. Refresh the quote and try again.");
  }
  const canonical = canonicalUsd(usdAmount).amount;
  if (quote.usdAmount !== canonical || quote.expiresAt <= now ||
      !Number.isSafeInteger(quote.issuedAt) || !Number.isSafeInteger(quote.expiresAt) ||
      quote.expiresAt - quote.issuedAt !== CELO_QUOTE_TTL_MS ||
      !["Coinbase", "CoinGecko"].includes(quote.source) ||
      !parsePrice(quote.rateUsd) || quote.celoAmount !== quoteCeloAmount(canonical, quote.rateUsd)) {
    throw new Error("The CELO quote expired or does not match this pool. Refresh it before continuing.");
  }
  return {
    usdAmount: quote.usdAmount,
    celoAmount: quote.celoAmount,
    rateUsd: quote.rateUsd,
    source: quote.source,
    rateUpdatedAt: quote.rateUpdatedAt,
    expiresAt: quote.expiresAt,
    quoteToken: token,
  };
}

export async function getCampaignQuote(usdAmount: string): Promise<CampaignQuote> {
  const price = await getCeloPrice();
  return createCampaignQuoteToken(usdAmount, price);
}
