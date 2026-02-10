import { Paragraph, XStack, YStack } from "tamagui";
import { formatTokenAmount } from "@/ui/lib/format";

export type TokenListItemProps = {
  symbol: string;
  name: string;
  balanceRaw: string | null;
  decimals: number;
  iconUrl?: string | null;
  loading?: boolean;
  onPress?: () => void;
};

export function TokenListItem({ symbol, name, balanceRaw, decimals, loading = false, onPress }: TokenListItemProps) {
  const formattedBalance = balanceRaw ? formatTokenAmount(balanceRaw, decimals, { maxFractionDigits: 6 }) : "—";

  return (
    <XStack
      paddingVertical="$3"
      paddingHorizontal="$4"
      alignItems="center"
      justifyContent="space-between"
      gap="$3"
      hoverStyle={{ backgroundColor: "$surface" }}
      pressStyle={{ opacity: 0.8 }}
      cursor={onPress ? "pointer" : "default"}
      onPress={onPress}
      borderRadius="$md"
    >
      {/* Left: Icon + Name */}
      <XStack alignItems="center" gap="$3" flex={1} minWidth={0}>
        {/* Token Icon Placeholder */}
        <YStack
          width={40}
          height={40}
          borderRadius="$full"
          backgroundColor="$surface"
          alignItems="center"
          justifyContent="center"
          borderWidth={1}
          borderColor="$border"
        >
          <Paragraph fontSize="$3" fontWeight="600" color="$mutedText">
            {symbol.slice(0, 2).toUpperCase()}
          </Paragraph>
        </YStack>

        <YStack flex={1} minWidth={0} gap="$0.5">
          <Paragraph fontSize="$4" fontWeight="600" color="$text" numberOfLines={1}>
            {name}
          </Paragraph>
          <Paragraph fontSize="$2" color="$mutedText" numberOfLines={1}>
            {symbol}
          </Paragraph>
        </YStack>
      </XStack>

      {/* Right: Balance */}
      <YStack alignItems="flex-end" minWidth={80}>
        {loading ? (
          <YStack width={60} height={18} borderRadius="$sm" backgroundColor="$surface" opacity={0.6} />
        ) : (
          <Paragraph fontSize="$4" fontWeight="500" color="$text" numberOfLines={1}>
            {formattedBalance}
          </Paragraph>
        )}
      </YStack>
    </XStack>
  );
}
