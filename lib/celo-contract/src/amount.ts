/** Human-readable CELO, with no exchange rate or floating-point conversion. */
export function isPositiveCeloAmount(value: string): boolean {
  if (!/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(value)) return false;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(18, "0")) > 0n;
}