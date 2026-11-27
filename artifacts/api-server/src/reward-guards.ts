export function isIdentityPolicyEnabled(
  transactionValue: unknown,
  eventValue: unknown,
  storedValue: unknown,
): boolean {
  return transactionValue === true && eventValue === true && storedValue === true;
}

export function claimDeadlineFromChainTimestamp(timestamp: bigint): Date {
  const deadlineTimestampMs = Number(timestamp) * 1000;
  const claimDeadline = new Date(deadlineTimestampMs);
  if (
    timestamp <= 0n ||
    !Number.isSafeInteger(deadlineTimestampMs) ||
    Number.isNaN(claimDeadline.getTime())
  ) {
    throw new Error("Onchain claim deadline is invalid");
  }
  return claimDeadline;
}