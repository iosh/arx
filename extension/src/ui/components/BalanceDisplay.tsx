import type { ReactNode } from "react";
import { Paragraph, XStack, YStack } from "tamagui";
import { formatTokenAmount } from "@/ui/lib/format";

export type BalanceDisplayProps = {
  amount: bigint | string;
  symbol: string;
  decimals: number;
  loading?: boolean;
  maxFractionDigits?: number;
  right?: ReactNode;
};

export function BalanceDisplay({
  amount,
  symbol,
  decimals,
  loading = false,
  maxFractionDigits = 6,
  right,
}: BalanceDisplayProps) {
  if (loading) {
    return (
      <XStack alignItems="center" gap="$2" minWidth={0}>
        <YStack
          width={120}
          minWidth={80}
          maxWidth={140}
          height={18}
          borderRadius="$sm"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border"
          opacity={0.8}
        />
        <Paragraph color="$mutedText" fontSize="$3" numberOfLines={1}>
          {symbol}
        </Paragraph>
        {right ? <XStack flexShrink={0}>{right}</XStack> : null}
      </XStack>
    );
  }

  const value = formatTokenAmount(amount, decimals, { maxFractionDigits });

  // Handle format error
  if (value === "—") {
    return (
      <XStack alignItems="baseline" gap="$2" minWidth={0}>
        <Paragraph color="$mutedText" fontSize="$3">
          Invalid amount
        </Paragraph>
        {right ? <XStack flexShrink={0}>{right}</XStack> : null}
      </XStack>
    );
  }

  return (
    <XStack alignItems="baseline" gap="$2" minWidth={0}>
      <Paragraph color="$text" fontSize="$5" fontWeight="600" numberOfLines={1}>
        {value}
      </Paragraph>
      <Paragraph color="$mutedText" fontSize="$3" numberOfLines={1}>
        {symbol}
      </Paragraph>
      {right ? <XStack flexShrink={0}>{right}</XStack> : null}
    </XStack>
  );
}
