export async function runCeloFundingWithBalanceCheck<T>(input: {
  readBalance: () => Promise<bigint>;
  requiredBalance: bigint;
  insufficientBalanceMessage: (balance: bigint) => string;
  sendFundingTransaction: () => Promise<T>;
}): Promise<T> {
  const balance = await input.readBalance();
  if (balance < input.requiredBalance) {
    throw new Error(input.insufficientBalanceMessage(balance));
  }
  return input.sendFundingTransaction();
}
