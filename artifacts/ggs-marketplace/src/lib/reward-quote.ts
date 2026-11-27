export const REWARD_SWAP_QUOTE_TTL_MS = 30_000;
const BASIS_POINTS = 10_000n;

export type RewardSwapQuote = {
  amountInRaw: string;
  quotedGdRaw: string;
  minimumGdRaw: string;
  slippageBps: number;
  tokenDecimals: number;
  blockNumber: string;
  deadlineTimestamp: string;
  quotedAt: number;
};

export function parseSlippageBps(value: string): number {
  if (!/^[0-9]+$/.test(value.trim())) {
    throw new Error("Enter slippage in basis points to calculate a minimum.");
  }
  const basisPoints = Number(value.trim());
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 1 || basisPoints >= 10_000) {
    throw new Error("Slippage must be between 1 and 9,999 basis points.");
  }
  return basisPoints;
}

export function minimumReceivedFromQuote(
  quotedOutputRaw: string,
  slippageBps: number,
): string {
  if (!/^[1-9][0-9]*$/.test(quotedOutputRaw)) {
    throw new Error("The live quote returned an invalid G$ amount.");
  }
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 1 || slippageBps >= 10_000) {
    throw new Error("Enter valid slippage before calculating a minimum.");
  }
  const minimum = (BigInt(quotedOutputRaw) * (BASIS_POINTS - BigInt(slippageBps))) /
    BASIS_POINTS;
  if (minimum <= 0n) {
    throw new Error("The selected slippage would allow zero G$; choose a smaller value.");
  }
  return minimum.toString();
}

export function isRewardSwapQuoteFresh(
  quote: Pick<RewardSwapQuote, "quotedAt">,
  now = Date.now(),
): boolean {
  return Number.isSafeInteger(quote.quotedAt) &&
    quote.quotedAt <= now &&
    now - quote.quotedAt < REWARD_SWAP_QUOTE_TTL_MS;
}