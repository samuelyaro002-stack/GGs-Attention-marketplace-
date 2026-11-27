/** Localize a decimal string without passing 18-decimal token amounts through Number. */
export function formatExactDecimal(value: string, locale = typeof document === 'undefined' ? 'en' : document.documentElement.lang) {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  const [whole, fraction] = value.split('.');
  const formatter = new Intl.NumberFormat(locale || 'en');
  const decimal = formatter.formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
  return `${formatter.format(BigInt(whole))}${fraction ? `${decimal}${fraction}` : ''}`;
}
