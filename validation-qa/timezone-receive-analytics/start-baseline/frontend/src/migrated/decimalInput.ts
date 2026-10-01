export function normalizeDecimalInput(value: string, decimals = 6): string | undefined {
  const trimmed = value.trim();
  if (!Number.isInteger(decimals) || decimals < 0) return undefined;
  const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:[.,]\\d{1,${decimals}})?$`);
  return pattern.test(trimmed) ? trimmed.replace(",", ".") : undefined;
}
