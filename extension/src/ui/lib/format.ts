export type FormatTokenAmountOptions = {
  maxFractionDigits?: number;
  useGrouping?: boolean;
  trimTrailingZeros?: boolean;
  showLessThanForTiny?: boolean;
};

// Cache for pow10 calculations to avoid repeated computation
const POW10_CACHE: Record<number, bigint> = {};

function pow10(decimals: number): bigint {
  if (POW10_CACHE[decimals]) return POW10_CACHE[decimals];

  let result = 1n;
  for (let i = 0; i < decimals; i += 1) result *= 10n;

  POW10_CACHE[decimals] = result;
  return result;
}

function groupThousands(input: string) {
  const s = input.replace(/^0+(\d)/, "$1");
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function toBigIntAmount(amount: bigint | string): bigint | null {
  if (typeof amount === "bigint") return amount;

  const raw = String(amount).trim();
  if (raw.length === 0) return null;

  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export function formatTokenAmount(
  amount: bigint | string,
  decimals: number,
  options?: FormatTokenAmountOptions,
): string {
  const maxFractionDigits = Math.max(0, options?.maxFractionDigits ?? 6);
  const useGrouping = options?.useGrouping ?? true;
  const trimTrailingZeros = options?.trimTrailingZeros ?? true;
  const showLessThanForTiny = options?.showLessThanForTiny ?? true;

  if (!Number.isInteger(decimals) || decimals < 0) return "—";

  const value = toBigIntAmount(amount);
  if (value === null) return "—";

  const negative = value < 0n;
  const abs = negative ? -value : value;

  const base = pow10(decimals);
  const intPart = abs / base;
  const fracPart = abs % base;

  const intTextRaw = intPart.toString(10);
  const intText = useGrouping ? groupThousands(intTextRaw) : intTextRaw;

  if (decimals === 0 || maxFractionDigits === 0) {
    return `${negative ? "-" : ""}${intText}`;
  }

  const fracFull = fracPart.toString(10).padStart(decimals, "0");
  const fracShownRaw = fracFull.slice(0, Math.min(decimals, maxFractionDigits));
  const fracShown = trimTrailingZeros ? fracShownRaw.replace(/0+$/, "") : fracShownRaw;

  if (fracShown.length === 0) {
    if (abs !== 0n && intPart === 0n && showLessThanForTiny) {
      const threshold = `0.${"0".repeat(Math.max(0, maxFractionDigits - 1))}1`;
      return `${negative ? "-" : ""}<${threshold}`;
    }
    return `${negative ? "-" : ""}${intText}`;
  }

  if (abs !== 0n && intPart === 0n && fracShown.replace(/0/g, "").length === 0 && showLessThanForTiny) {
    const threshold = `0.${"0".repeat(Math.max(0, maxFractionDigits - 1))}1`;
    return `${negative ? "-" : ""}<${threshold}`;
  }

  return `${negative ? "-" : ""}${intText}.${fracShown}`;
}
